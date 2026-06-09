import {
  collectionGroup,
  getDocs,
  updateDoc,
  arrayUnion
} from "https://www.gstatic.com/firebasejs/11.6.0/firebase-firestore.js";

import { db } from "./firebase.js";

function getTodayCutoffMs(hour, minute, now = new Date()) {
  const cutoff = new Date(now);
  cutoff.setHours(hour, minute, 0, 0);
  return cutoff.getTime();
}

function normalizeProcessName(name) {
  return String(name || "").replace(/\s+/g, " ").trim().toLowerCase();
}

function isExcludedFromAutoHold(processName) {
  const p = normalizeProcessName(processName);

  return (
    p.startsWith("15 - primer painting") ||
    p.startsWith("18, 19 - primer painting (weld seam) and top coat painting") ||
    p.startsWith("19 - top coat painting")
  );
}

function getNow() {
  return new Date();
}

function getMinutesOfDay(date = new Date()) {
  return date.getHours() * 60 + date.getMinutes();
}

function isPastTime(hour, minute, date = new Date()) {
  return getMinutesOfDay(date) >= (hour * 60 + minute);
}

function getTodayKey(date = new Date()) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

function getAutoStopType(now = new Date()) {
  if (isPastTime(21, 0, now)) return "night_shift_end";
  if (isPastTime(17, 30, now)) return "shift_end";
  return null;
}

export async function autoStopRuns() {
  const now = getNow();
  const stopType = getAutoStopType(now);


  const snap = await getDocs(collectionGroup(db, "runs"));

  let checked = 0;
  let updated = 0;
  let skippedExcluded = 0;

  for (const docSnap of snap.docs) {
    const run = docSnap.data();
    checked++;

    if (String(run.status || "").trim().toLowerCase() !== "running") continue;

    if (isExcludedFromAutoHold(run.processName)) {
      skippedExcluded++;
      continue;
    }

    const runStopType = getRunAutoStopType(run, now);

    if (!runStopType) continue;

    if (run.autoStopType === runStopType) continue;

    const cutoffMs =
      runStopType === "shift_end"
        ? getTodayCutoffMs(17, 30, now)
        : getTodayCutoffMs(21, 0, now);

    const remarks =
      runStopType === "shift_end"
        ? `Auto hold after 5:30 PM cutoff at ${now.toLocaleString("en-MY")}`
        : `Auto hold after 9:00 PM cutoff at ${now.toLocaleString("en-MY")}`;

    await updateDoc(docSnap.ref, {
      status: "on_hold",
      holds: arrayUnion({
        holdAtEpochMs: cutoffMs,
        holdReason: "end_of_shift",
        remarks,
        byName: "SYSTEM",
        byNumber: "SYSTEM"
      }),
      holdReason: "end_of_shift",
      holdEpochMs: cutoffMs,
      autoStopped: true,
      autoStopType: runStopType,
      autoStopAtEpochMs: cutoffMs
    });

    updated++;
  }

  return {
    checked,
    updated,
    skippedExcluded,
    reason: stopType
  };
}

export async function previewAutoStopRuns() {
  const now = new Date();
  const stopType = getAutoStopType(now);

  if (!stopType) {
    return { eligible: [], reason: null };
  }

  const snap = await getDocs(collectionGroup(db, "runs"));

  const eligible = [];

  snap.forEach(docSnap => {
    const r = docSnap.data();

    const status = String(r.status || "").toLowerCase().trim();

    if (status !== "running") return;

    // skip excluded processes
    if (isExcludedFromAutoHold(r.processName)) return;

    const runStopType = getRunAutoStopType(r, now);

    if (!runStopType) return;

    // prevent repeat auto-stop
    if (r.autoStopType === runStopType) return;

    eligible.push({
      id: docSnap.id,
      serialNumber: r.serialNumber,
      processName: r.processName,
      projectName: r.projectName,
      station: r.station,
      autoStopType: runStopType
    });
  });

  return {
    eligible,
    reason: stopType
  };
}

function getRunAutoStopType(run, now = new Date()) {
  const todayKey = getTodayKey(now);

  if (run.runDate !== todayKey) return null;

  const startMs = run.startEpochMs;
  if (!startMs) return null;

  const start = new Date(startMs);

  const startMinutes = getMinutesOfDay(start);
  const nowMinutes = getMinutesOfDay(now);

  const cutoff530 = 17 * 60 + 30;
  const cutoff900 = 21 * 60;

  // Started before 5:30 PM → auto hold at/after 5:30 PM
  if (startMinutes < cutoff530 && nowMinutes >= cutoff530) {
    return "shift_end";
  }

  // Started after 5:30 PM and before 9:00 PM → auto hold at/after 9:00 PM
  if (startMinutes >= cutoff530 && startMinutes < cutoff900 && nowMinutes >= cutoff900) {
    return "night_shift_end";
  }

  return null;
}
