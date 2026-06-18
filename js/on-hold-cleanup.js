import {
  collectionGroup,
  getDocs,
  query,
  Timestamp,
  updateDoc,
  where
} from "https://www.gstatic.com/firebasejs/11.6.0/firebase-firestore.js";

import { db } from "./firebase.js";
import {
  buildSegmentsFromRuns,
  getActualEffectiveDurationMs,
  getProcessCode
} from "./helpers.js";

const STANDARD_BASELINE_FROM = "2026-05-01";
const STANDARD_BASELINE_TO = "2026-06-12";
const STANDARD_FACTOR = 0.8;

const PROCESS_BY_PV = {
  EVAPORATOR: [
    "6A - Hole Bevelling",
    "7 - Connector welding",
    "8A - Internal plate assembly",
    "8B - Fitting internal plate",
    "8C - GMAW C&B",
    "9 - Fitting and welding distribution box",
    "10 - Tube support, bush fitting, and tube sheet fitting",
    "11 - Tubesheet welding",
    "12 - Bracket and attachment welding, copper tube brazing",
    "13 - Unit side plate and base welding",
    "14A - Tube slotting",
    "14B - Tube expansion",
    "15 - Primer painting",
    "16 - Pneumatic testing",
    "17 - Hydrostatic testing",
    "18, 19 - Primer painting (weld seam) and top coat painting"
  ],
  CONDENSER: [
    "6A - Hole Bevelling",
    "7 - Connector welding",
    "8A - Internal plate assembly",
    "8B - Fitting internal plate",
    "8C - GMAW C&B",
    "9 - Fitting and welding distribution box",
    "10 - Tube support, bush fitting, and tube sheet fitting",
    "11 - Tubesheet welding",
    "12 - Bracket and attachment welding, copper tube brazing",
    "13 - Unit side plate and base welding",
    "14A - Tube slotting",
    "14B - Tube expansion",
    "15 - Primer painting",
    "16 - Pneumatic testing",
    "17 - Hydrostatic testing",
    "18, 19 - Primer painting (weld seam) and top coat painting"
  ],
  "OIL SEPARATOR": [
    "6, 7 - Hole bevelling and connector welding",
    "8, 9, 10, 11 - Internal plate, distribution box, tube support and bush fitting and welding",
    "12 - Bracket and attachment fitting and welding",
    "15 - Primer painting",
    "16 - Pneumatic testing",
    "19 - Top coat painting"
  ],
  ECONOMIZER: [
    "6, 7 - Hole bevelling and connector welding",
    "8, 9, 10, 11 - Internal plate, distribution box, tube support and bush fitting and welding",
    "12 - Bracket and attachment fitting and welding",
    "15 - Primer painting",
    "16 - Pneumatic testing",
    "19 - Top coat painting"
  ]
};

const PROCESS_BY_CHILLER = {
  "AIR-COOLED": [
    "Piping shop",
    "A1 - Coil assembly (Fan assembly)",
    "A2 - Coil assembly (Fan wiring)",
    "B1 - High-side assembly (Compressor assembly)",
    "B2 - High-side assembly (Evaporator assembly)",
    "B3 - High-side assembly (Piping assembly)",
    "B4 - High-side assembly (Wiring base)",
    "C1 - Brazing assembly (Brazing base)",
    "C2 - Brazing assembly (Brazing coil)",
    "D1 - Final assembly (Hoist coil onto base)",
    "D2 - Final assembly (Final brazing)",
    "D3 - Final assembly (Accessories assembly)",
    "D4 - Final assembly (Wiring control box)",
    "D5 - Final assembly (Panel installation)",
    "D6 - Final assembly (Pipe insulation)",
    "H1 - Wipe, sanding, polish, paste tape and plastic, and spray paint",
    "H2 - Remove tape and plastic, attach acrylic, organize wires, attach cap, and paste unit stickers",
    "H3 - Wrap the unit"
  ],
  "WATER-COOLED": [
    "Piping shop",
    "Steel pipe sub-assembly",
    "A - Insulation compressor",
    "B - Insulation evaporator, piping, and economizer/oil separator",
    "C - Major components assembly",
    "D - Steel pipe welding",
    "E - Copper pipe brazing",
    "F - Control box and wiring",
    "G - Piping insulation",
    "H1 - Wipe, sanding, polish, paste tape and plastic, and spray paint",
    "H2 - Remove tape and plastic, attach acrylic, organize wires, attach cap, and paste unit stickers",
    "H3 - Wrap the unit"
  ]
};

