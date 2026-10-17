import {
  arrayUnion,
  collectionGroup,
  getDocs,
  runTransaction
} from "https://www.gstatic.com/firebasejs/11.6.0/firebase-firestore.js";
import { db } from "./firebase.js";
import { assertLevel3Access } from "./access-control.js";
import {
  activeStartMs,
  autoHoldFields,
  isOverdueRunning,
  runningCleanupPlan,
  shiftCutoff
} from "../functions/auto-stop-policy.mjs";

let rows = [];
let refreshing = false;

function escapeHtml(value) {
  return String(value ?? "").replaceAll("&", "&amp;").replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&#039;");
}

function dateTimeInput(epochMs) {
  return new Intl.DateTimeFormat("sv-SE", {
    timeZone: "Asia/Kuala_Lumpur",
    year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", hourCycle: "h23"
  }).format(new Date(epochMs)).replace(" ", "T");
}

function displayTime(epochMs) {
  return new Date(epochMs).toLocaleString("en-MY", { timeZone: "Asia/Kuala_Lumpur" });
}

function setStatus(message) {
  document.getElementById("runningCleanupStatus").textContent = message;
}

function renderRows(nowMs) {
  const body = document.getElementById("runningCleanupBody");
  document.getElementById("runningCleanupCount").textContent = String(rows.length);
  if (!rows.length) {
    body.innerHTML = '<tr><td colspan="10" class="onHoldCleanupEmpty">No processes have been continuously running for more than 24 hours.</td></tr>';
    return;
  }
  body.innerHTML = rows.map((row, index) => {
    const run = row.run;
    const cutoff = shiftCutoff(run);
    const suggestion = cutoff && cutoff.cutoffMs <= nowMs ? dateTimeInput(cutoff.cutoffMs) : "";
    return `
      <tr>
        <td>${escapeHtml(run.serialNumber || "-")}</td>
        <td>${escapeHtml(run.chillerSerialNumber || "-")}</td>
        <td>${escapeHtml(run.pvSerialNumber || "-")}</td>
        <td>${escapeHtml(run.projectName || "-")}</td>
        <td>${escapeHtml(run.station || "-")}</td>
        <td>${escapeHtml(run.processName || "-")}</td>
        <td>${escapeHtml(displayTime(row.activeStart))}</td>
        <td class="numCell">${((nowMs - row.activeStart) / 3600000).toFixed(2)}</td>
        <td>
          <input type="datetime-local" class="runningHoldTime" data-running-time="${index}"
            aria-label="Hold time for ${escapeHtml(run.serialNumber || run.chillerSerialNumber || run.pvSerialNumber || run.processName || "process")} in Malaysia time"
            value="${suggestion}" min="${dateTimeInput(row.activeStart)}" max="${dateTimeInput(nowMs)}" />
        </td>
        <td><button type="button" class="runningHoldBtn" data-running-index="${index}">Place on hold</button>
        </td>
      </tr>
    `;
  }).join("");
}

export async function refreshRunningCleanup() {
  if (refreshing) return;
  refreshing = true;
  const button = document.getElementById("btnRefreshRunningCleanup");
  button.disabled = true;
  setStatus("Loading running processes...");
  try {
    await assertLevel3Access();
    const snapshot = await getDocs(collectionGroup(db, "runs"));
    const nowMs = Date.now();
    rows = snapshot.docs.map(document => ({ ref: document.ref, run: document.data() }))
      .filter(row => isOverdueRunning(row.run, nowMs))
      .map(row => ({ ...row, activeStart: activeStartMs(row.run) }))
      .sort((first, second) => first.activeStart - second.activeStart);
    renderRows(nowMs);
    setStatus("Review the hold date and time before applying. All times are Malaysia time. Painting processes are included for manual review.");
  } catch (error) {
    console.error("Unable to load Running Cleanup", error);
    rows = [];
    document.getElementById("runningCleanupCount").textContent = "0";
    document.getElementById("runningCleanupBody").innerHTML = '<tr><td colspan="10" class="onHoldCleanupEmpty">Unable to load running processes. Select Refresh List to retry.</td></tr>';
    setStatus("Unable to load Running Cleanup. Check your access and connection.");
  } finally {
    refreshing = false;
    button.disabled = false;
  }
}

async function holdRow(index) {
  const row = rows[index];
  if (!row) throw new Error("Refresh the list before applying a hold.");
  const input = document.querySelector(`[data-running-time="${index}"]`);
  if (!input.value || !input.reportValidity()) throw new Error("Choose a valid hold date and time.");
  const cutoffMs = Date.parse(`${input.value}:00+08:00`);
  runningCleanupPlan(row.run, cutoffMs, Date.now());
  if (!window.confirm(`Place ${row.run.serialNumber || row.run.chillerSerialNumber || row.run.pvSerialNumber || "this process"} — ${row.run.processName || ""} on hold at ${displayTime(cutoffMs)} (Malaysia time)? This records the selected historical hold time.`)) return;
  const actor = await assertLevel3Access();
  await runTransaction(db, async transaction => {
    const current = await transaction.get(row.ref);
    if (!current.exists() || activeStartMs(current.data()) !== row.activeStart) {
      throw new Error("This process changed. Refresh the list and review it again.");
    }
    const run = current.data();
    const appliedAt = Date.now();
    const plan = runningCleanupPlan(run, cutoffMs, appliedAt);
    const update = autoHoldFields(plan, appliedAt, { uid: actor.uid }, "running_cleanup");
    transaction.update(row.ref, {
      ...update.fields,
      holds: arrayUnion(update.hold),
      cleanupAction: "held_from_running_cleanup",
      cleanupPreviousStatus: run.status
    });
  });
  window.dispatchEvent(new CustomEvent("runningCleanup:held"));
  await refreshRunningCleanup();
  setStatus("Process placed on hold. The original hold time and the actual cleanup time were recorded.");
}

export function initRunningCleanup() {
  document.getElementById("btnRefreshRunningCleanup").addEventListener("click", refreshRunningCleanup);
  document.getElementById("runningCleanupBody").addEventListener("click", async event => {
    const button = event.target.closest(".runningHoldBtn");
    if (!button) return;
    button.disabled = true;
    try {
      await holdRow(Number(button.dataset.runningIndex));
    } catch (error) {
      setStatus(error.message || "Unable to place this process on hold.");
    } finally {
      button.disabled = false;
    }
  });
}
