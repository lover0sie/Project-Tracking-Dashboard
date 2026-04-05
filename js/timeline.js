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

const app = initializeApp(firebaseConfig);
const db = getFirestore(app);

// Cache: all-runs + per-day
let cachedRunsAll = [];
const cachedRunsByDay = new Map();

export function clearCache() {
  cachedRunsAll = [];
  cachedRunsByDay.clear();
}

/* Existing behavior (loads everything). */
export async function loadRuns(force = false) {
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