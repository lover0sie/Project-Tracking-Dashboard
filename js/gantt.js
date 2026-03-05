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

const TZ = "Asia/Kuala_Lumpur";
const START_HOUR = 7;
const END_HOUR = 22;

function tipTextBuilder(seg, sliceStart, sliceEnd, partType) {

  const isWaiting = partType === "waiting" || seg.phase === "waiting";

  // --- WAITING TOOLTIP ---
  if (isWaiting) {
    return (
      `Process: WAITING\n` +
      `From: ${formatDateTime(sliceStart)}\n` +
      `To: ${formatDateTime(sliceEnd)}\n` +
      `Duration: ${formatDuration(sliceEnd.getTime() - sliceStart.getTime())}`
    );
  }

  // --- NORMAL PROCESS TOOLTIP ---
  const startedLine =
    `Started: ${seg.employeeName || "-"} (${seg.employeeNumber || "-"})`;

  const resumedLine =
    seg.resumedAt
      ? `Resumed: ${seg.resumedByName || "-"} (${seg.resumedByNumber || "-"})`
      : `Resumed: -`;

  const holdLine =
    seg.status === "on_hold"
      ? `\nHold Reason: ${
          seg.holdReason === "others" && seg.remarks
            ? seg.remarks
            : (normalizeHoldReason(seg.holdReason) || "-")
        }`
      : "";

  return (
    `${startedLine}\n` +
    /* `${resumedLine}\n` + */
    `Process: ${seg.processLabel || "-"}\n` +
    `Manpower: ${seg.manpower ?? "-"}\n` +
    `From: ${formatDateTime(sliceStart)}\n` +
    `To: ${formatDateTime(sliceEnd)}\n` +
    `Duration: ${formatDuration(sliceEnd.getTime() - sliceStart.getTime())}` +
    holdLine
  );
}

function fitDailyToScreen(){
  // only in daily mode
  const mode = el("dateMode")?.value || "daily";
  if (mode !== "daily") return;

  const hoursCount = (END_HOUR - START_HOUR) + 1; // 16

  // left sticky columns width from CSS variables
  const rootStyle = getComputedStyle(document.documentElement);
  const colProject = parseFloat(rootStyle.getPropertyValue("--colProject")) || 260;
  const colProc    = parseFloat(rootStyle.getPropertyValue("--colProc")) || 120;
  const colStatus  = parseFloat(rootStyle.getPropertyValue("--colStatus")) || 110;

  // available width inside your card (use ganttWrap width)
  const wrap = document.querySelector(".ganttWrap");
  if (!wrap) return;

  const wrapWidth = wrap.clientWidth;

  // timeline area width = wrap - left columns
  const timelineWidth = Math.max(300, wrapWidth - (colProject + colProc + colStatus));

  // compute hour width, clamp so it doesn’t become too tiny/huge
  const hourW = Math.max(40, Math.min(120, Math.floor(timelineWidth / hoursCount)));

  document.documentElement.style.setProperty("--hourW", hourW + "px");
}

function elapsedDuration(seg){
  if(!seg?.start) return 0;

  const endTime =
    seg.status === "running"
      ? Date.now()
      : seg.end?.getTime();

  return endTime - seg.start.getTime();
}

function activeDurationMs(seg){
  const base = Number(seg?.durationMs || 0); // stored accumulated active time

  if (!seg) return 0;

  // If currently running, add time since last resume (or since start if never resumed)
  if (seg.status === "running") {
    const anchor = seg.resumedAt || seg.start;
    const extra = anchor ? Math.max(0, Date.now() - anchor.getTime()) : 0;
    return base + extra;
  }

  // on_hold / completed -> durationMs already represents active time until hold/end
  return base;
}