let onHoldRows = [];
let processTimeRows = [];
let verifiedMigration = null;

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function normalize(value) {
  return String(value || "").trim().toUpperCase();
}

function normalizeProcessLabel(value) {
  return String(value || "").replace(/\s+/g, " ").trim().toLowerCase();
}


function getLatestHold(run) {
  const holds = Array.isArray(run?.holds) ? run.holds : [];

  for (let i = holds.length - 1; i >= 0; i--) {
    const holdMs = Number(holds[i]?.holdAtEpochMs);
    if (Number.isFinite(holdMs)) {
      return {
        atMs: holdMs,
        reason: holds[i]?.holdReason || run?.holdReason || "",
        remarks: holds[i]?.remarks || run?.remarks || "",
        byName: holds[i]?.byName || "",
        byNumber: holds[i]?.byNumber || ""
      };
    }
  }

  if (typeof run?.holdEpochMs === "number" && Number.isFinite(run.holdEpochMs)) {
    return {
      atMs: run.holdEpochMs,
      reason: run?.holdReason || "",
      remarks: run?.remarks || "",
      byName: run?.heldByName || "",
      byNumber: run?.heldByNumber || ""
    };
  }

  return {
    atMs: null,
    reason: run?.holdReason || "",
    remarks: run?.remarks || "",
    byName: "",
    byNumber: ""
  };
}

function formatDateTime(ms) {
  if (!Number.isFinite(ms)) return "-";
  return new Date(ms).toLocaleString("en-MY", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: true
  });
}

function formatHours(ms) {
  if (!Number.isFinite(ms) || ms < 0) return "-";
  return (ms / 3600000).toFixed(2);
}

function formatMinutes(ms) {
  if (!Number.isFinite(ms) || ms < 0) return "-";
  return (ms / 60000).toFixed(1);
}

function formatDateTimeLocalInput(ms) {
  if (!Number.isFinite(ms)) return "";

  const d = new Date(ms);
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  const hh = String(d.getHours()).padStart(2, "0");
  const min = String(d.getMinutes()).padStart(2, "0");

  return `${yyyy}-${mm}-${dd}T${hh}:${min}`;
}

function parseDateTimeLocalInput(value) {
  if (!value) return null;

  const ms = new Date(value).getTime();
  return Number.isFinite(ms) ? ms : null;
}

function getTimestampMs(timestampValue, epochMsValue) {
  const epochMs = Number(epochMsValue);
  if (Number.isFinite(epochMs)) return epochMs;

  if (timestampValue && typeof timestampValue.toMillis === "function") {
    return timestampValue.toMillis();
  }

  if (timestampValue && typeof timestampValue.toDate === "function") {
    return timestampValue.toDate().getTime();
  }

  return null;
}

function getType(run) {
  const qrKind = normalize(run.qrKind);

  if (qrKind === "PV") return run.vesselType || "-";
  if (qrKind === "CHILLER") {
    return run.insulationItemType || run.coolingType || run.vesselType || "-";
  }

  return run.coolingType || run.vesselType || run.insulationItemType || "-";
}

function getSerial(run) {
  return (
    run.chillerSerialNumber ||
    run.pvSerialNumber ||
    run.serialNumber ||
    run.serial ||
    "-"
  );
}

function getProcessName(run) {
  return String(run.processName || run.processLabel || "").trim();
}

function sameProcess(a, b) {
  return normalize(a) === normalize(b);
}

function formatProcessCode(processName) {
  const text = String(processName || "").trim();
  if (!text) return "-";

  const parts = text.split(" - ");
  return (parts[0] || text).trim() || "-";
}

function getNextProcess(run) {
  const qrKind = normalize(run.qrKind);
  const current = getProcessName(run);
  let list = [];

  if (qrKind === "PV") {
    list = PROCESS_BY_PV[normalize(run.vesselType)] || [];
  } else if (qrKind === "CHILLER") {
    list = PROCESS_BY_CHILLER[normalize(run.coolingType)] || [];
  }

  if (!list.length || !current) return "-";

  const index = list.findIndex(item => sameProcess(item, current));
  if (index < 0) return "-";

  const nextProcess = list[index + 1];
  return nextProcess ? formatProcessCode(nextProcess) : "Last process";
}

