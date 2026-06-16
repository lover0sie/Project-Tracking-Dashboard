/* For tree view */
import {
  collection,
  collectionGroup,
  doc,
  getDocs,
  getDoc,
  query,
  where,
  orderBy
} from "https://www.gstatic.com/firebasejs/11.6.0/firebase-firestore.js";

import { db } from "./firebase.js";

// Cache: all-runs + per-day
let cachedRunsAll = [];
const cachedRunsByDay = new Map();

export function clearCache() {
  cachedRunsAll = [];
  cachedRunsByDay.clear();
}

/* Existing behavior (loads everything). */
export async function loadRuns(force = false) {
  if (!force && cachedRunsAll.length) {
    console.warn("loadRuns() returning cached runs to prevent excessive Firestore reads.");
    return cachedRunsAll;
  }

  if (!force) {
    console.warn("loadRuns() fetching all runs from Firestore; use force=true only when you need fresh data.");
  }

  const snap = await getDocs(collectionGroup(db, "runs"));
  const runs = [];
  snap.forEach(d => runs.push({ id: d.id, ...d.data() }));

  cachedRunsAll = runs;
  return runs;
}

/* NEW: load only one day (recommended for daily gantt 07:00–22:00 view) */
/* dayKey format: "YYYY-MM-DD" (Malaysia date) */
export async function loadRunsForDay(dayKey, force = false) {
  if (!dayKey) return [];
  if (!force && cachedRunsByDay.has(dayKey)) return cachedRunsByDay.get(dayKey);

  const q = query(
    collectionGroup(db, "runs"),
    where("runDate", "==", dayKey),
    orderBy("startEpochMs", "asc") // optional but nice
  );

  const snap = await getDocs(q);
  const runs = [];
  snap.forEach(d => runs.push({ id: d.id, ...d.data() }));

  cachedRunsByDay.set(dayKey, runs);
  return runs;
}


 /* Optional helper: get runs that overlap gantt window for a day. */
export function filterRunsOverlappingWindow(runs, windowStartMs, windowEndMs) {
  return (runs || []).filter(r => {
    const s = typeof r.startEpochMs === "number" ? r.startEpochMs : null;
    const e =
      typeof r.endEpochMs === "number"
        ? r.endEpochMs
        : (r.status === "running" ? Date.now() : null);

    if (s == null) return false;
    const end = e ?? s; // if no end, treat as instant
    return end > windowStartMs && s < windowEndMs;
  });
}

function getLatestHoldEpochMs(run) {
  const holds = Array.isArray(run?.holds) ? run.holds : [];

  for (let i = holds.length - 1; i >= 0; i--) {
    const holdMs = Number(holds[i]?.holdAtEpochMs);
    if (Number.isFinite(holdMs)) return holdMs;
  }

  if (typeof run?.holdEpochMs === "number" && Number.isFinite(run.holdEpochMs)) {
    return run.holdEpochMs;
  }

  return null;
}

export async function loadRunsForDayWithCarryForward(dayKey, force = false) {
  if (!dayKey) return [];

  const allRuns = await loadRuns(force);

  const selectedDate = new Date(dayKey + "T00:00:00");
  const dayStartMs = new Date(
    selectedDate.getFullYear(),
    selectedDate.getMonth(),
    selectedDate.getDate(),
    0, 0, 0, 0
  ).getTime();

  const dayEndMs = new Date(
    selectedDate.getFullYear(),
    selectedDate.getMonth(),
    selectedDate.getDate(),
    23, 59, 59, 999
  ).getTime();

  const merged = allRuns.filter(r => {
    const startMs =
      typeof r.startEpochMs === "number" ? r.startEpochMs : null;

    let endMs =
      typeof r.endEpochMs === "number"
        ? r.endEpochMs
        : null;

    const status = String(r.status || "").toLowerCase().trim();

    if (endMs == null) {
      if (status === "running") {
        endMs = Date.now();
      } else if (status === "on_hold") {
        endMs = getLatestHoldEpochMs(r);
      }
    }

    if (startMs == null) return false;
    if (endMs == null) endMs = startMs;

    return endMs > dayStartMs && startMs < dayEndMs;
  });

  const seen = new Set();
  return merged.filter(r => {
    const key = r.id || `${r.serialNumber || ""}|${r.station || ""}|${r.startEpochMs || ""}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function getMonthRange(monthValue) {
  const [year, month] = String(monthValue).split("-").map(Number);
  if (!year || !month) return null;

  const start = new Date(year, month - 1, 1, 0, 0, 0, 0);
  const end = new Date(year, month, 1, 0, 0, 0, 0);

  return {
    startMs: start.getTime(),
    endMs: end.getTime()
  };
}

export async function loadRunsForMonth(monthValue) {
  const range = getMonthRange(monthValue);
  if (!range) return [];

  const q = query(
    collectionGroup(db, "runs"),
    where("startEpochMs", ">=", range.startMs),
    where("startEpochMs", "<", range.endMs),
    orderBy("startEpochMs", "asc")
  );

  const snap = await getDocs(q);
  const runs = [];
  snap.forEach(d => runs.push({ id: d.id, ...d.data() }));
  return runs;
}

/* Load only parent project docs */
export async function loadProjectHeadersFallbackFromRuns() {

  const snap = await getDocs(collectionGroup(db, "runs"));
  const map = new Map();

  snap.forEach(d => {
    const run = d.data();

    const serial = String(run.chillerSerialNumber || "").trim();
    if (!serial) return;

    if (!map.has(serial)) {
      map.set(serial, {
        chillerSerialNumber: serial,
        projectName: run.projectName || "-",
        materialNumber: run.materialNumber || "-",
        model: run.model || "-",
        qrKinds: new Set(),
        runCount: 0,
        latestStart: 0,
        firstStart: Infinity
      });
    }

    const row = map.get(serial);
    row.runCount += 1;

    let startMs = Number(run.startEpochMs || 0);


    if (startMs > 0) {
      row.latestStart = Math.max(row.latestStart || 0, startMs);
      row.firstStart = Math.min(row.firstStart || Infinity, startMs);
    }

    if (run.qrKind) {
      row.qrKinds.add(String(run.qrKind).trim());
    }
  });

  return Array.from(map.values())
    .map(item => ({
      ...item,
      qrKinds: Array.from(item.qrKinds),
      firstStart: item.firstStart === Infinity ? 0 : item.firstStart
    }));
}

/* Load runs only for one selected project */
export async function loadRunsForProject(chillerSerialNumber) {
  if (!chillerSerialNumber) return [];

  const q = query(
    collectionGroup(db, "runs"),
    where("chillerSerialNumber", "==", chillerSerialNumber),
    orderBy("startEpochMs", "asc")
  );

  const snap = await getDocs(q);
  const runs = [];
  snap.forEach(d => runs.push({ id: d.id, ...d.data() }));
  return runs;
}