function sliceSegForWaiting(seg){
  // returns parts: active/waiting/active based on holdAt + resumedAt
  const parts = [];
  const s = seg.start;
  const e = seg.end;
  if (!s || !e) return parts;

  const h = seg.holdAt;
  const r = seg.resumedAt;

  // no hold/resume => one active part
  if (!h || !r || r.getTime() <= h.getTime()) {
    parts.push({ type:"process", start:s, end:e });
    return parts;
  }

  // active from start -> hold
  if (h.getTime() > s.getTime()) parts.push({ type:"process", start:s, end:h });

  // waiting from hold -> resume
  parts.push({ type:"waiting", start:h, end:r });

  // active from resume -> end
  if (e.getTime() > r.getTime()) parts.push({ type:"process", start:r, end:e });

  return parts;
}


function getHourW(){
  // Sset this in CSS: :root{ --hourW: 90px; }
  const v = getComputedStyle(document.documentElement).getPropertyValue("--hourW").trim();
  return Number(v.replace("px","")) || 90;
}


function startOfWorkDay(d){
  const x = new Date(d);
  x.setHours(START_HOUR, 0, 0, 0);
  return x;
}

function endOfWorkDay(d){
  const x = new Date(d);
  x.setHours(END_HOUR, 0, 0, 0);
  return x;
}

function hourLabel(h){
  // h in 24h
  const isPM = h >= 12;
  const twelve = (h % 12) || 12;
  return `${twelve}:00 ${isPM ? "PM" : "AM"}`;
}


function getProcessNo(processLabel){
  if(!processLabel) return "";

  // Special case

  if (processLabel.toLowerCase() === "piping shop") { return "Piping Shop";}

  const nums = processLabel.split("-")[0];
  return nums.replace(/\s+/g,"");
}