function toRow(docSnap) {
  const run = docSnap.data();
  const hold = getLatestHold(run);
  const holdMs = Number.isFinite(hold.atMs) ? Date.now() - hold.atMs : null;

  return {
    ref: docSnap.ref,
    id: docSnap.id,
    path: docSnap.ref.path,
    run,
    holdAtMs: hold.atMs,
    holdAtText: formatDateTime(hold.atMs),
    holdHoursText: formatHours(holdMs),
    serial: getSerial(run),
    projectName: run.projectName || "-",
    type: getType(run),
    model: run.model || "-",
    station: run.station || "-",
    process: formatProcessCode(getProcessName(run)),
    status: run.status || "-",
    nextProcess: getNextProcess(run)
  };
}

async function loadOnHoldRows() {
  const q = query(collectionGroup(db, "runs"), where("status", "==", "on_hold"));
  const snap = await getDocs(q);

  onHoldRows = snap.docs
    .map(toRow)
    .sort((a, b) =>
      (a.holdAtMs ?? Number.MAX_SAFE_INTEGER) - (b.holdAtMs ?? Number.MAX_SAFE_INTEGER) ||
      String(a.serial).localeCompare(String(b.serial), undefined, { numeric: true }) ||
      String(a.station).localeCompare(String(b.station), undefined, { numeric: true })
    );

  return onHoldRows;
}

function renderLoading() {
  const body = document.getElementById("onHoldCleanupBody");
  if (body) {
    body.innerHTML = `
      <tr>
        <td colspan="11" class="onHoldCleanupEmpty">Loading on-hold records...</td>
      </tr>
    `;
  }
}

function renderRows() {
  const countEl = document.getElementById("onHoldCleanupCount");
  const body = document.getElementById("onHoldCleanupBody");

  if (countEl) countEl.textContent = String(onHoldRows.length);
  if (!body) return;

  if (!onHoldRows.length) {
    body.innerHTML = `
      <tr>
        <td colspan="11" class="onHoldCleanupEmpty">No current on-hold records found.</td>
      </tr>
    `;
    return;
  }

  body.innerHTML = onHoldRows.map((row, index) => `
    <tr>
      <td>${escapeHtml(row.serial)}</td>
      <td>${escapeHtml(row.projectName)}</td>
      <td>${escapeHtml(row.type)}</td>
      <td>${escapeHtml(row.model)}</td>
      <td>${escapeHtml(row.station)}</td>
      <td>${escapeHtml(row.process)}</td>
      <td><span class="onHoldStatusPill">${escapeHtml(row.status)}</span></td>
      <td>${escapeHtml(row.holdAtText)}</td>
      <td class="numCell">${escapeHtml(row.holdHoursText)}</td>
      <td>${escapeHtml(row.nextProcess)}</td>
      <td>
        <button type="button" class="onHoldCompleteBtn" data-index="${index}">
          Complete
        </button>
      </td>
    </tr>
  `).join("");
}

async function refreshOnHoldCleanup() {
  const refreshBtn = document.getElementById("btnRefreshOnHoldCleanup");
  const originalText = refreshBtn?.textContent || "Refresh List";

  try {
    if (refreshBtn) {
      refreshBtn.disabled = true;
      refreshBtn.textContent = "Loading...";
    }

    renderLoading();
    await loadOnHoldRows();
    renderRows();
  } catch (err) {
    console.error("Failed to load on-hold cleanup records:", err);
    const body = document.getElementById("onHoldCleanupBody");
    if (body) {
      body.innerHTML = `
        <tr>
          <td colspan="11" class="onHoldCleanupEmpty">Failed to load on-hold records. Check console for details.</td>
        </tr>
      `;
    }
  } finally {
    if (refreshBtn) {
      refreshBtn.disabled = false;
      refreshBtn.textContent = originalText;
    }
  }
}

function getProcessAverageKey(run) {
  return [
    normalize(run.model),
    normalize(getLineBalanceType(run)),
    normalize(getProcessCode(getProcessName(run)))
  ].join("|");
}

function getLineBalanceType(run) {
  if (normalize(run.qrKind) === "PV") {
    return String(run.vesselType || "PV").trim();
  }

  return "CHILLER";
}

function parseDateStartMs(value) {
  if (!value) return null;

  const [year, month, day] = String(value).split("-").map(Number);
  if (!year || !month || !day) return null;

  return new Date(year, month - 1, day, 0, 0, 0, 0).getTime();
}

function parseDateEndMs(value) {
  if (!value) return null;

  const [year, month, day] = String(value).split("-").map(Number);
  if (!year || !month || !day) return null;

  return new Date(year, month - 1, day, 23, 59, 59, 999).getTime();
}

function isRunInStandardBaseline(run) {
  const startMs = getTimestampMs(run.startAt, run.startEpochMs);
  const fromMs = parseDateStartMs(STANDARD_BASELINE_FROM);
  const toMs = parseDateEndMs(STANDARD_BASELINE_TO);

  return Number.isFinite(startMs) && startMs >= fromMs && startMs <= toMs;
}

