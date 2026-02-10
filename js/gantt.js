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


/* Helpers */

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
  const s = (station || "").toLowerCase().replace(/\s+/g, "");

  if (s.includes("station1") || s === "1" || s === "st1") return "st1";
  if (s.includes("station2") || s === "2" || s === "st2") return "st2";
  if (s.includes("station3") || s === "3" || s === "st3") return "st3";

  return "st2";
}

function tsToDate(ts) {
  if (!ts) return null;
  if (typeof ts.toDate === "function") return ts.toDate();
  if (typeof ts === "number") return new Date(ts);
  return null;
}

function normalizeStatus(s) { return (s || "").trim().toLowerCase(); }
function getPhaseFromStatus(status) {
  const s = normalizeStatus(status);
  return s.includes("rework") ? "rework" : "process";
}
function isStartStatus(s) {
  const t = normalizeStatus(s);
  return t === "start process" || t === "start rework";
}
function isEndStatus(s) {
  const t = normalizeStatus(s);
  return t === "end process" || t === "end rework";
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

function buildSegmentsFromEvents(events) {
  const groups = new Map();

  for (const e of events) {
    const serial = e.serialNumber;
    const station = e.location;
    const phase = getPhaseFromStatus(e.status);
    const createdAt = tsToDate(e.createdAt);
    if (!serial || !station || !createdAt) continue;

    const k = keyOf(serial, station, phase);
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k).push({ ...e, _t: createdAt, _phase: phase });
  }

  const segments = [];
  const issues = [];

  for (const [k, arr] of groups.entries()) {
    arr.sort((a,b) => a._t - b._t);

    let startEv = null;

    for (const ev of arr) {
      if (isStartStatus(ev.status)) {
        startEv = ev;
      } else if (isEndStatus(ev.status)) {
        if (!startEv) {
          issues.push({ type:"end_without_start", serialNumber: ev.serialNumber, station: ev.location, phase: ev._phase });
          continue;
        }

        const start = new Date(startEv._t);
        const end = new Date(ev._t);
        if (end < start) {
          issues.push({ type:"end_before_start", serialNumber: ev.serialNumber, station: ev.location, phase: ev._phase });
          startEv = null;
          continue;
        }

        segments.push({
          serial: ev.serialNumber,
          projectName: ev.projectName || startEv.projectName || "(No Project)",
          materialNumber: ev.materialNumber || startEv.materialNumber || "",
          station: ev.location,
          phase: ev._phase, // "process" | "rework"
          employeeName: startEv.employeeName || ev.employeeName || "",
          employeeNumber: startEv.employeeNumber || ev.employeeNumber || "",
          start,
          end,
          ongoing: false
        });

        startEv = null;
      }
    }

    if (startEv) {
      segments.push({
        serial: startEv.serialNumber,
        projectName: startEv.projectName || "(No Project)",
        materialNumber: startEv.materialNumber || "",
        station: startEv.location,
        phase: startEv._phase,
        employeeName: startEv.employeeName || "",
        employeeNumber: startEv.employeeNumber || "",
        start: new Date(startEv._t),
        end: new Date(),          // show until now
        ongoing: true
      });
    }
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

function renderGantt(projectMap, days, rangeMin, rangeMax) {
  // 1) Build headers
  dayHeadEl.innerHTML = days.map(d => `
    <div class="dayCol">
      <div class="d1">${dateKey(d)}</div>
      <div class="d2">${weekdayName(d)}</div>
    </div>
  `).join("");

  monthHeadEl.innerHTML = buildMonthHeader(days);

  // 2) Compute widths ONCE
  const dayW = getDayW();
  const totalWidthPx = days.length * dayW;

  // (keep this if you still use --days in CSS)
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

      const phaseClass = seg.phase === "rework" ? "rework" : "process";
      const ongoingClass = seg.ongoing ? "ongoing" : "";
      const stClass = stationClass(seg.station);

      const emp = `${seg.employeeName || "-"} (${seg.employeeNumber || "-"})`;
      const tip =
        `Phase: ${seg.phase.toUpperCase()}\n` +
        `Station: ${seg.station}\n` +
        `Employee: ${emp}\n` +
        `Start: ${formatDateTime(seg.start)}\n` +
        `End: ${seg.ongoing ? "(Ongoing)" : formatDateTime(seg.end)}`;

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
async function loadEvents() {
  const snap = await getDocs(collection(db, "processLogs"));
  const events = [];
  snap.forEach(d => events.push(d.data()));
  cachedEvents = events;
  console.log("Total docs:", events.length);
  console.log("Sample doc:", events[0]);
  return events;
}

async function render() {
  try {
    console.log("render() start");
    const events = cachedEvents.length ? cachedEvents : await loadEvents();
    const { segments, issues } = buildSegmentsFromEvents(events);

    if (!segments.length) {
      monthHeadEl.innerHTML = "";
      dayHeadEl.innerHTML = "";
      bodyEl.innerHTML = "";
      return;
    }

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
  cachedEvents = [];
  await render();
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