function statusUi(status){
  const s = String(status || "").toLowerCase().trim();
  if (s === "completed") return { text: "Completed", cls: "completed" };
  if (s === "on_hold") return { text: "On Hold", cls: "onhold" };
  if (s === "waiting") return { text: "Waiting", cls: "waiting" };
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
    others: "Others",
    browser_closed: "Auto Hold (Browser Closed / Tab Closed)"
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

function formatDateTime(d){
  if(!d) return "-";

  return new Intl.DateTimeFormat("en-GB",{
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
    hour12: true
  }).format(d);
}

function formatStopText(seg){
  if(!seg) return "-";

  // if still running → no stop time yet
  if(seg.status === "running"){
    return "-";
  }

  return formatDateTime(seg.end);
}

/* Update here if there are more stations! */
function stationClass(station) {
  const s = String(station || "").toLowerCase().replace(/\s+/g,"");

  if (s.includes("pv1")) return "st-pv1"; // PV 1
  if (s.includes("pv2")) return "st-pv2"; // PV 2
  if (s.includes("subassy") || s.includes ("sub")) return "st-subassy"; // Sub Assy
  if (s.includes("pipingshop") || s.includes("piping")) return "st-piping"; // Piping Shop
  if (s.includes("fabrication")) return "st-fabrication";
  if (s.includes ("pneumatic")) return "st-pneumatic"; // Pneumatic + Paint booth + Hydro
  return "st-pv1"; // default
}

function startOfDay(d){ const x=new Date(d); x.setHours(0,0,0,0); return x; }

function endOfDay(d){ const x=new Date(d); x.setHours(23,59,59,999); return x; }

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

function buildHourHeader(){
  const hourW = getHourW();
  const cells = [];
  for (let h = START_HOUR; h <= END_HOUR; h++){
    cells.push(`
      <div class="dayCol" style="width:${hourW}px; flex:0 0 ${hourW}px;">
        <div class="d1">${hourLabel(h)}</div>
        <div class="d2"></div>
      </div>
    `);
  }
  return cells.join("");
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

function getMYTodayKey(){
  return new Intl.DateTimeFormat("en-CA", { timeZone: TZ }).format(new Date()); // YYYY-MM-DD
}

function parseDayKeyToDate(dayKey){
  // dayKey = YYYY-MM-DD
  const [y,m,d] = dayKey.split("-").map(Number);
  return new Date(y, m-1, d);
}

function fmtDailyHeader(dayKey){
  const d = parseDayKeyToDate(dayKey);
  const label = new Intl.DateTimeFormat("en-GB", {
    timeZone: TZ, weekday:"long", day:"2-digit", month:"2-digit", year:"numeric"
  }).format(d);
  return `${label} (07:00–22:00)`;
}

function buildSegmentsFromRuns(runs) {
  const segments = [];
  const issues = [];

  for (const r of runs) {
    const serial = r.serialNumber || "";
    const station = r.station || "";

    const start = tsOrMsToDate(r.startAt, r.startEpochMs);
    const resumed = tsOrMsToDate(r.resumedAt, r.resumedEpochMs);

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
      resumedByName: r.resumedByName || "",
      resumedByNumber: r.resumedByNumber || "",
      start,
      end,
      status,
      holdReason: r.holdReason || "",
      holdAt: holdTime || null,
      resumedAt: resumed || null,

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
  const groups = new Map();

  for (const seg of segments) {
    const materialNumber = seg.materialNumber || "(No Material)";
    const projectName = seg.projectName || "(No Project)";
    const chillerSerialNumber = seg.chillerSerialNumber || "(No Serial Num)";

    const { unitType, unitSerial } = unitInfoFromSeg(seg);
    const unitKey = `${unitType}||${unitSerial}`;

    if (!groups.has(materialNumber)) {
      groups.set(materialNumber, {
        materialNumber,
        projectName,
        chillerSerialNumber,     // ✅ store it here
        units: new Map()
      });
    }

    const g = groups.get(materialNumber);

    if (!g.projectName || g.projectName === "(No Project)") g.projectName = projectName;

    //  keep the first non-empty chiller serial number
    if (!g.chillerSerialNumber || g.chillerSerialNumber === "(No Serial Num)") {
      g.chillerSerialNumber = chillerSerialNumber;
    }

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

function renderLegendsStationOnly(segments){
  const stEl = document.getElementById("legendStations");
  if (!stEl) return;

  const uniq = [...new Set(segments.map(s => s.station))].sort();

  stEl.innerHTML = uniq.map(st =>
    `<span class="legItem">
      <span class="swatch ${stationClass(st)}"></span>
      ${escapeHtml(st)}
    </span>`
  ).join("");
}

/* Position bars by time */
function clamp(n, a, b) { return Math.max(a, Math.min(b, n)); }

function buildSplitBarsHtml({ seg, rangeMin, rangeMax, unitMs, unitW, stationCls, statusCls, tipTextBuilder }) {
  const parts = [];

  function makeBar(startMs, endMs, extraCls = "") {
    const a = clamp(startMs, rangeMin.getTime(), rangeMax.getTime());
    const b = clamp(endMs,   rangeMin.getTime(), rangeMax.getTime());
    if (b <= a) return "";

    const leftPx  = ((a - rangeMin.getTime()) / unitMs) * unitW;
    const widthPx = Math.max(8, ((b - a) / unitMs) * unitW);

    return `
      <div class="bar ${stationCls} ${statusCls} ${extraCls}"
           style="left:${leftPx}px; width:${widthPx}px;"
           data-tip="${escapeAttr(tipTextBuilder(seg, new Date(a), new Date(b), extraCls))}">
      </div>
    `;
  }

  const startMs = seg.start?.getTime?.() ?? null;
  const endMs   = seg.end?.getTime?.() ?? null;
  if (startMs == null || endMs == null) return "";

  const holdMs   = seg.holdAt?.getTime?.() ?? null;
  const resumeMs = seg.resumedAt?.getTime?.() ?? null;

  // Only split when we have a proper hold→resume gap in-between
  const canSplit =
    holdMs != null &&
    resumeMs != null &&
    holdMs > startMs &&
    resumeMs > holdMs;

  if (canSplit) {
    parts.push(makeBar(startMs, holdMs, "active"));
    parts.push(makeBar(holdMs, resumeMs, "waiting"));
    parts.push(makeBar(resumeMs, endMs, "active"));
  } else {
    parts.push(makeBar(startMs, endMs, "active"));
  }

  return parts.join("");
}

function withWaitingSegments(segs){
  // Input: process segments only (phase="process")
  // Output: process + synthetic waiting segments inserted between them (per unit)
  const out = [];

  const items = segs
    .filter(s => s && s.start && s.end)
    .slice()
    .sort((a,b) => a.start.getTime() - b.start.getTime());

  for (let i = 0; i < items.length; i++) {
    const cur = items[i];
    out.push(cur);

    const next = items[i + 1];
    if (!next) continue;

    // waiting between cur.end -> next.start
    const a = cur.end.getTime();
    const b = next.start.getTime();

    if (b > a) {
      out.push({
        ...cur,                     // inherit unit/project fields
        phase: "waiting",
        processLabel: "WAITING",    // so process parsing doesn’t show ",,,,"
        status: "waiting",
        station: "",                // not a station color
        manpower: 0,
        start: new Date(a),
        end: new Date(b),
        ongoing: false
      });
    }
  }

  return out;
}

function buildLanes(segs){
  // Sort by start time
  const sorted = segs.slice().sort((a,b) => a.start - b.start);

  const lanes = []; // each lane is { endMs:number, segs:[] }

  for (const seg of sorted) {
    const s = seg.start.getTime();
    const e = seg.end.getTime();

    // try place into an existing lane
    let placed = false;
    for (const lane of lanes) {
      if (s >= lane.endMs) {
        lane.segs.push(seg);
        lane.endMs = Math.max(lane.endMs, e);
        placed = true;
        break;
      }
    }

    // otherwise create a new lane
    if (!placed) {
      lanes.push({ endMs: e, segs: [seg] });
    }
  }

  return lanes.map(l => l.segs);
}

function renderGanttDaily(rangeMin, rangeMax, segments) {
  
  // disable monthly today highlight
  document.documentElement.style.setProperty("--todayLeft", "-9999px");
  document.querySelectorAll(".todayCol").forEach(el => el.classList.remove("todayCol"));
  
  // This writes into the SAME ganttMonthHead/ganttDayHead/ganttBody
  const hourW = getHourW();
  document.documentElement.style.setProperty("--colW", hourW + "px");
  document.documentElement.style.setProperty("--minorDiv", "2"); // 30-min lines
  
  const msPerHour = 3600000;

  // No month grouping in daily
  monthHeadEl.innerHTML = "";
  dayHeadEl.innerHTML = buildHourHeader();

  const hoursCount = (END_HOUR - START_HOUR) + 1;
  const totalWidthPx = hoursCount * hourW;

  monthHeadEl.style.width = totalWidthPx + "px";
  dayHeadEl.style.width = totalWidthPx + "px";

  const headWrap = monthHeadEl.parentElement;
  if (headWrap) headWrap.style.width = totalWidthPx + "px";

  // ---- Same grouping as your multi-day gantt ----
  const groups = buildMaterialGroups(segments);
  const groupArr = Array.from(groups.values()).sort((a,b) =>
    (a.projectName || "").localeCompare(b.projectName || "") ||
    (a.materialNumber || "").localeCompare(b.materialNumber || "")
  );

  bodyEl.innerHTML = groupArr.map(g => {

    const headerRow = `
      <div class="ganttRow groupRow">
        <div class="ganttCell project" style="grid-column: 1 / span 3;">
          <div class="groupHeaderRow">
            <div class="title">${escapeHtml(g.projectName)}</div>
            <div class="materialRight">
              <b>${escapeHtml(g.materialNumber || "-")}</b>
              <span class="divider">|</span>
              <b>${escapeHtml(g.chillerSerialNumber || "-")}</b>
            </div>
          </div>
        </div>
        <div class="ganttTimeline dailyGrid" style="width:${totalWidthPx}px"></div>
      </div>
    `;

    const units = Array.from(g.units.values()).sort(
      (a,b) => unitRank(a.unitType) - unitRank(b.unitType) ||
               String(a.unitSerial).localeCompare(String(b.unitSerial))
    );

   const unitRows = units.map(u => {
      const segs = withWaitingSegments(
        u.segs.filter(seg =>
          seg.end.getTime() > rangeMin.getTime() &&
          seg.start.getTime() < rangeMax.getTime()
        )
      );

      const lanes = buildLanes(segs);
      const laneCount = Math.max(1, lanes.length);

      //  merged UNIT cell (shown once)
      const unitCellHtml = `
        <div class="ganttCell project unitMerged" style="--laneCount:${laneCount}">
          <div class="title indent">
            ${escapeHtml(u.unitType)} <span class="meta">(${escapeHtml(u.unitSerial || "-")})</span>
          </div>
        </div>
      `;

      // right side rows: each lane gets its own PROC/STATUS/TIMELINE row
      const laneRowsHtml = lanes.map((laneSegs) => {
        const cur = latestSegment(laneSegs) || null;
        const procNo = getProcessNo(cur?.processLabel);
        const st = statusUi(cur?.status);

        const bars = laneSegs.map(seg => {

        const segStart = clamp(seg.start.getTime(), rangeMin.getTime(), rangeMax.getTime());
        const segEnd   = clamp(seg.end.getTime(), rangeMin.getTime(), rangeMax.getTime());

        const leftPx  = ((segStart - rangeMin.getTime()) / 3600000) * hourW;
        const widthPx = Math.max(10, ((segEnd - segStart) / 3600000) * hourW);

        const isWaiting = seg.phase === "waiting";

        const stClass = isWaiting
          ? "st-waiting"
          : stationClass(seg.station);

        const statusCls =
          isWaiting ? "status-waiting"
          : seg.status === "completed" ? "status-completed"
          : seg.status === "on_hold" ? "status-onhold"
          : "status-running";

        const tipText = tipTextBuilder(seg, seg.start, seg.end, isWaiting ? "waiting" : "process");

        return `
          <div class="bar ${stClass} ${statusCls}"
              style="left:${leftPx}px; width:${widthPx}px;"
              data-tip="${escapeAttr(tipText)}">
          </div>
        `;

      }).join("");

        return `
          <div class="unitLaneRow">
            <div class="ganttCell procNo">
              <div style="font-weight:900;">${escapeHtml(procNo)}</div>
            </div>

            <div class="ganttCell status">
              <span class="statusPill ${st.cls}">${escapeHtml(st.text)}</span>
            </div>

            <div class="ganttTimeline dailyGrid" style="width:${totalWidthPx}px">
              ${bars}
            </div>
          </div>
        `;
      }).join("");

      return `
        <div class="unitBlock" style="--laneCount:${laneCount}">
          ${unitCellHtml}
          <div class="unitLaneRows">
            ${laneRowsHtml}
          </div>
        </div>
      `;
    }).join("");

    return headerRow + unitRows;
  }).join("");

  function drawNowLine(rangeMin, rangeMax, hourW){

    const now = new Date();

    if(now < rangeMin || now > rangeMax) return;

    const msPerHour = 3600000;

    const leftPx =
      ((now.getTime() - rangeMin.getTime()) / msPerHour) * hourW;

    document.querySelectorAll(".ganttTimeline").forEach(tl => {

      const line = document.createElement("div");
      line.className = "nowLine";
      line.style.left = leftPx + "px";

      tl.appendChild(line);

    });

  }

  drawNowLine(rangeMin, rangeMax, hourW);

  document.querySelectorAll(".ganttTimeline").forEach(tl => {
    tl.style.width = totalWidthPx + "px";
  });

  // Auto-scroll to "now" if within 07:00–22:00
  if (ganttWrapEl) {
    const now = Date.now();
    if (now >= rangeMin.getTime() && now <= rangeMax.getTime()) {
      const leftPx = ((now - rangeMin.getTime()) / msPerHour) * hourW;
      requestAnimationFrame(() => {
        const maxScroll = Math.max(0, ganttWrapEl.scrollWidth - ganttWrapEl.clientWidth);
        ganttWrapEl.scrollLeft = clamp(leftPx - 200, 0, maxScroll);
      });
    }
  }
}

function renderGantt(days, rangeMin, rangeMax, segments, dom) {
  if (!bodyEl || !monthHeadEl || !dayHeadEl) return; 

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
  document.documentElement.style.setProperty("--colW", dayW + "px");
  document.documentElement.style.setProperty("--minorDiv", "1"); // no half-day lines
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
              <b>${escapeHtml(g.materialNumber || "-")}</b>
              <span class="divider">|</span>
              <b>${escapeHtml(g.chillerSerialNumber || "-")}</b>
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
  const parts = sliceSegForWaiting(seg);

  return parts
    .filter(p => !(p.end.getTime() <= rangeMin.getTime() || p.start.getTime() >= rangeMax.getTime()))
    .map(p => {
          const sliceStart = new Date(Math.max(p.start.getTime(), rangeMin.getTime()));
          const sliceEnd   = new Date(Math.min(p.end.getTime(),   rangeMax.getTime()));

          const segStart = clamp(sliceStart.getTime(), rangeMin.getTime(), rangeMax.getTime());
          const segEnd   = clamp(sliceEnd.getTime(),   rangeMin.getTime(), rangeMax.getTime());

          const leftPx  = ((segStart - rangeMin.getTime()) / msPerDay) * dayW;
          const widthPx = Math.max(10, ((segEnd - segStart) / msPerDay) * dayW);

          const isWaiting = (p.type === "waiting");
          const stClass   = isWaiting ? "st-waiting" : stationClass(seg.station);
          const statusCls = isWaiting ? "status-waiting"
                          : seg.status === "completed" ? "status-completed"
                          : seg.status === "on_hold" ? "status-onhold"
                          : "status-running";

          const tipText = tipTextBuilder(seg, sliceStart, sliceEnd, isWaiting ? "waiting" : "process");

          return `
            <div class="bar ${stClass} ${statusCls}"
                style="left:${leftPx}px; width:${widthPx}px;"
                data-tip="${escapeAttr(tipText)}"></div>
          `;
        })
        .join("");
    })
    .join("")

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

    // Build segments FIRST (so both daily + monthly can use it)
    const { segments } = buildSegmentsFromRuns(runs);
    renderLegendsStationOnly(segments);

    const mode = el("dateMode")?.value || "daily";

    // DAILY MODE
    if (mode === "daily") {
      const picker = el("dayPicker");
      const todayKey = getMYTodayKey();
      if (picker && !picker.value) picker.value = todayKey;

      const dayDate = parseDayKeyToDate(picker?.value || todayKey);

      const rangeMin = startOfWorkDay(dayDate);
      const rangeMax = endOfWorkDay(dayDate);
      
      const hourW = getHourW();
      document.documentElement.style.setProperty("--colW", hourW + "px");
      document.documentElement.style.setProperty("--minorDiv", "2");

      const segsInWindow = segments.filter(s =>
        s.end.getTime() > rangeMin.getTime() && s.start.getTime() < rangeMax.getTime()
      );

      fitDailyToScreen();

      renderGanttDaily(rangeMin, rangeMax, segsInWindow);
      return;
    }
  
    // MONTHLY MODE
    if (mode === "month") {
      // monthly uses monthPicker (YYYY-MM)
      const mp = el("monthPicker");
      const now = new Date();
      const def = `${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,"0")}`;
      if (mp && !mp.value) mp.value = def;

      const [yy, mm] = (mp?.value || def).split("-").map(Number);
      const monthStart = new Date(yy, mm-1, 1);
      const monthEnd = new Date(yy, mm, 0); // last day of month

      const dayW = getDayW();
      document.documentElement.style.setProperty("--colW", dayW + "px");
      document.documentElement.style.setProperty("--minorDiv", "1");

      const rangeMin = startOfDay(monthStart);
      const rangeMax = endOfDay(monthEnd);

      const days = buildDateRange(rangeMin, rangeMax);
      renderGantt(days, rangeMin, rangeMax, segments);
      return;
    }

  } catch (err) {
    console.error(err);
  }
}

function syncPickers(){
  const mode = el("dateMode")?.value || "daily";

  const daySlot = el("daySlot");
  const monthSlot = el("monthSlot");
  const btnToday = el("btnToday");

  if (daySlot) daySlot.classList.toggle("hidden", mode !== "daily");
  if (monthSlot) monthSlot.classList.toggle("hidden", mode !== "month");

  // TODAY button only for month mode
  if (btnToday) btnToday.classList.toggle("hidden", mode !== "month");
}

syncPickers();

el("dateMode")?.addEventListener("change", () => {
  syncPickers();
  render();
});
   

/* UI events */
el("btn-refresh")?.addEventListener("click", async () => {
  clearCache();
  await render();
});

el("dateMode").addEventListener("change", () => render());

el("btn-export").addEventListener("click", async () => {
  // Ensure we have the latest data (so export always includes newest runs)
  const runs = await loadRuns();   // reload from Firestore
  exportExcelReport(runs);
});

el("dayPicker")?.addEventListener("change", () => render());

el("monthPicker")?.addEventListener("change", () => render());

el("btnToday")?.addEventListener("click", () => {
  const today = new Date();
  const monthStr = today.toISOString().slice(0,7); // YYYY-MM
  el("monthPicker").value = monthStr;
  render();
});




/* Start */
async function renderGanttView() {
  console.log("GANTT RENDER CALLED");
  await render();
}


/* Tooltip functions */

let tipEl = null;

function ensureTip(){
  if (tipEl) return tipEl;
  tipEl = document.createElement("div");
  tipEl.className = "ganttTip";
  document.body.appendChild(tipEl);
  return tipEl;
}

function hideTip(){
  if (!tipEl) return;
  tipEl.classList.remove("show", "status-onhold", "status-completed", "status-running");
}

function showTipForBar(barEl){
  const tip = ensureTip();
  const text = barEl.getAttribute("data-tip") || "";
  if (!text) return;

  tip.className = "ganttTip show";

  // NEW: waiting bar tooltip style
  if (barEl.classList.contains("status-waiting")) {
    tip.classList.add("status-waiting");
  } else if (barEl.classList.contains("status-onhold")) {
    tip.classList.add("status-onhold");
  } else if (barEl.classList.contains("status-completed")) {
    tip.classList.add("status-completed");
  } else {
    tip.classList.add("status-running");
  }

  tip.textContent = text;
}

function positionTip(clientX, clientY){
  if (!tipEl) return;

  const pad = 12;
  const tipRect = tipEl.getBoundingClientRect();

  // prefer above cursor
  let x = clientX - tipRect.width / 2;
  let y = clientY - tipRect.height - 14;

  // clamp to viewport
  x = Math.max(pad, Math.min(window.innerWidth - tipRect.width - pad, x));
  if (y < pad) y = clientY + 18; // if no space above, place below

  tipEl.style.left = `${x}px`;
  tipEl.style.top  = `${y}px`;
}

function bindFloatingTooltip(){
  // Use event delegation so it works after re-render
  document.addEventListener("mouseover", (e) => {
    const bar = e.target.closest?.(".bar[data-tip]");
    if (!bar) return;
    showTipForBar(bar);
  });

  document.addEventListener("mousemove", (e) => {
    if (!tipEl || !tipEl.classList.contains("show")) return;
    positionTip(e.clientX, e.clientY);
  });

  document.addEventListener("mouseout", (e) => {
    const bar = e.target.closest?.(".bar[data-tip]");
    if (!bar) return;
    hideTip();
  });

  // Hide on scroll (optional, prevents laggy tooltip)
  document.addEventListener("scroll", () => hideTip(), true);
}

window.addEventListener("resize", () => {
  fitDailyToScreen();
  render();
});

export { renderGanttView };
bindFloatingTooltip();