function calculateStandardDurationMs(values) {
  if (!Array.isArray(values) || !values.length) return null;

  const average = values.reduce((sum, value) => sum + value, 0) / values.length;
  return average * STANDARD_FACTOR;
}

function getCompletedDurationMs(run) {
  const built = buildSegmentsFromRuns([{ id: run?.id || "", ...run }]);
  const seg = built?.segments?.[0];
  const effectiveMs = seg ? getActualEffectiveDurationMs(seg) : null;

  if (Number.isFinite(effectiveMs) && effectiveMs > 0) return effectiveMs;

  const durationMs = Number(run.durationMs);
  if (Number.isFinite(durationMs) && durationMs > 0) return durationMs;

  const startMs = getTimestampMs(run.startAt, run.startEpochMs);
  const endMs = getTimestampMs(run.endAt, run.endEpochMs);

  if (!Number.isFinite(startMs) || !Number.isFinite(endMs)) return null;
  if (endMs <= startMs) return null;

  return endMs - startMs;
}

function toCompletedProcessRow(docSnap, averageMs, sampleCount) {
  const run = docSnap.data();
  const startMs = getTimestampMs(run.startAt, run.startEpochMs);
  const endMs = getTimestampMs(run.endAt, run.endEpochMs);
  const actualMs = getCompletedDurationMs(run);
  const correctedEndMs = Number.isFinite(startMs) && Number.isFinite(averageMs)
    ? startMs + Math.round(averageMs)
    : null;

  return {
    ref: docSnap.ref,
    id: docSnap.id,
    run,
    startMs,
    endMs,
    actualMs,
    averageMs,
    extraMs: actualMs - averageMs,
    correctedEndMs,
    sampleCount,
    serial: getSerial(run),
    projectName: run.projectName || "-",
    type: getType(run),
    model: run.model || "-",
    station: run.station || "-",
    process: formatProcessCode(getProcessName(run)),
    startText: formatDateTime(startMs),
    endText: formatDateTime(endMs),
    actualMinutesText: formatMinutes(actualMs),
    standardMinutesText: formatMinutes(averageMs),
    extraMinutesText: formatMinutes(actualMs - averageMs)
  };
}

async function loadProcessTimeRows() {
  const q = query(collectionGroup(db, "runs"), where("status", "==", "completed"));
  const snap = await getDocs(q);
  const validDocs = snap.docs.filter(docSnap => {
    const run = docSnap.data();
    return (
      getProcessName(run) &&
      Number.isFinite(getTimestampMs(run.startAt, run.startEpochMs)) &&
      Number.isFinite(getCompletedDurationMs(run))
    );
  });

  const groups = new Map();

  for (const docSnap of validDocs) {
    const run = docSnap.data();
    const key = getProcessAverageKey(run);
    const durationMs = getCompletedDurationMs(run);

    if (!isRunInStandardBaseline(run)) continue;

    if (!groups.has(key)) {
      groups.set(key, []);
    }

    groups.get(key).push(durationMs);
  }

  processTimeRows = validDocs
    .map(docSnap => {
      const run = docSnap.data();
      const group = groups.get(getProcessAverageKey(run));
      const averageMs = calculateStandardDurationMs(group);
      const actualMs = getCompletedDurationMs(run);

      if (!Number.isFinite(averageMs) || !Number.isFinite(actualMs)) return null;
      if (actualMs <= averageMs) return null;

      return toCompletedProcessRow(docSnap, averageMs, group.length);
    })
    .filter(Boolean)
    .sort((a, b) =>
      b.extraMs - a.extraMs ||
      String(a.serial).localeCompare(String(b.serial), undefined, { numeric: true }) ||
      String(a.station).localeCompare(String(b.station), undefined, { numeric: true })
    );

  return processTimeRows;
}

function renderProcessTimeLoading() {
  const body = document.getElementById("processTimeCleanupBody");
  if (body) {
    body.innerHTML = `
      <tr>
        <td colspan="12" class="onHoldCleanupEmpty">Loading completed records...</td>
      </tr>
    `;
  }
}

