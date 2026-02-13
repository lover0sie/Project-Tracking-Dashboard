import { initializeApp } from "https://www.gstatic.com/firebasejs/9.23.0/firebase-app.js";
import { getFirestore, collection, getDocs } from "https://www.gstatic.com/firebasejs/9.23.0/firebase-firestore.js";

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

/* DOM */
const el = (id) => document.getElementById(id);

const bodyEl = el("ganttBody");
const monthHeadEl = el("ganttMonthHead");
const dayHeadEl = el("ganttDayHead");

let cachedEvents = [];

/* Initialize process by station */
const PROCESS_BY_STATION = {
  "PV 1": [
    "Hole Bevelling",
    "Connector welding",
    "Fitting and welding distribution box",
    "Tube support and bush fitting tube sheet fitting",
    "Tubesheet welding",
    "Bracket and attachment welding",
    "Unit side plate and base welding",
    "Tube slotting and expansion",
    "Tube slotting and expansion",
  ],
  // add more later:
  // "PV 2": [...],
};

const PV1_LIST = [
  "Hole Bevelling",
  "Connector welding",
  "Fitting and welding distribution box",
  "Tube support and bush fitting tube sheet fitting",
  "Tubesheet welding",
  "Bracket and attachment welding",
  "Unit side plate and base welding",
  "Tube slotting and expansion",
  "Tube slotting and expansion",
];



/* Helpers */
function formatDuration(ms){
  if (!ms || ms <= 0) return "-";
  const totalSec = Math.round(ms / 1000);
  const h = Math.floor(totalSec / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  const s = totalSec % 60;
  if (h > 0) return `${h}h ${m}m ${s}s`;
  if (m > 0) return `${m}m ${s}s`;
  return `${s}s`;
}


function tsOrMsToDate(ts, ms) {
  if (ts && typeof ts.toDate === "function") return ts.toDate();
  if (typeof ms === "number") return new Date(ms);
  return null;
}

function normStation(s){
  return String(s || "").trim().toUpperCase().replace(/\s+/g," ");
}
function stationKey(s){
  // keep as "PV 1" style
  return normStation(s);
}

function formatDateTime(d) {
  const dateFmt = new Intl.DateTimeFormat("en-GB", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric"
  });

  const timeFmt = new Intl.DateTimeFormat("en-GB", {
    hour: "numeric",
    minute: "2-digit",
    hour12: true
  });

  return `${dateFmt.format(d)} ${timeFmt.format(d)}`;
}

function stationClass(station) {
  const s = String(station || "").toLowerCase().replace(/\s+/g, "");
  if (s.includes("pv1")) return "st1";
  if (s.includes("pv2")) return "st2";
  if (s.includes("pv3")) return "st3";
  if (s.includes("station1")) return "st1";
  if (s.includes("station2")) return "st2";
  if (s.includes("station3")) return "st3";
  return "st2";
}

function tsToDate(ts) {
  if (!ts) return null;
  if (typeof ts.toDate === "function") return ts.toDate();
  if (typeof ts === "number") return new Date(ts);
  return null;
}

function startOfDay(d){ const x=new Date(d); x.setHours(0,0,0,0); return x; }

function endOfDay(d){ const x=new Date(d); x.setHours(23,59,59,999); return x; }

function getDayW(){
  const v = getComputedStyle(document.documentElement).getPropertyValue("--dayW").trim();
  return Number(v.replace("px","")) || 120;
}

function dateKey(d) {
  const dd = String(d.getDate()).padStart(2,"0");
  const mm = String(d.getMonth()+1).padStart(2,"0");
  const yyyy = d.getFullYear();
  return `${dd}/${mm}/${yyyy}`;
}

function weekdayName(d) {
  return new Intl.DateTimeFormat("en-GB", { weekday:"long" }).format(d);
}

function buildDateRange(minDate, maxDate) {
  const out = [];
  let cur = startOfDay(minDate);
  const end = startOfDay(maxDate);
  while (cur <= end) {
    out.push(new Date(cur));
    cur.setDate(cur.getDate() + 1);
  }
  return out;
}

