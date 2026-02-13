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

function minutesFromMs(ms) {
  if (!ms || ms <= 0) return 0;
  return Math.round(ms / 60000);
}

function manHoursFromMs(ms, manpower) {
  const mp = Number(manpower || 0);
  if (!ms || ms <= 0 || mp <= 0) return 0;
  return (ms / 3600000) * mp; // hours * manpower
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

function exportExcelReport(runs) {
  if (typeof XLSX === "undefined") {
    alert("XLSX library not loaded. Check the xlsx script tag in index.html.");
    return;
  }

  // ---------- Build RAW sheet ----------
  const rawHeader = [
    "projectName",
    "description",
    "serialNumber",
    "materialNumber",
    "process",
    "station",
    "manpower",
    "status",
    "startAt",
    "endAt",
    "duration_minutes",
    "man_hours"
  ];

  const rawRows = [rawHeader];

  // Summary accumulator: key = station||process
  const summaryMap = new Map();

  for (const r of runs) {
    const start = tsOrMsToDate(r.startAt, r.startEpochMs);
    const end = tsOrMsToDate(r.endAt, r.endEpochMs);

    const status = String(r.status || "").toLowerCase(); // running / completed
    const ongoing = status === "running" || !end;

    // Decide how to treat running rows:
    // - For RAW: show endAt empty (and duration as up-to-now)
    // - For SUMMARY: include running up-to-now (you can change to exclude if you want)
    const effectiveEnd = ongoing ? new Date() : end;

    let durationMs = 0;
    if (start && effectiveEnd) durationMs = Math.max(0, effectiveEnd.getTime() - start.getTime());

    const durationMin = minutesFromMs(durationMs);
    const mh = manHoursFromMs(durationMs, r.manpower);

    rawRows.push([
      r.projectName || "",
      r.description || "",
      r.serialNumber || "",
      r.materialNumber || "",
      r.processName || "",
      r.station || "",
      r.manpower ?? "",
      r.status || "",
      start ? formatDateTime(start) : "",
      (!ongoing && end) ? formatDateTime(end) : "",
      durationMin,
      mh.toFixed(2)
    ]);

    // ---------- Build SUMMARY ----------
    const station = r.station || "(No Station)";
    const proc = r.processName || "(No Process)";
    const key = `${station}||${proc}`;

    if (!summaryMap.has(key)) {
      summaryMap.set(key, {
        station,
        process: proc,
        runs: 0,
        totalMinutes: 0,
        totalManHours: 0,
        totalManpowerCounted: 0
      });
    }

    const agg = summaryMap.get(key);
    agg.runs += 1;
    agg.totalMinutes += durationMin;
    agg.totalManHours += mh;
    agg.totalManpowerCounted += Number(r.manpower || 0);
  }

  // Convert summaryMap -> rows sorted by station then process
  const summaryHeader = [
    "station",
    "process",
    "runs",
    "total_minutes",
    "total_hours",
    "total_man_hours"
  ];

  const summaryRows = [summaryHeader];

  const summaryArr = Array.from(summaryMap.values()).sort((a, b) => {
    return a.station.localeCompare(b.station) || a.process.localeCompare(b.process);
  });

  for (const s of summaryArr) {
    const totalHours = s.totalMinutes / 60;
    summaryRows.push([
      s.station,
      s.process,
      s.runs,
      s.totalMinutes,
      totalHours.toFixed(2),
      s.totalManHours.toFixed(2)
    ]);
  }

  // ---------- Create workbook ----------
  const wb = XLSX.utils.book_new();

  const wsRaw = XLSX.utils.aoa_to_sheet(rawRows);
  const wsSummary = XLSX.utils.aoa_to_sheet(summaryRows);

  // Optional: a bit nicer column widths
  wsRaw["!cols"] = [
    { wch: 18 }, // projectName
    { wch: 18 }, // description
    { wch: 14 }, // serialNumber
    { wch: 14 }, // materialNumber
    { wch: 22 }, // process
    { wch: 10 }, // station
    { wch: 10 }, // manpower
    { wch: 10 }, // status
    { wch: 20 }, // startAt
    { wch: 20 }, // endAt
    { wch: 16 }, // duration_minutes
    { wch: 12 }  // man_hours
  ];

  wsSummary["!cols"] = [
    { wch: 10 }, // station
    { wch: 28 }, // process
    { wch: 8 },  // runs
    { wch: 14 }, // total_minutes
    { wch: 12 }, // total_hours
    { wch: 16 }  // total_man_hours
  ];

  XLSX.utils.book_append_sheet(wb, wsRaw, "RawRuns");
  XLSX.utils.book_append_sheet(wb, wsSummary, "Summary");

  const filename = `ProcessReport_${new Date().toISOString().slice(0,10)}.xlsx`;
  XLSX.writeFile(wb, filename);
}


function exportRawCsv(runs) {

  const headers = [
    "projectName",
    "description",
    "serialNumber",
    "materialNumber",
    "process",
    "station",
    "manpower",
    "startAt",
    "endAt",
    "duration_minutes",
    "total_man_hours"
  ];

  const lines = [headers.join(",")];

  for (const r of runs) {

    const start = tsOrMsToDate(r.startAt, r.startEpochMs);
    const end   = tsOrMsToDate(r.endAt, r.endEpochMs);

    let durationMin = "";
    let manHours = "";

    if (start && end) {
      const durationMs = end - start;
      durationMin = Math.round(durationMs / 60000);

      const manpower = Number(r.manpower || 0);
      manHours = ((durationMs / 3600000) * manpower).toFixed(2); 
      // hours × manpower
    }

    const row = [
      r.projectName || "",
      r.description || "",
      r.serialNumber || "",
      r.materialNumber || "",
      r.processName || "",
      r.station || "",
      r.manpower ?? "",
      start ? formatDateTime(start) : "",
      end ? formatDateTime(end) : "",
      durationMin,
      manHours
    ].map(v => `"${String(v).replaceAll('"','""')}"`);

    lines.push(row.join(","));
  }

  const blob = new Blob([lines.join("\n")], { type:"text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);

  const a = document.createElement("a");
  a.href = url;
  a.download = `processRuns_${new Date().toISOString().slice(0,10)}.csv`;
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

el("btn-export").addEventListener("click", async () => {
  // Ensure we have the latest data (so export always includes newest runs)
  const runs = await loadRuns();   // reload from Firestore
  exportExcelReport(runs);
});

/* Start */
render();