function renderProcessTimeRows() {
  const countEl = document.getElementById("processTimeCleanupCount");
  const body = document.getElementById("processTimeCleanupBody");

  if (countEl) countEl.textContent = String(processTimeRows.length);
  if (!body) return;

  if (!processTimeRows.length) {
    body.innerHTML = `
      <tr>
        <td colspan="12" class="onHoldCleanupEmpty">No completed records exceed the baseline standard time.</td>
      </tr>
    `;
    return;
  }

  body.innerHTML = processTimeRows.map((row, index) => `
    <tr>
      <td>${escapeHtml(row.serial)}</td>
      <td>${escapeHtml(row.projectName)}</td>
      <td>${escapeHtml(row.type)}</td>
      <td>${escapeHtml(row.model)}</td>
      <td>${escapeHtml(row.station)}</td>
      <td>${escapeHtml(row.process)}</td>
      <td>${escapeHtml(row.startText)}</td>
      <td>${escapeHtml(row.endText)}</td>
      <td class="numCell">${escapeHtml(row.actualMinutesText)}</td>
      <td class="numCell">${escapeHtml(row.standardMinutesText)}</td>
      <td class="numCell overAverageCell">${escapeHtml(row.extraMinutesText)}</td>
      <td>
        <button type="button" class="processTimeCorrectBtn" data-index="${index}">
          Correct Time
        </button>
      </td>
    </tr>
  `).join("");
}

async function refreshProcessTimeCleanup() {
  const refreshBtn = document.getElementById("btnRefreshProcessTimeCleanup");
  const originalText = refreshBtn?.textContent || "Refresh List";

  try {
    if (refreshBtn) {
      refreshBtn.disabled = true;
      refreshBtn.textContent = "Loading...";
    }

    renderProcessTimeLoading();
    await loadProcessTimeRows();
    renderProcessTimeRows();
  } catch (err) {
    console.error("Failed to load completed process time records:", err);
    const body = document.getElementById("processTimeCleanupBody");
    if (body) {
      body.innerHTML = `
        <tr>
          <td colspan="12" class="onHoldCleanupEmpty">Failed to load completed records. Check console for details.</td>
        </tr>
      `;
    }
  } finally {
    if (refreshBtn) {
      refreshBtn.disabled = false;
      refreshBtn.textContent = originalText;
    }
  }
}

async function markRowComplete(index) {
  const row = onHoldRows[index];
  if (!row) return;
  if (!Number.isFinite(row.holdAtMs)) {
    window.alert("This record has no valid hold time, so it cannot be completed automatically.");
    return;
  }

  const selectedEndMs = await requestCompletionTime(row);
  if (!Number.isFinite(selectedEndMs)) return;

  if (selectedEndMs > row.holdAtMs) {
    window.alert("Completed time cannot be later than the on-hold time.");
    return;
  }

  const endMs = selectedEndMs;
  const startMs = Number(row.run?.startEpochMs);
  const durationMs = Number.isFinite(startMs) ? Math.max(0, endMs - startMs) : 0;

  await updateDoc(row.ref, {
    status: "completed",
    endAt: Timestamp.fromMillis(endMs),
    endEpochMs: endMs,
    durationMs,
    cleanupPreviousStatus: row.run?.status || "on_hold",
    cleanupHoldEpochMs: row.holdAtMs,
    cleanupCompletedAtEpochMs: Date.now(),
    cleanupAction: "completed_from_on_hold_cleanup"
  });

  window.dispatchEvent(new CustomEvent("onHoldCleanup:completed"));
  await refreshOnHoldCleanup();
}

