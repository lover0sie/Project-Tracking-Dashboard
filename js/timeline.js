/* For tree view */

import { initializeApp } from "https://www.gstatic.com/firebasejs/9.23.0/firebase-app.js";
import {
  getFirestore,
  collectionGroup,
  getDocs,
  query,
  where,
  orderBy
} from "https://www.gstatic.com/firebasejs/9.23.0/firebase-firestore.js";

/* Firebase config */
const firebaseConfig = {
  apiKey: "AIzaSyBePrEYgwU4tD9h82n9PbjfxtTyQMXm6Kk",
  authDomain: "qrcodetesting-4f86e.firebaseapp.com",
  projectId: "qrcodetesting-4f86e",
  storageBucket: "qrcodetesting-4f86e.firebasestorage.app",
  messagingSenderId: "746921254909",
  appId: "1:746921254909:web:7acce026b9d96c97880394"
};

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
  console.warn("loadRuns() disabled to prevent excessive Firestore reads.");
  if (!force && cachedRunsAll.length) return cachedRunsAll;

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

function getPrevDayKey(dayKey) {
  if (!dayKey) return "";

  const [y, m, d] = dayKey.split("-").map(Number);
  const dt = new Date(y, m - 1, d);
  dt.setDate(dt.getDate() - 1);

  const yy = dt.getFullYear();
  const mm = String(dt.getMonth() + 1).padStart(2, "0");
  const dd = String(dt.getDate()).padStart(2, "0");

  return `${yy}-${mm}-${dd}`;
}

export async function loadRunsForDayWithCarryForward(dayKey, force = false) {
  if (!dayKey) return [];

  const prevDayKey = getPrevDayKey(dayKey);

  const [todayRuns, prevRuns] = await Promise.all([
    loadRunsForDay(dayKey, force),
    loadRunsForDay(prevDayKey, force)
  ]);

  const merged = [...prevRuns, ...todayRuns].filter(r => {
  if (r.runDate === dayKey) return true;

  const status = String(r.status || "").toLowerCase().trim();
  return status === "running" || status === "on_hold";
  })

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