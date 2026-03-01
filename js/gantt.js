import { loadRuns, clearCache } from "./timeline.js";

/* DOM */
const el = (id) => document.getElementById(id);

const bodyEl = el("ganttBody");
const monthHeadEl = el("ganttMonthHead");
const dayHeadEl = el("ganttDayHead");
const ganttWrapEl = document.querySelector(".ganttWrap");

let cachedEvents = [];
// Cache fetched runs to avoid hitting Firestore on every re-render.

/* Helpers */

function getProcessNo(processLabel){
  const m = String(processLabel || "").trim().match(/^(\d+)/);
  return m ? m[1] : "-";
}

function statusUi(status){
  const s = String(status || "").toLowerCase().trim();
  if (s === "completed") return { text: "Completed", cls: "completed" };
  if (s === "on_hold") return { text: "On Hold", cls: "onhold" };
  return { text: "Running", cls: "running" };
}

function latestSegment(segs){
  return segs.slice().sort((a,b)=>
    ((b.end?.getTime?.()||0)-(a.end?.getTime?.()||0)) ||
    ((b.start?.getTime?.()||0)-(a.start?.getTime?.()||0))
  )[0];
}

function normalizeHoldReason(reason){
  if (!reason) return "";

  const map = {
    rework: "Rework Required",
    item_missing: "Item Missing",
    item_shortage: "Material Shortage",
    resume_tomorrow: "Resume Next Shift / Tomorrow",
    others: "Others"
  };

  const key = String(reason).toLowerCase().trim();

  // if exists in map → use nice label
  if (map[key]) return map[key];

  // fallback: convert item_missing → Item Missing
  return key
    .replaceAll("_"," ")
    .replace(/\b\w/g, c => c.toUpperCase());
}

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

// Update to accept epoch long int
function tsOrMsToDate(ts, ms) {
  if (ts && typeof ts.toDate === "function") return ts.toDate();

  const n = (typeof ms === "number") ? ms
          : (typeof ms === "string" && ms.trim() !== "" && !isNaN(ms)) ? Number(ms)
          : null;

  if (typeof n === "number" && Number.isFinite(n)) return new Date(n);
  return null;
}