function requestCompletionTime(row) {
  return new Promise(resolve => {
    document.getElementById("on-hold-complete-dialog")?.remove();

    const startMs = Number(row.run?.startEpochMs);
    const defaultValue = formatDateTimeLocalInput(row.holdAtMs);
    const minValue = Number.isFinite(startMs) ? formatDateTimeLocalInput(startMs) : "";
    const maxValue = formatDateTimeLocalInput(row.holdAtMs);

    const dialog = document.createElement("div");
    dialog.id = "on-hold-complete-dialog";
    dialog.className = "onHoldCompleteDialog";
    dialog.innerHTML = `
      <div class="onHoldCompleteCard" role="dialog" aria-modal="true" aria-labelledby="onHoldCompleteTitle">
        <div class="onHoldCompleteTitle" id="onHoldCompleteTitle">Complete On-Hold Process</div>
        <div class="onHoldCompleteMeta">
          <div><span>Serial:</span> ${escapeHtml(row.serial)}</div>
          <div><span>Process:</span> ${escapeHtml(row.process)}</div>
          <div><span>On Hold At:</span> ${escapeHtml(row.holdAtText)}</div>
        </div>

        <label class="onHoldCompleteField">
          <span>Completed date and time</span>
          <input
            type="datetime-local"
            id="onHoldCompleteAtInput"
            value="${escapeHtml(defaultValue)}"
            ${minValue ? `min="${escapeHtml(minValue)}"` : ""}
            max="${escapeHtml(maxValue)}"
          />
        </label>

        <div class="onHoldCompleteError" id="onHoldCompleteError" aria-live="polite"></div>

        <div class="onHoldCompleteActions">
          <button type="button" class="onHoldCompleteCancel" data-action="cancel">Cancel</button>
          <button type="button" class="onHoldCompleteConfirm" data-action="confirm">Complete</button>
        </div>
      </div>
    `;

    const input = dialog.querySelector("#onHoldCompleteAtInput");
    const error = dialog.querySelector("#onHoldCompleteError");
    const confirmBtn = dialog.querySelector(".onHoldCompleteConfirm");

    const setError = message => {
      if (error) error.textContent = message || "";
      if (confirmBtn) confirmBtn.disabled = !!message;
    };

    const validate = () => {
      const selectedMs = parseDateTimeLocalInput(input?.value);

      if (!Number.isFinite(selectedMs)) {
        setError("Choose a valid completed date and time.");
        return null;
      }

      if (Number.isFinite(startMs) && selectedMs < startMs) {
        setError("Completed time cannot be earlier than the process start time.");
        return null;
      }

      if (selectedMs > row.holdAtMs) {
        setError("Completed time cannot be later than the on-hold time.");
        return null;
      }

      setError("");
      return selectedMs;
    };

    const onKeydown = event => {
      if (event.key !== "Escape") return;
      close(null);
    };

    const close = value => {
      document.removeEventListener("keydown", onKeydown);
      dialog.remove();
      resolve(value);
    };

    input?.addEventListener("input", validate);
    dialog.addEventListener("click", event => {
      if (event.target === dialog) {
        close(null);
        return;
      }

      const action = event.target?.dataset?.action;
      if (action === "cancel") {
        close(null);
        return;
      }

      if (action === "confirm") {
        const selectedMs = validate();
        if (!Number.isFinite(selectedMs)) return;

        const ok = window.confirm(
          `Complete this process at the selected time?\n\n${row.serial}\n${row.process}\nCompleted at: ${formatDateTime(selectedMs)}`
        );

        if (ok) close(selectedMs);
      }
    });

    document.addEventListener("keydown", onKeydown);

    document.body.appendChild(dialog);
    validate();
    input?.focus();
  });
}

async function correctProcessTime(index) {
  const row = processTimeRows[index];
  if (!row) return;

  if (!Number.isFinite(row.correctedEndMs) || !Number.isFinite(row.averageMs)) {
    window.alert("This record has no valid start time or baseline standard time, so it cannot be corrected automatically.");
    return;
  }

  const ok = window.confirm(
    `Correct completed time to match the baseline standard time?\n\n${row.serial}\n${row.process}\nActual: ${row.actualMinutesText} minutes\nStandard: ${row.standardMinutesText} minutes\nNew completed time: ${formatDateTime(row.correctedEndMs)}`
  );

  if (!ok) return;

  const correctedDurationMs = Math.max(0, Math.round(row.averageMs));

  await updateDoc(row.ref, {
    endAt: Timestamp.fromMillis(row.correctedEndMs),
    endEpochMs: row.correctedEndMs,
    durationMs: correctedDurationMs,
    cleanupPreviousEndEpochMs: row.endMs,
    cleanupPreviousDurationMs: row.actualMs,
    cleanupStandardDurationMs: correctedDurationMs,
    cleanupStandardSampleCount: row.sampleCount,
    cleanupStandardBaselineFrom: STANDARD_BASELINE_FROM,
    cleanupStandardBaselineTo: STANDARD_BASELINE_TO,
    cleanupStandardFactor: STANDARD_FACTOR,
    cleanupCorrectedAtEpochMs: Date.now(),
    cleanupAction: "corrected_completed_time_to_baseline_standard"
  });

  await refreshProcessTimeCleanup();
}

function getMigrationInputs() {
  const oldInput = document.getElementById("migrationOldProcessName");
  const newInput = document.getElementById("migrationNewProcessName");

  return {
    oldName: String(oldInput?.value || "").replace(/\s+/g, " ").trim(),
    newName: String(newInput?.value || "").replace(/\s+/g, " ").trim()
  };
}

function setMigrationStatus(message) {
  const statusEl = document.getElementById("processMigrationStatus");
  if (statusEl) statusEl.textContent = message;
}

function setMigrationRunEnabled(enabled) {
  const runBtn = document.getElementById("btnRunProcessMigration");
  if (runBtn) runBtn.disabled = !enabled;
}

