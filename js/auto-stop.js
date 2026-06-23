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

function getCutoffMsForDateKey(dateKey, hour, minute, now = new Date()) {
  const parts = String(dateKey || "").split("-").map(Number);

  if (parts.length !== 3 || parts.some(n => !Number.isFinite(n))) {
    return getTodayCutoffMs(hour, minute, now);
  }

  const [year, month, day] = parts;
  return new Date(year, month - 1, day, hour, minute, 0, 0).getTime();
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

function getEpochMs(value) {
  const numberValue = Number(value);
  if (Number.isFinite(numberValue)) return numberValue;

  if (value && typeof value.toMillis === "function") return value.toMillis();
  if (value && typeof value.toDate === "function") return value.toDate().getTime();

  return null;
}

function getTodayKey(date = new Date()) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

function getDateKeyFromEpochMs(ms) {
  if (!Number.isFinite(ms)) return "";
  return getTodayKey(new Date(ms));
}

function getPreviousDayKey(date = new Date()) {
  const previous = new Date(date);
  previous.setDate(previous.getDate() - 1);
  return getTodayKey(previous);
}

function isAtOrBeforeMorningAutoStopCutoff(date = new Date()) {
  return getMinutesOfDay(date) <= (7 * 60 + 45);
}

function isAtOrAfterEveningAutoStopStart(date = new Date()) {
  return getMinutesOfDay(date) >= (17 * 60 + 30);
}

function getAutoStopRunDateKey(now = new Date()) {
  if (isAtOrBeforeMorningAutoStopCutoff(now)) return getPreviousDayKey(now);
  if (isAtOrAfterEveningAutoStopStart(now)) return getTodayKey(now);
  return null;
}

function getLatestResumeMs(run) {
  const resumeTimes = [];

  const legacyResumeMs = getEpochMs(run?.resumedEpochMs) ?? getEpochMs(run?.resumedAt);
  if (Number.isFinite(legacyResumeMs)) resumeTimes.push(legacyResumeMs);

  if (Array.isArray(run?.resumes)) {
    for (const resume of run.resumes) {
      const resumeMs = getEpochMs(resume?.resumedAtEpochMs) ?? getEpochMs(resume?.resumedAt);
      if (Number.isFinite(resumeMs)) resumeTimes.push(resumeMs);
    }
  }

  return resumeTimes.length ? Math.max(...resumeTimes) : null;
}

function getRunActiveStartMsForAutoStop(run, runDateKey) {
  const startMs = getEpochMs(run?.startEpochMs) ?? getEpochMs(run?.startAt);
  const latestResumeMs = getLatestResumeMs(run);
  const latestResumeDateKey = getDateKeyFromEpochMs(latestResumeMs);

  if (latestResumeDateKey === runDateKey) return latestResumeMs;
  if (latestResumeDateKey && latestResumeDateKey > runDateKey) return null;
  if (run?.runDate === runDateKey && Number.isFinite(startMs)) return startMs;

  return null;
}

function getAutoStopNowMinutes(runDateKey, now = new Date()) {
  const nowMinutes = getMinutesOfDay(now);

  if (runDateKey === getPreviousDayKey(now)) {
    return (24 * 60) + nowMinutes;
  }

  return nowMinutes;
}

function getAutoStopCutoffMs(runStopType, runDateKey, now = new Date()) {
  return runStopType === "shift_end"
    ? getCutoffMsForDateKey(runDateKey, 17, 30, now)
    : getCutoffMsForDateKey(runDateKey, 21, 0, now);
}

function getAutoStopType(now = new Date()) {
  if (isAtOrBeforeMorningAutoStopCutoff(now)) return "night_shift_end";
  if (getMinutesOfDay(now) >= (21 * 60)) return "night_shift_end";
  if (isAtOrAfterEveningAutoStopStart(now)) return "shift_end";
  return null;
}

export async function autoStopRuns() {
  const now = getNow();
  const stopType = getAutoStopType(now);

  if (!stopType) {
    return {
      checked: 0,
      updated: 0,
      skippedExcluded: 0,
      reason: null
    };
  }

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

    const runDateKey = getAutoStopRunDateKey(now);
    const cutoffMs = getAutoStopCutoffMs(runStopType, runDateKey, now);

    if (run.autoStopType === runStopType && run.autoStopAtEpochMs === cutoffMs) continue;

    const remarks =
      runStopType === "shift_end"
        ? `Auto hold after 5:30 PM cutoff at ${now.toLocaleString("en-MY")}`
        : `Auto hold after 9:00 PM cutoff at ${now.toLocaleString("en-MY")}`;

    // Updates the run document with the auto-stop information, including the hold reason and timestamp.
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

    const runDateKey = getAutoStopRunDateKey(now);
    const cutoffMs = getAutoStopCutoffMs(runStopType, runDateKey, now);

    // prevent repeat auto-stop for the same cutoff while allowing later resumes
    if (r.autoStopType === runStopType && r.autoStopAtEpochMs === cutoffMs) return;

    eligible.push({
      id: docSnap.id,
      serialNumber: r.serialNumber,
      processName: r.processName,
      projectName: r.projectName,
      station: r.station,
      autoStopType: runStopType,
      autoStopAtEpochMs: cutoffMs
    });
  });

  return {
    eligible,
    reason: stopType
  };
}

function getRunAutoStopType(run, now = new Date()) {
  const runDateKey = getAutoStopRunDateKey(now);

  if (!runDateKey) return null;

  const activeStartMs = getRunActiveStartMsForAutoStop(run, runDateKey);
  if (!Number.isFinite(activeStartMs)) return null;

  const start = new Date(activeStartMs);

  const startMinutes = getMinutesOfDay(start);
  const nowMinutes = getAutoStopNowMinutes(runDateKey, now);

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