function normStation(s){
  return String(s || "").trim().toUpperCase().replace(/\s+/g," ");
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

/* Update here if there are more stations! */
function stationClass(station) {
  const s = String(station || "").toLowerCase().replace(/\s+/g,"");

  if (s.includes("pv1")) return "st1";
  if (s.includes("pv2")) return "st2";
  if (s.includes("pv3")) return "st3";

  return "st1"; // default
}

function startOfDay(d){ const x=new Date(d); x.setHours(0,0,0,0); return x; }

function endOfDay(d){ const x=new Date(d); x.setHours(23,59,59,999); return x; }

function getDayW(){
  // Read CSS variable --dayW so timeline math always matches visual column width.
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
  // Generate one Date object per day to build both headers and pixel positions.
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
  // Group contiguous days by month and make one wide cell per group.
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

function buildSegmentsFromRuns(runs) {
  const segments = [];
  const issues = [];

  for (const r of runs) {
    const serial = r.serialNumber || "";
    const station = r.station || "";

    const start = tsOrMsToDate(r.startAt, r.startEpochMs);

    const statusRaw = String(r.status || "").toLowerCase().trim(); // running / completed / on_hold
    const status =
      (statusRaw === "completed" || statusRaw === "running" || statusRaw === "on_hold")
        ? statusRaw
        : "running";

    // Pick end time based on status:
    const endCompleted = tsOrMsToDate(r.endAt, r.endEpochMs);
    const holdTime = tsOrMsToDate(r.holdAt, r.holdEpochMs);

    let end = null;
    if (status === "completed") end = endCompleted;
    else if (status === "on_hold") end = holdTime || new Date();
    else end = new Date(); // running

    if (!serial || !station || !start) {
      issues.push({ type: "missing_fields", id: r.id, serial, station });
      continue;
    }

    if (end && end.getTime() < start.getTime()) end = new Date(start.getTime());

    const durationMs =
      typeof r.durationMs === "number"
        ? r.durationMs
        : (start && end ? (end.getTime() - start.getTime()) : 0);

    segments.push({
      serial,
      projectName: r.projectName || "(No Project)",
      materialNumber: r.materialNumber || "",
      description: r.description || "",
      station,
      phase: "process",
      processLabel: r.processName || "-",
      manpower: Number(r.manpower ?? 0) || 0,
      remarks: r.remarks || "",
      employeeName: r.startedByName || "",
      employeeNumber: r.startedByNumber || "",
      start,
      end,
      status,
      holdReason: r.holdReason || "",
      holdAt: holdTime || null,

      qrKind: r.qrKind || "",
      chillerSerialNumber: r.chillerSerialNumber || "",
      pvSerialNumber: r.pvSerialNumber || "",
      vesselType: r.vesselType || "",
      coolingType: r.coolingType || "",

      ongoing: (status === "running"),   // only running gets ongoing styling
      durationMs: Math.max(0, durationMs)
    });
  }

  return { segments, issues };
}


/* Project index */
function buildProjectMap(segments) {
  // Group segments by serial number so each project becomes one row.
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


const UNIT_ORDER = ["CHILLER", "EVAPORATOR", "CONDENSER", "OIL SEPARATOR", "ECONOMIZER"];

function unitRank(unitType){
  const u = String(unitType || "").toUpperCase().trim();
  const i = UNIT_ORDER.indexOf(u);
  return i >= 0 ? i : 999;
}

function unitInfoFromSeg(seg){
  // PV
  if (String(seg.qrKind || "").toUpperCase() === "PV") {
    const unitType = String(seg.vesselType || "PV").toUpperCase().trim();
    const unitSerial = seg.pvSerialNumber || seg.serial || "";
    return { unitType, unitSerial };
  }
  // CHILLER
  return { unitType: "CHILLER", unitSerial: seg.chillerSerialNumber || seg.serial || "" };
}

function buildMaterialGroups(segments){
  // key: materialNumber
  // group: { projectName, materialNumber, units: Map(unitKey -> {unitType, unitSerial, segs:[]}) }
  const groups = new Map();

  for (const seg of segments) {
    const materialNumber = seg.materialNumber || "(No Material)";
    const projectName = seg.projectName || "(No Project)";

    const { unitType, unitSerial } = unitInfoFromSeg(seg);
    const unitKey = `${unitType}||${unitSerial}`;

    if (!groups.has(materialNumber)) {
      groups.set(materialNumber, {
        materialNumber,
        projectName,
        units: new Map()
      });
    }

    const g = groups.get(materialNumber);
    if (!g.projectName || g.projectName === "(No Project)") g.projectName = projectName;

    if (!g.units.has(unitKey)) {
      g.units.set(unitKey, { unitType, unitSerial, segs: [] });
    }
    g.units.get(unitKey).segs.push(seg);
  }

  return groups;
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

function renderGantt(days, rangeMin, rangeMax, segments) {
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
  }).join("");

  monthHeadEl.innerHTML = buildMonthHeader(days);

  const dayW = getDayW();
  const totalWidthPx = days.length * dayW;
  const msPerDay = 24 * 60 * 60 * 1000;

  const todayIndex = days.findIndex(d => d.getTime() === today.getTime());
  if (todayIndex >= 0) {
    const leftPx = todayIndex * dayW;
    document.documentElement.style.setProperty("--todayLeft", leftPx + "px");
  }

  monthHeadEl.style.width = totalWidthPx + "px";
  dayHeadEl.style.width = totalWidthPx + "px";

  const headWrap = monthHeadEl.parentElement;
  if (headWrap) headWrap.style.width = totalWidthPx + "px";

  // ---- Group by material number -> units ----
  const groups = buildMaterialGroups(segments);
  const groupArr = Array.from(groups.values()).sort((a,b) =>
    (a.projectName || "").localeCompare(b.projectName || "") ||
    (a.materialNumber || "").localeCompare(b.materialNumber || "")
  );

  bodyEl.innerHTML = groupArr.map(g => {

    // Group header row (Project + Material)
    const headerRow = `
      <div class="ganttRow groupRow">
        <div class="ganttCell project" style="grid-column: 1 / span 3;">
          <div class="groupHeaderRow">
            <div class="title">${escapeHtml(g.projectName)}</div>
            <div class="materialRight">
              <span class="metaLabel">Material Number:</span>
              <b>${escapeHtml(g.materialNumber)}</b>
            </div>
          </div>
        </div>
        <div class="ganttTimeline ${todayIndex >= 0 ? "todayCol" : ""}" style="width:${totalWidthPx}px"></div>
      </div>
    `;

    // Unit child rows
    const units = Array.from(g.units.values()).sort(
      (a,b) => unitRank(a.unitType) - unitRank(b.unitType) || String(a.unitSerial).localeCompare(String(b.unitSerial))
    );

    const unitRows = units.map(u => {
      const cur = latestSegment(u.segs) || null;
      const procNo = getProcessNo(cur?.processLabel);
      const st = statusUi(cur?.status);

      const bars = u.segs
        .filter(seg => !(seg.end.getTime() <= rangeMin.getTime() || seg.start.getTime() >= rangeMax.getTime()))
        .map(seg => {
          const segStart = clamp(seg.start.getTime(), rangeMin.getTime(), rangeMax.getTime());
          const segEnd   = clamp(seg.end.getTime(),   rangeMin.getTime(), rangeMax.getTime());

          const leftPx  = ((segStart - rangeMin.getTime()) / msPerDay) * dayW;
          const widthPx = Math.max(10, ((segEnd - segStart) / msPerDay) * dayW);

          const stClass = stationClass(seg.station);
          const ongoingClass =
            seg.status === "completed" ? "status-completed"
            : seg.status === "on_hold" ? "status-onhold"
            : "status-running";

          return `
            <div class="bar ${stClass} ${seg.ongoing ? "ongoing" : ""} ${ongoingClass}"
                 style="left:${leftPx}px; width:${widthPx}px;"
                 data-tip="${escapeAttr(
                   `Process: ${seg.processLabel || "-"}\n` +
                   `Station: ${seg.station || "-"}\n` +
                   `Status: ${(seg.status || "").replaceAll("_"," ").toUpperCase()}\n` +
                   `Manpower: ${seg.manpower ?? "-"}\n` +
                   `Duration: ${formatDuration(seg.durationMs)}`
                 )}"></div>
          `;
        }).join("");

      return `
        <div class="ganttRow unitRow">
          <div class="ganttCell project">
            <div class="title indent">
              ${escapeHtml(u.unitType)} <span class="meta">(${escapeHtml(u.unitSerial || "-")})</span>
            </div>
          </div>

          <div class="ganttCell procNo">
            <div style="font-weight:900;">${escapeHtml(procNo)}</div>
          </div>

          <div class="ganttCell status">
            <span class="statusPill ${st.cls}">${escapeHtml(st.text)}</span>
          </div>

          <div class="ganttTimeline ${todayIndex >= 0 ? "todayCol" : ""}" style="width:${totalWidthPx}px">
            ${bars}
          </div>
        </div>
      `;
    }).join("");

    return headerRow + unitRows;
  }).join("");

  document.querySelectorAll(".ganttTimeline").forEach(tl => {
    tl.style.width = totalWidthPx + "px";
  });

  // Auto-scroll to today
  if (ganttWrapEl && todayIndex >= 0) {
    const targetLeft = todayIndex * dayW;
    requestAnimationFrame(() => {
      const maxScroll = Math.max(0, ganttWrapEl.scrollWidth - ganttWrapEl.clientWidth);
      ganttWrapEl.scrollLeft = clamp(targetLeft, 0, maxScroll);
    });
  }
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

function exportExcelReport(runs) {
  // Export two sheets: raw runs for detail and summary for station/process totals.
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
    const endCompleted = tsOrMsToDate(r.endAt, r.endEpochMs);
    const holdTime = tsOrMsToDate(r.holdAt, r.holdEpochMs);

    const status = String(r.status || "").toLowerCase().trim();
    const effectiveEnd =
      status === "completed" ? endCompleted
      : status === "on_hold" ? (holdTime || new Date())
      : new Date(); // running

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
      String(r.status || "").replaceAll("_"," ").toUpperCase(),
      start ? formatDateTime(start) : "",
      (status === "completed" && endCompleted) ? formatDateTime(endCompleted)
      : (status === "on_hold" && holdTime) ? formatDateTime(holdTime)
      : "",
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

async function render() {
  try {
    const runs = await loadRuns();

    if (!runs.length) {
      bodyEl.innerHTML = "";
      monthHeadEl.innerHTML = "";
      dayHeadEl.innerHTML = "";
      return;
    }

    const { segments } = buildSegmentsFromRuns(runs);
    renderLegendsStationOnly(segments);

    const { min, max } = minMaxFromSegments(segments);
    const mode = el("dateMode").value;
    const range = clampRangeByMode(mode, min, max);

    const rangeMin = startOfDay(range.minDate);
    const rangeMax = endOfDay(range.maxDate);

    const days = buildDateRange(rangeMin, rangeMax);

    renderGantt(days, rangeMin, rangeMax, segments);

  } catch (err) {
    console.error(err);
  }
}

/* UI events */
el("btn-refresh").addEventListener("click", async () => {
  clearCache();
  await render();
});

el("dateMode").addEventListener("change", () => render());

el("btn-export").addEventListener("click", async () => {
  // Ensure we have the latest data (so export always includes newest runs)
  const runs = await loadRuns();   // reload from Firestore
  exportExcelReport(runs);
});

/* Start */
async function renderGanttView() {
  console.log("GANTT RENDER CALLED");
  await render();
}

export { renderGanttView };