function resetVerifiedMigration(message = "Verify the old process name before running migration.") {
  verifiedMigration = null;
  setMigrationRunEnabled(false);
  setMigrationStatus(message);
}

function buildProcessNameMigrationCandidate(docSnap, oldName, newName) {
  const run = docSnap.data();
  const oldKey = normalizeProcessLabel(oldName);
  const update = {};

  if (normalizeProcessLabel(run.processName) === oldKey) {
    update.processName = newName;
    update.migrationPreviousProcessName = run.processName || oldName;
  }

  if (normalizeProcessLabel(run.processLabel) === oldKey) {
    update.processLabel = newName;
    update.migrationPreviousProcessLabel = run.processLabel || oldName;
  }

  if (!Object.keys(update).length) return null;

  return {
    ref: docSnap.ref,
    id: docSnap.id,
    path: docSnap.ref.path,
    run,
    update
  };
}

async function verifyProcessNameMigration() {
  const verifyBtn = document.getElementById("btnVerifyProcessMigration");
  const originalText = verifyBtn?.textContent || "Verify Name";
  const { oldName, newName } = getMigrationInputs();

  if (!oldName) {
    resetVerifiedMigration("Enter the old process name first.");
    return;
  }

  if (newName && normalizeProcessLabel(oldName) === normalizeProcessLabel(newName)) {
    resetVerifiedMigration("The new process name must be different from the old process name.");
    return;
  }

  try {
    if (verifyBtn) {
      verifyBtn.disabled = true;
      verifyBtn.textContent = "Scanning...";
    }

    resetVerifiedMigration("Scanning run records...");

    const snap = await getDocs(collectionGroup(db, "runs"));
    const candidates = snap.docs
      .map(docSnap => buildProcessNameMigrationCandidate(docSnap, oldName, newName || oldName))
      .filter(Boolean);

    if (!candidates.length) {
      resetVerifiedMigration(`Scanned ${snap.size} records. No matching "${oldName}" records found.`);
      return;
    }

    verifiedMigration = {
      oldName,
      oldKey: normalizeProcessLabel(oldName),
      count: candidates.length,
      candidates
    };

    setMigrationRunEnabled(!!newName && normalizeProcessLabel(newName) !== normalizeProcessLabel(oldName));
    setMigrationStatus(
      `Verified ${candidates.length} matching record(s) for "${oldName}". Enter a different new process name, then run migration.`
    );
  } catch (err) {
    console.error("Process name verification failed:", err);
    resetVerifiedMigration("Verification failed. Check console for details.");
  } finally {
    if (verifyBtn) {
      verifyBtn.disabled = false;
      verifyBtn.textContent = originalText;
    }
  }
}

async function runProcessNameMigration() {
  const runBtn = document.getElementById("btnRunProcessMigration");
  const originalText = runBtn?.textContent || "Run Migration";
  const { oldName, newName } = getMigrationInputs();

  if (!verifiedMigration) {
    resetVerifiedMigration("Verify the old process name before running migration.");
    return;
  }

  if (!newName) {
    setMigrationStatus("Enter the new process name before running migration.");
    setMigrationRunEnabled(false);
    return;
  }

  if (normalizeProcessLabel(oldName) !== verifiedMigration.oldKey) {
    resetVerifiedMigration("Old process name changed after verification. Verify again before running migration.");
    return;
  }

  if (normalizeProcessLabel(oldName) === normalizeProcessLabel(newName)) {
    setMigrationStatus("The new process name must be different from the old process name.");
    setMigrationRunEnabled(false);
    return;
  }

  const candidates = verifiedMigration.candidates.map(candidate => ({
    ...candidate,
    update: buildProcessNameMigrationCandidate(
      {
        ref: candidate.ref,
        id: candidate.id,
        data: () => candidate.run
      },
      oldName,
      newName
    )?.update
  })).filter(candidate => candidate.update);

  if (!candidates.length) {
    resetVerifiedMigration("No verified records are still eligible for migration. Verify again.");
    return;
  }

  const ok = window.confirm(
    `Rename ${candidates.length} run record(s)?\n\nFrom: ${oldName}\nTo: ${newName}`
  );

  if (!ok) {
    setMigrationStatus(`Migration cancelled. ${candidates.length} matching record(s) were found but not changed.`);
    return;
  }

  try {
    if (runBtn) {
      runBtn.disabled = true;
      runBtn.textContent = "Updating...";
    }

    setMigrationStatus(`Updating ${candidates.length} matching record(s)...`);

    let updated = 0;
    let failed = 0;

    for (const candidate of candidates) {
      try {
        await updateDoc(candidate.ref, {
          ...candidate.update,
          migrationAction: "renamed_process_name",
          migrationOldProcessName: oldName,
          migrationNewProcessName: newName,
          migrationUpdatedAtEpochMs: Date.now()
        });
        updated++;
      } catch (err) {
        failed++;
        console.error("Failed to migrate process name:", candidate.path, err);
      }

      setMigrationStatus(`Updated ${updated}/${candidates.length} record(s). Failed: ${failed}.`);
    }

    verifiedMigration = null;
    setMigrationRunEnabled(false);
    setMigrationStatus(`Migration complete. Updated ${updated} record(s). Failed: ${failed}.`);
    await refreshOnHoldCleanup();
  } catch (err) {
    console.error("Process name migration failed:", err);
    setMigrationStatus("Migration failed. Check console for details.");
  } finally {
    if (runBtn) {
      runBtn.disabled = false;
      runBtn.textContent = originalText;
    }
  }
}