function buildMonthHeader(days){
  const cells = [];
  let i = 0;

  while (i < days.length) {
    const d = days[i];
    const month = d.getMonth();
    const year = d.getFullYear();

    let count = 0;
    while (i + count < days.length) {
      const x = days[i + count];
      if (x.getMonth() !== month || x.getFullYear() !== year) break;
      count++;
    }

    const label = new Intl.DateTimeFormat("en-GB", { month:"short", year:"numeric" }).format(d);
    const widthPx = count * getDayW();

    cells.push(`<div class="monthCell" style="width:${widthPx}px">${label}</div>`);
    i += count;
  }

  return cells.join("");
}

function startOfMonth(d){
  const x = new Date(d);
  x.setDate(1);
  x.setHours(0,0,0,0);
  return x;
}

function addMonths(d, n){
  const x = new Date(d);
  x.setMonth(x.getMonth() + n);
  return x;
}

function endOfMonth(d){
  const x = new Date(d);
  x.setMonth(x.getMonth() + 1, 1);
  x.setHours(0,0,0,0);
  x.setMilliseconds(-1);
  return x;
}

function clampRangeByMode(mode, minDate, maxDate) {
  const now = new Date();

  if (mode === "thisMonth") {
    return { minDate: startOfMonth(now), maxDate: endOfMonth(now) };
  }

  if (mode === "lastMonth") {
    const last = addMonths(now, -1);
    return { minDate: startOfMonth(last), maxDate: endOfMonth(last) };
  }

  if (mode === "last3Months") {
    const start = startOfMonth(addMonths(now, -2)); // includes current month
    const end = endOfMonth(now);
    return { minDate: start, maxDate: end };
  }

  if (mode === "last6Months") {
    const start = startOfMonth(addMonths(now, -5)); // includes current month
    const end = endOfMonth(now);
    return { minDate: start, maxDate: end };
  }

  // auto (use data min/max)
  return { minDate, maxDate };
}


/* Segment builder: pair start/end per serial+station+phase */
function keyOf(serial, station, phase) {
  return `${serial}||${station}||${phase}`;
}

function runTimeToDate(v) {
  if (v && typeof v.toDate === "function") return v.toDate(); // Firestore Timestamp
  if (typeof v === "number") return new Date(v);              // epoch ms
  return null;
}

function buildSegmentsFromRuns(runs) {
  const segments = [];
  const issues = [];

  for (const r of runs) {
    const serial = r.serialNumber || "";
    const station = r.station || "";

    const start = tsOrMsToDate(r.startAt, r.startEpochMs);
    const endRaw = tsOrMsToDate(r.endAt, r.endEpochMs);

    if (!serial || !station || !start) {
      issues.push({ type: "missing_fields", id: r.id, serial, station });
      continue;
    }

    const status = String(r.status || "").toLowerCase();
    const ongoing = status === "running" || !endRaw;

    segments.push({
      serial,
      projectName: r.projectName || "(No Project)",
      materialNumber: r.materialNumber || "",
      description: r.description || "",
      station,
      phase: "process",                    // detect process or line stop
      processLabel: r.processName || "-",
      manpower: Number(r.manpower ?? 0) || 0,
      remarks: r.remarks || "",
      employeeName: r.startedByName || "",
      employeeNumber: r.startedByNumber || "",
      start,
      end: endRaw || new Date(),
      ongoing,
      durationMs: typeof r.durationMs === "number"
        ? r.durationMs
        : (endRaw ? (endRaw.getTime() - start.getTime()) : 0)
    });
  }

  return { segments, issues };
}


/* Project index */
function buildProjectMap(segments) {
  const map = new Map();
  for (const s of segments) {
    if (!map.has(s.serial)) {
      map.set(s.serial, {
        serial: s.serial,
        projectName: s.projectName,
        materialNumber: s.materialNumber,
        segments: []
      });
    }
    const p = map.get(s.serial);
    if (!p.projectName || p.projectName === "(No Project)") p.projectName = s.projectName;
    if (!p.materialNumber) p.materialNumber = s.materialNumber;
    p.segments.push(s);
  }
  return map;
}

