import {
  collectionGroup,
  getDocs,
  updateDoc,
  arrayUnion
} from "https://www.gstatic.com/firebasejs/11.6.0/firebase-firestore.js";

import { db } from "./firebase.js";


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
  if (isPastTime(21, 30, now)) return "night_shift_end";
  if (isPastTime(17, 30, now)) return "shift_end";
  return null;
}

const now = new Date();
const stopType = getAutoStopType(now);

export async function autoStopRuns() {
  const now = getNow();
  const nowMs = now.getTime();
  const todayKey = getTodayKey(now);
  const stopType = getAutoStopType(now);

  if (!stopType) {
    return { checked: 0, updated: 0, skippedExcluded: 0, reason: null };
  }

  const snap = await getDocs(collectionGroup(db, "runs"));

  let checked = 0;
  let updated = 0;
  let skippedExcluded = 0;

  for (const docSnap of snap.docs) {
    const run = docSnap.data();
    checked++;
    
    if (String(run.status || "").trim().toLowerCase() !== "running") continue;

    // Skip painting processes
    if (isExcludedFromAutoHold(run.processName)) {
      skippedExcluded++;
      continue;
    }

    // Prevent repeated auto-hold for same cutoff
    if (stopType === "shift_end" && run.autoStopType === "shift_end") continue;
    if (stopType === "night_shift_end" && run.autoStopType === "night_shift_end") continue;

    const remarks =
    stopType === "shift_end"
      ? `Auto hold after 5:30 PM cutoff at ${now.toLocaleString("en-MY")}`
      : `Auto hold after 9:00 PM cutoff at ${now.toLocaleString("en-MY")}`;

    await updateDoc(docSnap.ref, {
      status: "on_hold",
      holds: arrayUnion({
        holdAtEpochMs: nowMs,
        holdReason: "end_of_shift",
        remarks,
        byName: "SYSTEM",
        byNumber: "SYSTEM"
      }),
      holdReason: "end_of_shift",
      holdEpochMs: nowMs,
      autoStopped: true,
      autoStopType: stopType,
      autoStopAtEpochMs: nowMs
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

    // prevent repeat auto-stop
    if (stopType === "shift_end" && r.autoStopType === "shift_end") return;
    if (stopType === "night_shift_end" && r.autoStopType === "night_shift_end") return;

    eligible.push({
      id: docSnap.id,
      serialNumber: r.serialNumber,
      processName: r.processName,
      projectName: r.projectName,
      station: r.station
    });
  });

  return {
    eligible,
    reason: stopType
  };
}