export function initOnHoldCleanup() {
  const refreshBtn = document.getElementById("btnRefreshOnHoldCleanup");
  const body = document.getElementById("onHoldCleanupBody");
  const processRefreshBtn = document.getElementById("btnRefreshProcessTimeCleanup");
  const processBody = document.getElementById("processTimeCleanupBody");
  const cleanupToolTabs = document.querySelectorAll("[data-cleanup-tool]");
  const cleanupToolPanels = document.querySelectorAll("[data-cleanup-panel]");
  const verifyMigrationBtn = document.getElementById("btnVerifyProcessMigration");
  const runMigrationBtn = document.getElementById("btnRunProcessMigration");
  const migrationOldInput = document.getElementById("migrationOldProcessName");
  const migrationNewInput = document.getElementById("migrationNewProcessName");

  const showCleanupTool = tool => {
    cleanupToolTabs.forEach(tab => {
      const isActive = tab.dataset.cleanupTool === tool;
      tab.classList.toggle("active", isActive);
      tab.setAttribute("aria-selected", isActive ? "true" : "false");
    });

    cleanupToolPanels.forEach(panel => {
      panel.classList.toggle("hidden", panel.dataset.cleanupPanel !== tool);
    });
  };

  cleanupToolTabs.forEach(tab => {
    tab.addEventListener("click", () => {
      showCleanupTool(tab.dataset.cleanupTool || "migration");
    });
  });

  refreshBtn?.addEventListener("click", refreshOnHoldCleanup);
  body?.addEventListener("click", async event => {
    const button = event.target?.closest?.(".onHoldCompleteBtn");
    if (!button) return;

    const index = Number(button.dataset.index);
    const originalText = button.textContent;

    try {
      button.disabled = true;
      button.textContent = "Saving...";
      await markRowComplete(index);
    } catch (err) {
      console.error("Failed to complete on-hold record:", err);
      window.alert("Failed to complete this record. Check console for details.");
    } finally {
      button.disabled = false;
      button.textContent = originalText || "Complete";
    }
  });

  processRefreshBtn?.addEventListener("click", refreshProcessTimeCleanup);
  verifyMigrationBtn?.addEventListener("click", verifyProcessNameMigration);
  runMigrationBtn?.addEventListener("click", runProcessNameMigration);
  migrationOldInput?.addEventListener("input", () => {
    resetVerifiedMigration("Old process name changed. Verify again before running migration.");
  });
  migrationNewInput?.addEventListener("input", () => {
    if (!verifiedMigration) {
      setMigrationRunEnabled(false);
      return;
    }

    const { oldName, newName } = getMigrationInputs();
    setMigrationRunEnabled(!!newName && normalizeProcessLabel(oldName) === verifiedMigration.oldKey && normalizeProcessLabel(oldName) !== normalizeProcessLabel(newName));
  });
  processBody?.addEventListener("click", async event => {
    const button = event.target?.closest?.(".processTimeCorrectBtn");
    if (!button) return;

    const index = Number(button.dataset.index);
    const originalText = button.textContent;

    try {
      button.disabled = true;
      button.textContent = "Saving";
      await correctProcessTime(index);
    } catch (err) {
      console.error("Failed to correct process time record:", err);
      window.alert("Failed to correct this record. Check console for details.");
    } finally {
      button.disabled = false;
      button.textContent = originalText || "Correct Time";
    }
  });

  if (body) refreshOnHoldCleanup();
  if (processBody) refreshProcessTimeCleanup();
}