function minMaxFromSegments(segments) {
  let min = null, max = null;
  for (const s of segments) {
    if (!min || s.start < min) min = s.start;
    if (!max || s.end > max) max = s.end;
  }
  return { min, max };
}

/* Position bars by time */
function clamp(n, a, b) { return Math.max(a, Math.min(b, n)); }

function renderLegendsStationOnly(segments){
  const stEl = document.getElementById("legendStations");
  if (!stEl) return;

  const uniq = [...new Set(segments.map(s => s.station))].sort();

  stEl.innerHTML = uniq.map(st =>
    `<span class="legItem"><span class="swatch ${stationClass(st)}"></span>${escapeHtml(st)}</span>`
  ).join("");
}

function renderGantt(projectMap, days, rangeMin, rangeMax) {
  // Build headers
  const today = new Date();
  today.setHours(0,0,0,0);

  dayHeadEl.innerHTML = days.map(d => {
    const isToday = d.getTime() === today.getTime();
    return `
      <div class="dayCol ${isToday ? "today" : ""}">
        <div class="d1">${dateKey(d)}</div>
        <div class="d2">${weekdayName(d)}</div>
      </div>
    `;
  }).join("")

  monthHeadEl.innerHTML = buildMonthHeader(days);

  // Compute widths ONCE
  const dayW = getDayW();
  const totalWidthPx = days.length * dayW;

    /* === highlight today column in timeline === */
  today.setHours(0,0,0,0);

  const todayIndex = days.findIndex(d =>
    d.getTime() === today.getTime()
  );

  if (todayIndex >= 0){
    const leftPx = todayIndex * dayW;
    document.documentElement.style.setProperty("--todayLeft", leftPx + "px");

    // add highlight class to all rows
    setTimeout(() => {
      document.querySelectorAll(".ganttTimeline")
        .forEach(t => t.classList.add("todayCol"));
    }, 0);
  }


  document.documentElement.style.setProperty("--days", String(days.length));

  // Force header widths (prevents “lines stop after 25 cols”)
  monthHeadEl.style.width = totalWidthPx + "px";
  dayHeadEl.style.width = totalWidthPx + "px";

  const headWrap = monthHeadEl.parentElement; // .ganttTimelineHead
  if (headWrap) headWrap.style.width = totalWidthPx + "px";

  // 3) Build rows
  const projects = Array.from(projectMap.values()).sort((a, b) => {
    const an = `${a.projectName} (${a.serial})`;
    const bn = `${b.projectName} (${b.serial})`;
    return an.localeCompare(bn);
  });


  const msPerDay = 24 * 60 * 60 * 1000;

  bodyEl.innerHTML = projects.map(p => {
    const title = `${p.projectName} (${p.serial})`;
    const meta = `Material Number: ${p.materialNumber || "-"}`;

    const bars = p.segments.map(seg => {
      const segStart = clamp(seg.start.getTime(), rangeMin.getTime(), rangeMax.getTime());
      const segEnd   = clamp(seg.end.getTime(), rangeMin.getTime(), rangeMax.getTime());

      const leftPx  = ((segStart - rangeMin.getTime()) / msPerDay) * dayW;
      const widthPx = Math.max(10, ((segEnd - segStart) / msPerDay) * dayW);

      const phaseClass = seg.phase === "rework" ? "rework" : "process"; // to change to line stop
      const ongoingClass = seg.ongoing ? "ongoing" : "";
      const stClass = stationClass(seg.station);

      const emp = `${seg.employeeName || "-"} (${seg.employeeNumber || "-"})`;
      const tip =
        `Status: ${seg.ongoing ? "ONGOING" : "COMPLETED"}\n` +
        `Process: ${seg.processLabel}\n` +
        `Station: ${seg.station}\n` +
        `Manpower: ${seg.manpower || "-"}\n` +
        `Duration: ${formatDuration(seg.durationMs)}\n` +
        (seg.remarks ? `Remarks: ${seg.remarks}` : "");

      return `
        <div class="bar ${phaseClass} ${stClass} ${ongoingClass}"
             style="left:${leftPx}px; width:${widthPx}px;"
             data-tip="${escapeAttr(tip)}"></div>
      `;
    }).join("");

    return `
      <div class="ganttRow">
        <div class="ganttLeft">
          <div class="title">${escapeHtml(title)}</div>
          <div class="meta">${escapeHtml(meta)}</div>
        </div>
        <div class="ganttTimeline" style="width:${totalWidthPx}px">${bars}</div>
      </div>
    `;
  }).join("");

  // Ensure ALL timeline rows match total width
  document.querySelectorAll(".ganttTimeline").forEach(tl => {
    tl.style.width = totalWidthPx + "px";
  });

}


function escapeHtml(s) {
  return String(s ?? "")
    .replaceAll("&","&amp;")
    .replaceAll("<","&lt;")
    .replaceAll(">","&gt;")
    .replaceAll('"',"&quot;")
    .replaceAll("'","&#039;");
}
function escapeAttr(s) {
  // for data-tip attribute
  return String(s ?? "").replaceAll('"', "&quot;");
}

/* CSV export (raw events) */
function toCsvValue(v) {
  const s = (v ?? "").toString();
  if (s.includes('"') || s.includes(",") || s.includes("\n")) return `"${s.replaceAll('"','""')}"`;
  return s;
}
function exportRawCsv(events) {
  const headers = [
    "createdAt","serialNumber","projectName","description","materialNumber","model","type","refrigerant",
    "location","status","notes","employeeName","employeeNumber","employeeStation"
  ];
  const lines = [headers.join(",")];

  for (const e of events) {
    const createdAt = tsToDate(e.createdAt);
    const row = [
      createdAt ? formatDateTime(createdAt) : "",
      e.serialNumber, e.projectName, e.description, e.materialNumber, e.model, e.type, e.refrigerant,
      e.location, e.status, e.notes, e.employeeName, e.employeeNumber, e.employeeStation
    ].map(toCsvValue);

    lines.push(row.join(","));
  }

  const blob = new Blob([lines.join("\n")], { type:"text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `processLogs_${new Date().toISOString().slice(0,10)}.csv`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

/* Load + render */
async function loadRuns() {
  const snap = await getDocs(collection(db, "processRuns"));
  const runs = [];
  snap.forEach(d => runs.push({ id: d.id, ...d.data() }));
  cachedEvents = runs;
  return runs;
}


async function render() {
  try {
    console.log("render() start");

    const runs = cachedEvents.length ? cachedEvents : await loadRuns();
    const { segments } = buildSegmentsFromRuns(runs);

    if (!segments.length) {
      monthHeadEl.innerHTML = "";
      dayHeadEl.innerHTML = "";
      bodyEl.innerHTML = "";
      return;
    }

    renderLegendsStationOnly(segments);

    const { min, max } = minMaxFromSegments(segments);
    const mode = el("dateMode").value;
    const range = clampRangeByMode(mode, min, max);

    const rangeMin = startOfDay(range.minDate);
    const rangeMax = endOfDay(range.maxDate);

    const days = buildDateRange(rangeMin, rangeMax);
    const projectMap = buildProjectMap(segments);

    console.log("segments:", segments.length);
    console.log("days:", days.length, "range:", rangeMin, rangeMax);

    renderGantt(projectMap, days, rangeMin, rangeMax);

  } catch (err) {
    console.error(err);
  }
}

/* UI events */
el("btn-refresh").addEventListener("click", async () => {
  try {
    // force fetch again
    cachedEvents = [];
    const runs = await loadRuns();   // <-- this actually calls Firestore
    console.log("Refresh fetched runs:", runs.length);

    // re-render using the new runs we just loaded
    await render();
  } catch (e) {
    console.error("Refresh failed:", e);
    alert("Refresh failed. Check console.");
  }
});

el("dateMode").addEventListener("change", () => render());
el("btn-export").addEventListener("click", () => {
  if (!cachedEvents.length) {
    alert("No data yet. Click Refresh first.");
    return;
  }
  exportRawCsv(cachedEvents);
});

/* Start */
render();

