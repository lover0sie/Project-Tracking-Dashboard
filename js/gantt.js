/* Heart of the gantt chart */
/* Consist of functions to convert date and time to specific format */
/* Consist of setting up the standard time for each process */
/* Consist of functions to render the daily and monthly gantt chart */
/* Consist of functions to build segments and slices for on hold, running, break time, and process */

import { loadRuns, loadRunsForDay, loadRunsForDayWithCarryForward } from "./timeline.js";
import { exportExcelReport, exportStationViewExcel } from "./excel-export.js";
import { db } from "./firebase.js";
import { 
  getMYTodayKey, 
  buildSegmentsFromRuns, 
  getStationOptionsFromSegments, 
  tsOrMsToDate, 
  buildHoldWindowsFromRun ,
  getActualEffectiveDurationMs,
  getBreakOverlapMs,
  sliceSegForWaiting,
  STANDARD_TIME_MIN,
  LEGEND_STATIONS, 
  LEGEND_STATUS, 
  renderLegend} from "./helpers.js";

import { autoStopRuns, previewAutoStopRuns } from "./auto-stop.js";


import {
  getFirestore,
  collectionGroup,
  getDocs,
  query,
  where
} from "https://www.gstatic.com/firebasejs/11.6.0/firebase-firestore.js";

/* DOM */
const el = (id) => document.getElementById(id);

const bodyEl = el("ganttBody");
const monthHeadEl = el("ganttMonthHead");
const dayHeadEl = el("ganttDayHead");
const ganttWrapEl = document.querySelector(".ganttWrap");

let cachedEvents = [];
const cachedRunsByMonth = new Map();
// Cache fetched runs to avoid hitting Firestore on every re-render.

export function clearGanttCache() {
  cachedEvents = [];
  cachedRunsByMonth.clear();
}

/* Helpers for time */

const TZ = "Asia/Kuala_Lumpur";
const START_HOUR = 7;
const END_HOUR = 22;

let stationLineBalanceChart = null;
let lastStationLineBalanceSegments = [];

let zoomLevel = 0.8;

function assignLane(segments) {
  const lanes = [];

  const sorted = [...segments].sort((a, b) => {
    return a.start.getTime() - b.start.getTime();
  });

  for (const seg of sorted) {
    const segStart = seg.start.getTime();
    const segEnd = seg.end ? seg.end.getTime() : Date.now();

    let placed = false;

    for (const lane of lanes) {
      const lastSeg = lane[lane.length - 1];
      const lastEnd = lastSeg.end ? lastSeg.end.getTime() : Date.now();

      if (segStart >= lastEnd) {
        lane.push(seg);
        seg.laneIndex = lanes.indexOf(lane);
        placed = true;
        break;
      }
    }

    if (!placed) {
      seg.laneIndex = lanes.length;
      lanes.push([seg]);
    }
  }

  return segments;
}

function normalize(str) {
  return String(str || "").toLowerCase().trim();
}

function isPastCutoff(now = new Date()) {
  const mins = now.getHours() * 60 + now.getMinutes();
  return mins >= (17 * 60 + 30);
}

function getCutoffState(now = new Date()) {
  const mins = now.getHours() * 60 + now.getMinutes();

  if (mins >= (21 * 60)) return "night";      // 9:00 PM
  if (mins >= (17 * 60 + 30)) return "shift"; // 5:30 PM
  return null;
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
  x.setHours(END_HOUR, 0,0,0);
  return x;
}

function hourLabel(h){
  // h in 24h
  const isPM = h >= 12;
  const twelve = (h % 12) || 12;
  return `${twelve}:00 ${isPM ? "PM" : "AM"}`;
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

function startOfDay(d){ const x=new Date(d); x.setHours(0,0,0,0); return x; }

function endOfDay(d){ const x=new Date(d); x.setHours(23,59,59,999); return x; }


function parseDayKeyToDate(dayKey) {
  if (!dayKey || !/^\d{4}-\d{2}-\d{2}$/.test(dayKey)) {
    console.warn("Invalid dayKey:", dayKey);
    return new Date();
  }

  const [y, m, d] = dayKey.split("-").map(Number);
  return new Date(y, m - 1, d);
}

/* Get the standard time in minutes */
function getStandardMinutes(processLabel) {
  return Number(STANDARD_TIME_MIN[processLabel] || 0);
}

export function formatDateTime(d){
  if(!d) return "-";

  const day = String(d.getDate()).padStart(2,"0");
  const month = String(d.getMonth()+1).padStart(2,"0");
  const year = d.getFullYear();

  let hours = d.getHours();
  const minutes = String(d.getMinutes()).padStart(2,"0");
  const seconds = String(d.getSeconds()).padStart(2,"0");

  const ampm = hours >= 12 ? "PM" : "AM";
  hours = hours % 12;
  hours = hours === 0 ? 12 : hours;

  return `${day}/${month}/${year} ${hours}:${minutes}:${seconds} ${ampm}`;
}

/* Normalize status */
function statusUi(status){
  const s = String(status || "").toLowerCase().trim();
  if (s === "completed") return { text: "Completed", cls: "completed" };
  if (s === "on_hold") return { text: "On Hold", cls: "onhold" };
  if (s === "waiting") return { text: "Waiting", cls: "waiting" };
  return { text: "Running", cls: "running" };
}

/* Normalize the hold reason */
function normalizeHoldReason(reason){
  if (!reason) return "";

  const map = {
    rework: "Rework Required",
    item_missing: "Item Missing",
    item_shortage: "Material Shortage",
    resume_tomorrow: "Resume Next Shift / Tomorrow",
    others: "Others",
    browser_closed: "Auto Hold (Browser Closed / Tab Closed)",
    end_of_shift: "End Of Shift"
  };

  const key = String(reason).toLowerCase().trim();

  // if exists in map - use nice label
  if (map[key]) return map[key];

  // fallback: convert item_missing - Item Missing
  return key
    .replaceAll("_"," ")
    .replace(/\b\w/g, c => c.toUpperCase());
}

/* Build standard slices taking into account on holds */
function buildStandardSlices(seg) {
  const stdMin = getStandardMinutes(seg?.processLabel);
  if (!stdMin || !seg?.start) return [];

  let remainingMs = stdMin * 60000;
  const slices = [];
  let cursor = seg.start;

  const holdWindows = buildHoldWindowsFromRun(seg, new Date())
    .filter(w => w?.start && w?.end && w.end > w.start)
    .sort((a, b) => a.start - b.start);

  if (!holdWindows.length) {
    return [{
      start: seg.start,
      end: new Date(seg.start.getTime() + remainingMs)
    }];
  }

  for (const w of holdWindows) {
    if (remainingMs <= 0) break;

    const holdStart = w.start;
    const holdEnd = w.end;

    if (!(holdStart instanceof Date) || isNaN(holdStart.getTime())) continue;
    if (!(holdEnd instanceof Date) || isNaN(holdEnd.getTime())) continue;

    if (holdEnd <= cursor) continue;

    if (holdStart > cursor) {
      const runMs = holdStart.getTime() - cursor.getTime();
      const usedMs = Math.min(runMs, remainingMs);

      if (usedMs > 0) {
        slices.push({
          start: cursor,
          end: new Date(cursor.getTime() + usedMs)
        });
        remainingMs -= usedMs;
      }
    }

    if (holdEnd > cursor) {
      cursor = holdEnd;
    }
  }

  if (remainingMs > 0) {
    slices.push({
      start: cursor,
      end: new Date(cursor.getTime() + remainingMs)
    });
  }

  return slices;
}

/* To check if its late or not based on variance */
function isLateAgainstStandard(seg) {
  const varianceMs = getVarianceMs(seg);
  return varianceMs != null && varianceMs > 0;
}







/* Legacy function since currently using buildHoldWindowsFromRun */
function getHoldDurationMsFromRun(r) {

  const hold = tsOrMsToDate(r.holdAt, r.holdEpochMs);
  const resume = tsOrMsToDate(r.resumedAt, r.resumedEpochMs);

  if (!hold) return 0;

  if (resume && resume > hold) {
    return resume.getTime() - hold.getTime();
  }

  if (String(r.status).toLowerCase() === "on_hold") {
    return Date.now() - hold.getTime();
  }

  return 0;
}

/* Gantt chart refresh start and stop */
let ganttLiveTimer = null;
let ganttLiveRefreshInFlight = false;
let lastGanttLiveFetchMs = 0;
const GANTT_LIVE_RENDER_MS = 10000;
const GANTT_LIVE_FETCH_MS = 60000;

function startGanttLiveRefresh() {
  stopGanttLiveRefresh();
  ganttLiveTimer = setInterval(async () => {
    if (ganttLiveRefreshInFlight) return;

    try {
      ganttLiveRefreshInFlight = true;
      const now = Date.now();
      const forceRefresh = now - lastGanttLiveFetchMs >= GANTT_LIVE_FETCH_MS;

      await renderGanttView({ forceRefresh });

      if (forceRefresh) {
        lastGanttLiveFetchMs = now;
      }
    } finally {
      ganttLiveRefreshInFlight = false;
    }
  }, GANTT_LIVE_RENDER_MS);
}

export function stopGanttLiveRefresh() {
  if (ganttLiveTimer) {
    clearInterval(ganttLiveTimer);
    ganttLiveTimer = null;
  }
}




/* Build the daily time bands (the vertical yellow line shown in dashboard) */
function buildDailyTimeBands(rangeMin, rangeMax, hourW) {
  const bands = [
    { label: "Recess", startH: 10, startM: 0, endH: 10, endM: 15, cls: "band-recess" },
    { label: "Lunch",  startH: 12, startM: 0, endH: 12, endM: 30, cls: "band-recess" },
    { label: "Recess", startH: 15, startM: 0, endH: 15, endM: 15, cls: "band-recess" },
    { label: "Off Work", startH: 17, startM: 30, cls: "band-offwork", extendToChartEnd: true }
  ];

  const chartEndPx = ((END_HOUR - START_HOUR) + 1) * hourW;

  return bands.map(b => {
    const bandStart = new Date(rangeMin);
    bandStart.setHours(b.startH, b.startM, 0, 0);

    const startMs = Math.max(bandStart.getTime(), rangeMin.getTime());
    if (startMs >= rangeMax.getTime()) return "";

    const leftPx = ((startMs - rangeMin.getTime()) / 3600000) * hourW;

    let widthPx = 0;

    if (b.extendToChartEnd) {
      widthPx = Math.max(0, chartEndPx - leftPx);
    } else {
      const bandEnd = new Date(rangeMin);
      bandEnd.setHours(b.endH, b.endM, 0, 0);

      const endMs = Math.min(bandEnd.getTime(), rangeMax.getTime());
      if (endMs <= startMs) return "";

      widthPx = ((endMs - startMs) / 3600000) * hourW;
    }

    return `
      <div class="timeBand ${b.cls}"
           style="left:${leftPx}px; width:${widthPx}px;"
           title="${b.label}">
      </div>
    `;
  }).join("");
}

/* Get the time difference between standard and actual process */
function getVarianceMs(seg) {
  const stdMin = getStandardMinutes(seg?.processLabel);
  if (!stdMin || !seg?.start) return null;

  const stdMs = stdMin * 60000;
  const actualEffectiveMs = getActualEffectiveDurationMs(seg);

  return actualEffectiveMs - stdMs;
}

function formatVariance(ms) {
  if (ms == null) return "-";

  if (Math.abs(ms) < 1000) return "On Time";

  const absMs = Math.abs(ms);
  const duration = formatDuration(absMs);

  if (ms > 0) {
    return `Behind by ${duration}`;
  } else {
    return `Ahead by ${duration}`;
  }
}

/* Inject waiting into slice (renderGanttDaily) */
function injectWaitingIntoLane(laneSegs, allUnitSegs = []) {
  const sorted = [...laneSegs]
    .filter(Boolean)
    .sort((a, b) => a.start.getTime() - b.start.getTime());

  const allRealSegs = [...allUnitSegs]
    .filter(seg => seg.phase !== "waiting" && seg.status !== "waiting")
    .filter(hasValidSegmentDates);

  const out = [];
  if (!sorted.length) return out;

  for (let i = 0; i < sorted.length; i++) {
    const cur = sorted[i];
    out.push(cur);

    const next = sorted[i + 1];
    if (!next) continue;

    const gapStartMs = cur.end.getTime();
    const gapEndMs = next.start.getTime();

    if (gapEndMs <= gapStartMs) continue;

    const hasOtherActiveWork = allRealSegs.some(seg => {
      if (seg === cur || seg === next) return false;

      const s = seg.start.getTime();
      const e = seg.end.getTime();

      return e > gapStartMs && s < gapEndMs;
    });

    if (hasOtherActiveWork) continue;

    out.push({
      ...cur,
      start: new Date(gapStartMs),
      end: new Date(gapEndMs),
      status: "waiting",
      phase: "waiting",
      processLabel: "Waiting"
    });
  }

  return out;
}
/* Inject waiting into slice (renderGantt) */
function injectWaitingIntoUnitSegs(segs) {
  if (!Array.isArray(segs) || !segs.length) return [];

  const sorted = [...segs].sort((a, b) => a.start.getTime() - b.start.getTime());
  const out = [];

  for (let i = 0; i < sorted.length; i++) {
    const cur = sorted[i];
    out.push(cur);

    const next = sorted[i + 1];
    if (!next) continue;

    const gapStart = cur.end;
    const gapEnd = next.start;

    if (!gapStart || !gapEnd) continue;
    if (gapEnd.getTime() <= gapStart.getTime()) continue;

    out.push({
      phase: "waiting",
      status: "waiting",
      start: gapStart,
      end: gapEnd,

      serial: cur.serial,
      station: cur.station,
      projectName: cur.projectName,
      materialNumber: cur.materialNumber,
      description: cur.description,
      processLabel: "Waiting",

      qrKind: cur.qrKind || "",
      chillerSerialNumber: cur.chillerSerialNumber || "",
      pvSerialNumber: cur.pvSerialNumber || "",
      vesselType: cur.vesselType || "",
      coolingType: cur.coolingType || "",

      employeeName: "",
      employeeNumber: "",
      resumedByName: "",
      resumedByNumber: "",
      manpower: 0,
      remarks: "",
      holdWindows: [],
      ongoing: false,
      durationMs: Math.max(0, gapEnd.getTime() - gapStart.getTime())
    });
  }

  return out;
}


function getCurrentHoldDurationMs(run) {
  const windows = buildHoldWindowsFromRun(run, new Date());
  const openWindow = windows.find(w => w.isOpen);
  if (!openWindow) return 0;
  return Math.max(0, openWindow.end.getTime() - openWindow.start.getTime());
}

/* Function to build the tooltip for daily and monthy timeline */
function tipTextBuilder(seg, sliceStart, sliceEnd, partType, part = null) {
  const isHoldGap = partType === "on_hold_gap";
  const isWaiting = partType === "waiting" || seg.phase === "waiting";


  // HOLD slice
  if (isHoldGap) {
    const holdReason = part?.holdReason || seg.holdReason || "";
    const remarks = part?.remarks || seg.remarks || "";
    const sliceDurationMs = Math.max(0, sliceEnd.getTime() - sliceStart.getTime());

    const holdMs = part?.isOpen
      ? getCurrentHoldDurationMs(seg)
      : sliceDurationMs;

    const endText = part?.isOpen
      ? `Now (${formatDateTime(new Date())})`
      : formatDateTime(sliceEnd);

    return `
      <div class="tipTitle">${seg.processLabel || "-"}</div>
      <div class="tipRow"><span class="tipLabel">Start:</span> ${formatDateTime(sliceStart)}</div>
      <div class="tipRow"><span class="tipLabel">End:</span> ${endText}</div>
      <div class="tipRow"><span class="tipLabel">Duration:</span> ${formatDuration(holdMs)}</div>
      <b><div class="tipRow">Reason: ${
        holdReason === "others" && remarks
          ? "Others"
          : (normalizeHoldReason(holdReason) || "-")
      }</div></b>
      <b><div class="tipRow">Remark: ${remarks || "-"}</div></b>
    `;
  }

  // WAITING slice
  if (isWaiting) {
    return `
      <div class="tipTitle">WAITING / IDLE TIME</div>
      <div class="tipRow"><span class="tipLabel">Start:</span> ${formatDateTime(sliceStart)}</div>
      <div class="tipRow"><span class="tipLabel">End:</span> ${formatDateTime(sliceEnd)}</div>
      <div class="tipRow"><span class="tipLabel">Duration:</span> ${formatDuration(sliceEnd.getTime() - sliceStart.getTime())}</div>
    `;
  }

  // PROCESS slice
  const realFrom = sliceStart;
  const realTo = sliceEnd;

  const sliceDurationMs =
    realFrom && realTo ? Math.max(0, realTo.getTime() - realFrom.getTime()) : 0;

  const sliceBreakMs =
    realFrom && realTo ? getBreakOverlapMs(realFrom, realTo) : 0;

  const sliceEffectiveMs = Math.max(0, sliceDurationMs - sliceBreakMs);

  const totalEffectiveMs = getActualEffectiveDurationMs(seg);

  const isRunningNow =
  String(seg.status || "").toLowerCase() === "running" &&
  seg.end instanceof Date;

  const endText = isRunningNow
    ? `Now (${formatDateTime(new Date())})`
    : formatDateTime(realTo);

  return `
    <div class="tipTitle">${seg.processLabel || "PROCESS"}</div>
    <div class="tipRow"><span class="tipLabel">Started By:</span> ${seg.employeeName || "-"} (${seg.employeeNumber || "-"})</div>
    <div class="tipRow"><span class="tipLabel">Resumed By:</span> ${seg.resumedByName || "-"} (${seg.resumedByNumber || "-"})</div>
    <div class="tipRow"><span class="tipLabel">Manpower:</span> ${seg.manpower ?? "-"}</div>
    <div class="tipRow"><span class="tipLabel">Start:</span> ${formatDateTime(realFrom)}</div>
    <div class="tipRow"><span class="tipLabel">End:</span> ${endText}</div>
    <div class="tipRow"><span class="tipLabel">Effective Duration:</span> ${formatDuration(sliceEffectiveMs)}</div>
    <div class="tipRow"><span class="tipLabel">Total Effective Duration:</span> ${formatDuration(totalEffectiveMs)}</div>
  `;
}

/* Build tooltip for the standard time */
function standardTipText(seg, stdStart, stdEnd) {
  const stdMin = getStandardMinutes(seg?.processLabel);
  const stdMs = stdMin * 60000;

  const actualEffectiveMs = getActualEffectiveDurationMs(seg);
  const varianceMs = getVarianceMs(seg);

  const holdMs = buildHoldWindowsFromRun(seg, new Date())
  .reduce((sum, w) => sum + Math.max(0, w.end.getTime() - w.start.getTime()), 0);
  
  const breakMs = seg?.start && seg?.end
    ? getBreakOverlapMs(seg.start, seg.end)
    : 0;

  return `
    <div class="tipTitle">${seg.processLabel || "-"}</div>
    <div class="tipRow"><span class="tipLabel">Standard Duration:</span> ${formatDuration(stdMs)}</div>
    <div class="tipRow"><span class="tipLabel">Effective Duration:</span> ${formatDuration(actualEffectiveMs)}</div>
    <b><div class="tipRow">Variance: ${formatVariance(varianceMs)}</div></b>
    <div class="tipDivider"></div>
    <div class="tipRow"><span class="tipLabel">On Hold:</span> ${formatDuration(holdMs)}</div>
    <div class="tipRow"><span class="tipLabel">Break:</span> ${formatDuration(breakMs)}</div>
  `;
}


/* Fitting the columns of daily into the screen */
function fitDailyToScreen(){
  // only in daily mode
  const mode = el("dateMode")?.value || "daily";
  if (!["daily", "station"].includes(mode)) return;

  const hoursCount = (END_HOUR - START_HOUR) + 1; // 16

  // available width inside your card (use ganttWrap width)
  const wrap = document.querySelector(".ganttWrap");
  if (!wrap) return;

  // left sticky columns width from the active page scope
  const wrapStyle = getComputedStyle(wrap);
  const colProject = parseFloat(wrapStyle.getPropertyValue("--colProject")) || 260;
  const colProc    = parseFloat(wrapStyle.getPropertyValue("--colProc")) || 120;
  const colStatus  = parseFloat(wrapStyle.getPropertyValue("--colStatus")) || 110;

  const wrapWidth = wrap.clientWidth;
  const leftColumnsWidth = document.body.classList.contains("station-page")
    ? colProc + colProject + colStatus
    : colProject + colProc + colStatus;

  // timeline area width = wrap - left columns
  const timelineWidth = Math.max(0, wrapWidth - leftColumnsWidth);

  // compute hour width from the visible space so the full daily grid fits the viewport
  const hourW = Math.max(16, Math.floor(timelineWidth / hoursCount));

  document.documentElement.style.setProperty("--hourW", hourW + "px");
}




/* Get the process number to display in the Process No. column */
function getProcessNo(segOrLabel) {
  const raw =
    typeof segOrLabel === "string"
      ? segOrLabel
      : (segOrLabel?.processLabel ?? segOrLabel?.processName ?? "-");

  const processLabel = String(raw);
  const lower = processLabel.toLowerCase().trim();

  if (lower === "waiting" || lower === "station idle") {
    return processLabel;
  }

  const parts = processLabel.split(" - ");
  return parts[0]?.trim() || processLabel;
}

/* Get the latest segment */
function latestSegment(segs){
  return segs.slice().sort((a,b)=>
    ((b.end?.getTime?.()||0)-(a.end?.getTime?.()||0)) ||
    ((b.start?.getTime?.()||0)-(a.start?.getTime?.()||0))
  )[0];
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
  if (s.includes ("wc1")) return "st-wc1"; // WC Line 1
  if (s.includes ("wc2")) return "st-wc2"; // WC Line 2
  if (s.includes ("ac")) return "st-ac"; // AC Line
  if (s.includes ("insulationab")) return "st-insulation1"; // Insulation AB 
  if (s.includes ("insulationg")) return "st-insulation2"; // Insulation G
  if (s.includes ("packing")) return "st-packing"; // Packing
  if (s.includes ("migwelding")) return "st-mig"; // Packing

  return "st-pv1"; // default
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


function buildChillerGroups(segments){
  const groups = new Map();

  for (const seg of segments) {
    const projectName = seg.projectName || "(No Project)";
    const materialNumber = seg.materialNumber || "(No Material)";
    const chillerSerialNumber = seg.chillerSerialNumber || "";

    const groupKey = chillerSerialNumber
    ? `CH::${chillerSerialNumber}`
    : `PM::${projectName}||${materialNumber}`;


    const { unitType, unitSerial } = unitInfoFromSeg(seg);
    const unitKey = `${unitType}||${unitSerial}`;

    if (!groups.has(groupKey)) {
      groups.set(groupKey, {
        chillerSerialNumber,
        projectName,
        materialNumber,
        units: new Map()
      });
    }

    const g = groups.get(groupKey);

    if (!g.projectName || g.projectName === "(No Project)") {
      g.projectName = projectName;
    }

    if (!g.materialNumber || g.materialNumber === "(No Material)") {
      g.materialNumber = materialNumber;
    }

    if (!g.units.has(unitKey)) {
      g.units.set(unitKey, {
        unitType,
        unitSerial,
        segs: []
      });
    }

    g.units.get(unitKey).segs.push(seg);
  }

  return groups;
}

/* ========== Building Station View =============== */

export async function exportStationSelectedDateExcel() {
  const dayPicker = el("dayPicker");
  const stationPicker = el("stationBalancePicker");

  const todayKey = getMYTodayKey();
  const dayKey = dayPicker?.value || todayKey;
  const selectedStation = "";

  const runs = await loadRunsForDayWithCarryForward(dayKey);
  const { segments } = buildSegmentsFromRuns(runs);

  const dayDate = parseDayKeyToDate(dayKey);
  const rangeMin = startOfWorkDay(dayDate);
  const rangeMax = endOfWorkDay(dayDate);

  const filteredSegments = segments
    .filter(seg =>
      hasValidSegmentDates(seg) &&
      seg.end.getTime() > rangeMin.getTime() &&
      seg.start.getTime() < rangeMax.getTime()
    )

    .filter(seg =>
      seg.phase !== "waiting" &&
      seg.status !== "waiting"
    )
    .sort((a, b) =>
      String(a.processLabel || "").localeCompare(String(b.processLabel || ""), undefined, { numeric: true }) ||
      a.start.getTime() - b.start.getTime()
    );

  exportStationViewExcel(filteredSegments, {
    dayKey,
    station: "All Stations"
  });
}

/* Position bars by time */
function clamp(n, a, b) { return Math.max(a, Math.min(b, n)); }

function hasValidSegmentDates(seg) {
  return (
    seg?.start instanceof Date &&
    seg?.end instanceof Date &&
    Number.isFinite(seg.start.getTime()) &&
    Number.isFinite(seg.end.getTime())
  );
}

function getLaneEndMs(seg) {
  const status = String(seg?.status || "").toLowerCase().trim();

  // If process is currently on hold, treat the lane as occupied until now
  if (status === "on_hold") {
    return Date.now();
  }

  return seg?.end?.getTime?.() || seg?.start?.getTime?.() || 0;
}

function buildLanes(segs) {
  const sorted = segs.slice().sort((a, b) =>
    a.start.getTime() - b.start.getTime()
  );

  const lanes = [];

  for (const seg of sorted) {
    const s = seg.start.getTime();
    const e = getLaneEndMs(seg);

    let placed = false;

    for (const lane of lanes) {
      if (s >= lane.endMs) {
        lane.segs.push(seg);
        lane.endMs = Math.max(lane.endMs, e);
        placed = true;
        break;
      }
    }

    if (!placed) {
      lanes.push({
        endMs: e,
        segs: [seg]
      });
    }
  }

  return lanes.map(l => l.segs);
}

function groupStationByProcess(segments) {
  const stationMap = new Map();

  for (const seg of segments) {
    const station = String(seg?.station || "UNKNOWN").trim() || "UNKNOWN";
    const processNo = getProcessNo(seg) || "-"; // keeps "18,19" as one key

    const qrKind = String(seg.qrKind || "").toUpperCase();

    const serialKey =
      qrKind === "PV"
        ? (seg.pvSerialNumber || seg.serialNumber || seg.serial || "-")
        : (seg.chillerSerialNumber || seg.serialNumber || seg.serial || "-");

    const processKey = `${processNo}__${serialKey}`;

    if (!stationMap.has(station)) {
      stationMap.set(station, new Map());
    }

    const procMap = stationMap.get(station);

    if (!procMap.has(processKey)) {
      procMap.set(processKey, []);
    }

    procMap.get(processKey).push(seg);
  }

  // sort every lane by time
  for (const [, procMap] of stationMap) {
    for (const [, segs] of procMap) {
      segs.sort((a, b) => {
        const aTime = a.start?.getTime?.() || a.startEpochMs || 0;
        const bTime = b.start?.getTime?.() || b.startEpochMs || 0;
        return aTime - bTime;
      });
    }
  }

  return stationMap;
}

export async function renderStationOnlyView() {
  try {
    const dayPicker = el("dayPicker");
    const stationPicker = el("stationBalancePicker");
    const stationTitle = el("stationViewTitle");

    const todayKey = getMYTodayKey();
    const dayKey = dayPicker?.value || todayKey;

    const runs = await loadRunsForDayWithCarryForward(dayKey);

    if (!runs.length) {
      bodyEl.innerHTML = "";
      monthHeadEl.innerHTML = "";
      dayHeadEl.innerHTML = "";
      if (stationTitle) stationTitle.textContent = "Station";

      return;
    }

    const { segments } = buildSegmentsFromRuns(runs);

    renderLegend("legendStations", LEGEND_STATIONS);
    renderLegend("legendStatus", LEGEND_STATUS);

    if (dayPicker && !dayPicker.value) {
      dayPicker.value = todayKey;
    }

    const dayDate = parseDayKeyToDate(dayPicker?.value || todayKey);
    const rangeMin = startOfWorkDay(dayDate);
    const rangeMax = endOfWorkDay(dayDate);

    const segsInWindow = segments.filter(s =>
      hasValidSegmentDates(s) &&
      s.end.getTime() > rangeMin.getTime() &&
      s.start.getTime() < rangeMax.getTime()
    );

    fitDailyToScreen();
    const hourW = getHourW();
    document.documentElement.style.setProperty("--colW", hourW + "px");
    document.documentElement.style.setProperty("--minorDiv", "2");

    if (!segsInWindow.length) {
      bodyEl.innerHTML = `
        <div class="emptyState">
          No projects found for the selected day.
        </div>
      `;
      dayHeadEl.innerHTML = buildHourHeader();
      monthHeadEl.innerHTML = "";
      renderStationLegend([]);
      return;
    }

    const stations = getStationOptionsFromSegments(segsInWindow);

    if (stationPicker) {
      const previousStation = stationPicker.value;

      stationPicker.innerHTML = stations.map(station => `
        <option value="${escapeHtml(station)}">${escapeHtml(station)}</option>
      `).join("");

      if (stations.includes(previousStation)) {
        stationPicker.value = previousStation;
      } else if (stations.length) {
        stationPicker.value = stations[0];
      }
    }

    const selectedStation = stationPicker?.value || "";
    if (stationTitle) {
      stationTitle.textContent = selectedStation
        ? `Station: ${selectedStation}`
        : "Station";
    }

    const filteredSegs = selectedStation
      ? segsInWindow.filter(s => String(s.station || "").trim() === selectedStation)
      : segsInWindow;

    renderGanttStation(rangeMin, rangeMax, filteredSegs);

  } catch (err) {
    console.error(err);
  }
}

function renderStationLegend(segments) {
  const stationMap = new Map();

  for (const seg of segments) {
    const station = String(seg?.station || "UNKNOWN").trim() || "UNKNOWN";

    if (!stationMap.has(station)) {
      stationMap.set(station, stationClass(station));
    }
  }

  const stationHtml = [...stationMap.entries()]
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([station, cls]) => `
      <div class="legendItem">
        <span class="swatch ${cls}"></span>
        <span>${station}</span>
      </div>
    `)
    .join("");

  const legendStationsEl = el("legendStations");
  if (legendStationsEl) legendStationsEl.innerHTML = stationHtml;
}

function formatStatus(text) {
  if (!text) return "";
  return String(text)
    .toLowerCase()
    .replaceAll("_", " ")
    .replace(/\b\w/g, c => c.toUpperCase());
}

function getEffectiveDurationMs(seg) {
  if (typeof seg?.effectiveDurationMs === "number") return seg.effectiveDurationMs;
  if (typeof seg?.durationMs === "number") return seg.durationMs;
  if (seg?.start && seg?.end) return Math.max(0, seg.end.getTime() - seg.start.getTime());
  return 0;
}

function stationTipTextBuilder(seg, realFrom, realTo, type, part) {
  const partType = part?.type || type || "";

  if (partType === "waiting" || seg?.phase === "waiting" || seg?.status === "waiting") {
    return waitingTipTextBuilder(realFrom, realTo);
  }

  if (partType === "on_hold_gap") {
    return holdTipTextBuilder(seg, realFrom, realTo, part);
  }

  return processTipTextBuilder(seg, realFrom, realTo, type, part);
}

function processTipTextBuilder(seg, realFrom, realTo, type, part) {
  const qrKind = String(seg?.qrKind || "").toUpperCase().trim();
  let typeText = "-";

  if (qrKind === "PV") {
    typeText = seg?.vesselType || "-";
  } else if (qrKind === "CHILLER") {
    typeText = seg?.coolingType || "-";
  } else {
    typeText = seg?.coolingType || seg?.vesselType || "-";
  }

  const isRunning =
    String(seg?.status || "").toLowerCase().trim() === "running";

  const effectiveEnd = isRunning ? new Date() : realTo;

  const endText = isRunning
    ? `Now (${formatDateTime(effectiveEnd)})`
    : (realTo ? formatDateTime(realTo) : "-");

  const sliceEffectiveMs = Math.max(
    0,
    (effectiveEnd?.getTime?.() || 0) - (realFrom?.getTime?.() || 0)
  );

  const totalEffectiveMs = getEffectiveDurationMs(seg);

  
  const statusText = formatStatus(seg?.status || type || "-");

  const serialText =
  seg.qrKind === "PV"
    ? seg.pvSerialNumber
    : seg.qrKind === "CHILLER"
    ? seg.chillerSerialNumber
    : seg.serial;

  return `
    <div class="tipTitle">${escapeHtml(seg.processLabel || seg.processName || "-")}</div>
    <div class="tipRow"><span class="tipLabel">Started By:</span> ${escapeHtml(seg.employeeName || "-")} (${escapeHtml(seg.employeeNumber || "-")})</div>
    <div class="tipRow"><span class="tipLabel">Resumed By:</span> ${escapeHtml(seg.resumedByName || "-")} (${escapeHtml(seg.resumedByNumber || "-")})</div>
    <div class="tipRow"><span class="tipLabel">Manpower:</span> ${seg.manpower ?? "-"}</div>
    <div class="tipRow"><span class="tipLabel">Start:</span> ${escapeHtml(formatDateTime(realFrom))}</div>
    <div class="tipRow"><span class="tipLabel">End:</span> ${escapeHtml(endText)}</div>
    <div class="tipRow"><span class="tipLabel">Effective Duration:</span> ${escapeHtml(formatDuration(sliceEffectiveMs))}</div>
    <div class="tipRow"><span class="tipLabel">Total Effective Duration:</span> ${escapeHtml(formatDuration(totalEffectiveMs))}</div>
  `;
}

function waitingTipTextBuilder(start, end) {
  const durationMs = Math.max(0, end.getTime() - start.getTime());

  return `
    <div class="tipTitle">Waiting</div>
    <div class="tipRow"><span class="tipLabel">Start:</span> ${escapeHtml(formatDateTime(start))}</div>
    <div class="tipRow"><span class="tipLabel">End:</span> ${escapeHtml(formatDateTime(end))}</div>
    <div class="tipRow"><span class="tipLabel">Duration:</span> ${escapeHtml(formatDuration(durationMs))}</div>
  `;
}

function holdTipTextBuilder(seg, start, end, part) {
  const holdReason = normalizeHoldReason(part?.holdReason || seg?.holdReason);
  const remarks = part?.remarks || seg?.remarks || "-";
  const durationMs = Math.max(0, end.getTime() - start.getTime());

  const endText = part?.isOpen
    ? `Now (${formatDateTime(new Date())})`
    : formatDateTime(end);

  return `
    <div class="tipTitle">On Hold</div>
    <div class="tipRow"><span class="tipLabel">Start:</span> ${escapeHtml(formatDateTime(start))}</div>
    <div class="tipRow"><span class="tipLabel">End:</span> ${escapeHtml(endText)}</div>
    <div class="tipRow"><span class="tipLabel">Duration:</span> ${escapeHtml(formatDuration(durationMs))}</div>
    <b><div class="tipRow">Hold Reason:</span> ${escapeHtml(holdReason)}</div></b>
    <b><div class="tipRow">Remarks: ${escapeHtml(remarks)}</div></b>
  `;
}

function drawNowLine(rangeMin, rangeMax, hourW) {
  const now = new Date();

  if (now < rangeMin || now > rangeMax) return;

  const msPerHour = 3600000;
  const leftPx =
    ((now.getTime() - rangeMin.getTime()) / msPerHour) * hourW;

  document.querySelectorAll(".ganttTimeline").forEach(tl => {
    // remove old line first so it does not duplicate
    tl.querySelectorAll(".nowLine").forEach(el => el.remove());

    const line = document.createElement("div");
    line.className = "nowLine";
    line.style.left = leftPx + "px";
    tl.appendChild(line);
  });
}

const stationLineCharts = new Map();


/* Old function to make data into single lane based on station */
function renderSingleStationLineBalanceChart(data) {
  const canvas = el("stationLineBalanceChart");
  if (!canvas || typeof Chart === "undefined") return;

  if (stationLineBalanceChart) {
    stationLineBalanceChart.destroy();
    stationLineBalanceChart = null;
  }

  stationLineBalanceChart = new Chart(canvas, {
    type: "line",
    data: {
      labels: data.labels,
      datasets: [
        {
          label: `${data.station} Duration`,
          data: data.durations,
          tension: 0.25,
          fill: false
        }
      ]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: {
          display: true
        },
        tooltip: {
          callbacks: {
            title(items) {
              const idx = items?.[0]?.dataIndex ?? 0;
              return data.fullLabels[idx] || items?.[0]?.label || "";
            },
            label(ctx) {
              return `Duration: ${ctx.parsed.y} min`;
            }
          }
        }
      },
      scales: {
        x: {
          title: {
            display: true,
            text: "Process"
          }
        },
        y: {
          beginAtZero: true,
          title: {
            display: true,
            text: "Duration (min)"
          }
        }
      }
    }
  });
}

function buildStationProjectCell(segs) {
  const realSegs = segs.filter(seg =>
    seg.phase !== "waiting" && seg.status !== "waiting"
  );

  const firstSeg = realSegs[0] || segs[0] || {};

  const qrKind = String(firstSeg.qrKind || "").toUpperCase();

  const typeText =
    qrKind === "PV"
      ? (firstSeg.vesselType || "-")
      : (firstSeg.coolingType || "-");

  const serialText =
    qrKind === "PV"
      ? (firstSeg.pvSerialNumber || firstSeg.serialNumber || firstSeg.serial || "-")
      : (firstSeg.chillerSerialNumber || firstSeg.serialNumber || firstSeg.serial || "-");

  const materialText = firstSeg.materialNumber || "-";

  return `
    <div class="stationProjectBlock">
      <div class="stationProjectTitle">
        ${escapeHtml(firstSeg.projectName || "-")}
        <span class="stationType">(${escapeHtml(typeText)})</span>
      </div>

      <div class="stationMetaPill">
        ${escapeHtml(serialText)} | ${escapeHtml(materialText)}
      </div>

      <div class="stationProcessName smallProcess">
        ${escapeHtml(firstSeg.processLabel || firstSeg.processName || "-")}
      </div>
    </div>
  `;
}

function buildStationProjectMiniCell(segs) {
  const firstSeg = segs[0] || {};
  const qrKind = String(firstSeg.qrKind || "").toUpperCase();

  const typeText =
    qrKind === "PV"
      ? (firstSeg.vesselType || "-")
      : (firstSeg.coolingType || "-");

  const serialText =
    qrKind === "PV"
      ? (firstSeg.pvSerialNumber || firstSeg.serialNumber || firstSeg.serial || "-")
      : (firstSeg.chillerSerialNumber || firstSeg.serialNumber || firstSeg.serial || "-");

  const materialText = firstSeg.materialNumber || "-";

  return `
    <div class="stationProjectMini">
      <div class="stationProjectName">
        ${escapeHtml(firstSeg.projectName || "-")}
        <span class="stationType">(${escapeHtml(typeText)})</span>
      </div>

      <div class="stationMetaPill">
        ${escapeHtml(serialText)} | ${escapeHtml(materialText)}
      </div>
    </div>
  `;
}

/* Render Gantt Chart according to station - use existing template */
function renderGanttStation(rangeMin, rangeMax, segments) {
  if (!bodyEl || !dayHeadEl || !monthHeadEl) return;

  const hourW = getHourW();
  const hourCount = (END_HOUR - START_HOUR) + 1;
  const totalWidthPx = hourCount * hourW;
  const stationGridLinesHtml = Array.from({ length: (hourCount * 2) + 1 }, (_, i) => (
    `<div class="stationGridLine ${i % 2 === 0 ? "major" : "minor"}" style="left:${(i * hourW) / 2}px"></div>`
  )).join("");

  dayHeadEl.innerHTML = buildHourHeader();
  monthHeadEl.innerHTML = "";

  if (!segments.length) {
    bodyEl.innerHTML = `
      <div class="emptyState">
        No projects found for the selected day.
      </div>
    `;
    return;
  }

  const grouped = groupStationByProcess(segments);
  const timeBandsHtml = buildDailyTimeBands(rangeMin, rangeMax, hourW);

  

  const stationBlocks = Array.from(grouped.entries())
  .sort((a, b) => a[0].localeCompare(b[0]))
  .map(([station, procMap]) => {
    const stationCls = stationClass(station);
    const procEntries = Array.from(procMap.entries())
      .sort((a, b) => a[0].localeCompare(b[0], undefined, { numeric: true }));

    const processGroups = [];
    for (const [processKey, segs] of procEntries) {
      const processNo = processKey.split("__")[0];
      let group = processGroups[processGroups.length - 1];

      if (!group || group.processNo !== processNo) {
        group = { processNo, entries: [] };
        processGroups.push(group);
      }

      group.entries.push([processKey, segs]);
    }

    const procRows = processGroups.map(group => {
      const renderedEntries = group.entries.map(([, segs]) => {
        const sortedSegs = [...segs].sort(
          (a, b) => a.start.getTime() - b.start.getTime()
        );

        const lanes = buildLanes(sortedSegs).map(laneSegs =>
          injectWaitingIntoLane(laneSegs, sortedSegs)
        );

        const cur = latestSegment(sortedSegs) || null;
        const processName =
          sortedSegs.find(seg => seg.processLabel && seg.processLabel !== "Waiting")?.processLabel ||
          cur?.processLabel ||
          group.processNo;

        const hasAutoStopCandidate = sortedSegs.some(s => s.isAutoStopCandidate);

        const laneRowsHtml = lanes.map((laneSegs, laneIndex) => {
        const realLaneSegs = laneSegs.filter(seg =>
          seg.phase !== "waiting" && seg.status !== "waiting"
        );

        const projectCellHtml = buildStationProjectMiniCell(realLaneSegs);

        const laneCur = latestSegment(realLaneSegs) || null;
        const st = statusUi(laneCur?.status);

        const standardBars = realLaneSegs.map(seg => {
          const stdSlices = buildStandardSlices(seg);
          const isLate = isLateAgainstStandard(seg);

          return stdSlices.map(slice => {
            const stdStartMs = clamp(slice.start.getTime(), rangeMin.getTime(), rangeMax.getTime());
            const stdEndMs = clamp(slice.end.getTime(), rangeMin.getTime(), rangeMax.getTime());

            if (stdEndMs <= stdStartMs) return "";

            const leftPx = ((stdStartMs - rangeMin.getTime()) / 3600000) * hourW;
            const widthPx = Math.max(8, ((stdEndMs - stdStartMs) / 3600000) * hourW);

            return `
              <div class="bar standardBar ${isLate ? "standardLate" : ""}"
                  style="left:${leftPx}px; width:${widthPx}px;"
                  data-tip="${escapeAttr(
                    standardTipText(seg, new Date(stdStartMs), new Date(stdEndMs))
                  )}">
              </div>
            `;
          }).join("");
        }).join("");

        const bars = laneSegs.map(seg => {
          return sliceSegForWaiting(seg)
            .filter(p => !(
              p.end.getTime() <= rangeMin.getTime() ||
              p.start.getTime() >= rangeMax.getTime()
            ))
            .map(p => {
              const sliceStart = new Date(Math.max(p.start.getTime(), rangeMin.getTime()));
              const sliceEnd = new Date(Math.min(p.end.getTime(), rangeMax.getTime()));

              const leftPx = ((sliceStart.getTime() - rangeMin.getTime()) / 3600000) * hourW;
              const widthPx = Math.max(
                1,
                ((sliceEnd.getTime() - sliceStart.getTime()) / 3600000) * hourW - 1
              );

              const isHoldGap = p.type === "on_hold_gap";
              const isWaiting =
                p.type === "waiting" ||
                seg.phase === "waiting" ||
                seg.status === "waiting";

              const tipText = isWaiting
                ? waitingTipTextBuilder(sliceStart, sliceEnd)
                : stationTipTextBuilder(
                    seg,
                    sliceStart,
                    sliceEnd,
                    isHoldGap ? "on_hold_gap" : "process",
                    p
                  );

              const barStationCls =
                isHoldGap ? "st-holdgap" :
                isWaiting ? "st-waiting" :
                stationCls;

              const statusCls =
                isHoldGap ? "status-holdgap" :
                isWaiting ? "status-waiting" :
                seg.status === "completed" ? "status-completed" :
                seg.status === "on_hold" ? "status-onhold" :
                "status-running";

              return `
                <div class="bar ${barStationCls} ${statusCls}"
                    style="left:${leftPx}px; width:${widthPx}px;"
                    data-tip="${escapeAttr(tipText)}"></div>
              `;
            }).join("");
        }).join("");

       return `
        <div class="ganttCell project stationProjectCell stationProjectLaneCell"
            style="grid-column: 2; grid-row: span 2;">
          ${projectCellHtml}
        </div>

        <div class="ganttCell status stationLaneStatus standardLaneRow"
            style="grid-column: 3;">
          <span class="statusPill standard">Standard</span>
        </div>

        <div class="ganttTimeline dailyGrid stationLaneTimeline standardLaneRow"
            style="grid-column: 4; width:${totalWidthPx}px">
          ${timeBandsHtml}
          ${stationGridLinesHtml}
          ${standardBars}
        </div>

        <div class="ganttCell status stationLaneStatus stationProjectLaneEnd"
            style="grid-column: 3;">
          <span class="statusPill ${st.cls}">
            ${escapeHtml(st.text)}
          </span>
        </div>

        <div class="ganttTimeline dailyGrid stationLaneTimeline stationProjectLaneEnd"
            style="grid-column: 4; width:${totalWidthPx}px">
          ${timeBandsHtml}
          ${stationGridLinesHtml}
          ${bars}
        </div>
      `;
        }).join("");

        return {
          hasAutoStopCandidate,
          laneRowCount: lanes.length * 2,
          processName,
          rowsHtml: laneRowsHtml
        };
      });

      const processRowSpan = renderedEntries.reduce(
        (sum, entry) => sum + entry.laneRowCount,
        0
      );
      const processName = renderedEntries.find(entry => entry.processName)?.processName || group.processNo;
      const hasAutoStopCandidate = renderedEntries.some(entry => entry.hasAutoStopCandidate);
      const laneRowsHtml = renderedEntries.map(entry => entry.rowsHtml).join("");

      return `
        <div class="stationProcBlock ${hasAutoStopCandidate ? "autoStopHighlight" : ""}">
          <div class="ganttCell procNo stationProcessMerged"
              style="grid-column: 1; --processRowSpan: ${processRowSpan};">
            <div class="stationProcessName">${escapeHtml(processName)}</div>
          </div>
          ${laneRowsHtml}
        </div>
      `;
    }).join("");

    return `
      <div class="stationGroup">
        ${procRows}
      </div>
    `;
  })
  .join("");

  bodyEl.innerHTML = stationBlocks;

  document.querySelectorAll(".ganttTimeline").forEach(tl => {
    tl.style.width = totalWidthPx + "px";
  });

  drawNowLine(rangeMin, rangeMax, hourW);
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
  /* const groups = buildMaterialGroups(segments); */
  const groups = buildChillerGroups(segments);
  /* const groupArr = Array.from(groups.values()).sort((a,b) =>
    (a.projectName || "").localeCompare(b.projectName || "") ||
    (a.materialNumber || "").localeCompare(b.materialNumber || "")
  ); */
  const groupArr = Array.from(groups.values()).sort((a,b) =>
    (a.projectName || "").localeCompare(b.projectName || "") ||
    (a.chillerSerialNumber || "").localeCompare(b.chillerSerialNumber || "")
  );

  bodyEl.innerHTML = groupArr.map(g => {

    const headerRow = `
      <div class="ganttRow groupRow">
        <div class="ganttCell project" style="grid-column: 1 / span 3;">
          <div class="groupHeaderRow">
            <div class="title">${escapeHtml(g.projectName)}</div>
            <div class="materialRight">
              <b>${escapeHtml(g.chillerSerialNumber|| "-")}</b>
              <span class="divider">|</span>
              <b>${escapeHtml(g.materialNumber  || "-")}</b>
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
      const segs = u.segs.filter(seg =>
          seg.end.getTime() > rangeMin.getTime() &&
          seg.start.getTime() < rangeMax.getTime()
        );
      

      const lanes = buildLanes(segs).map(laneSegs =>
        injectWaitingIntoLane(laneSegs, segs)
      );
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
        const hasAutoStopCandidate = laneSegs.some(s => s.isAutoStopCandidate);
        const realLaneSegs = laneSegs.filter(seg => seg.phase !== "waiting" && seg.status !== "waiting");
        const cur = latestSegment(realLaneSegs) || null;
        const procNo = getProcessNo(cur);
        const st = statusUi(cur?.status);

        const timeBands = buildDailyTimeBands(rangeMin, rangeMax, hourW)

        /* Build bars for standard time */
        const standardBars = laneSegs
        .filter(seg => seg.phase !== "waiting")
        .map(seg => {
          const stdSlices = buildStandardSlices(seg);
          const isLate = isLateAgainstStandard(seg);

          return stdSlices.map(slice => {
            const stdStartMs = clamp(slice.start.getTime(), rangeMin.getTime(), rangeMax.getTime());
            const stdEndMs = clamp(slice.end.getTime(), rangeMin.getTime(), rangeMax.getTime());

            if (stdEndMs <= stdStartMs) return "";

            const leftPx = ((stdStartMs - rangeMin.getTime()) / 3600000) * hourW;
            const widthPx = Math.max(8, ((stdEndMs - stdStartMs) / 3600000) * hourW);

            return `
              <div class="bar standardBar ${isLate ? "standardLate" : ""}"
                  style="left:${leftPx}px; width:${widthPx}px;"
                  data-tip="${escapeAttr(
                    standardTipText(seg, new Date(stdStartMs), new Date(stdEndMs))
                  )}">
              </div>
            `;
          }).join("");
        })
        .join("");

        /* Build bars for actual time */
        const bars = laneSegs.map(seg => {
          const parts = sliceSegForWaiting(seg);

          return parts
            .filter(p => !(p.end.getTime() <= rangeMin.getTime() || p.start.getTime() >= rangeMax.getTime()))
            .map(p => {
              const sliceStart = new Date(Math.max(p.start.getTime(), rangeMin.getTime()));
              const sliceEnd   = new Date(Math.min(p.end.getTime(), rangeMax.getTime()));

              const leftPx  = ((sliceStart.getTime() - rangeMin.getTime()) / 3600000) * hourW;
              const widthPx = Math.max(10, ((sliceEnd.getTime() - sliceStart.getTime()) / 3600000) * hourW);

              const isHoldGap = (p.type === "on_hold_gap");
              const isWaiting = (p.type === "waiting" || seg.phase === "waiting" || seg.status === "waiting");

              const stClass =
                isHoldGap ? "st-holdgap" :
                isWaiting ? "st-waiting" :
                stationClass(seg.station);

              const statusCls =
                isHoldGap ? "status-holdgap" :
                isWaiting ? "status-waiting" :
                seg.status === "completed" ? "status-completed" :
                seg.status === "on_hold" ? "status-onhold" :
                "status-running";

              const tipText = tipTextBuilder(
                seg,
                sliceStart,
                sliceEnd,
                isHoldGap ? "on_hold_gap" : isWaiting ? "waiting" : "process",
                p
              );

              return `
                <div class="bar ${stClass} ${statusCls}"
                    style="left:${leftPx}px; width:${widthPx}px;"
                    data-tip="${escapeAttr(tipText)}">
                </div>
              `;
            })
            .join("");
        }).join("");
                

        /* Return two rows - one for standard, and one for actual */
       return `
        <div class="unitLanePair ${hasAutoStopCandidate ? 'autoStopHighlight' : ''}">
          <div class="ganttCell procNo mergedProcNo">
            <div style="font-weight:900;">${escapeHtml(procNo)}</div>
          </div>

          <div class="ganttCell status standardLaneRow">
            <span class="statusPill standard">Standard</span>
          </div>

          <div class="ganttTimeline dailyGrid standardLaneRow" style="width:${totalWidthPx}px">
            ${timeBands}
            ${standardBars}
          </div>

          <div class="ganttCell status">
            <span class="statusPill ${st.cls}">${escapeHtml(st.text)}</span>
          </div>

          <div class="ganttTimeline dailyGrid" style="width:${totalWidthPx}px">
            ${timeBands}
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
  /* const groups = buildMaterialGroups(segments); */
  const groups = buildChillerGroups(segments);
  /* const groupArr = Array.from(groups.values()).sort((a,b) =>
    (a.projectName || "").localeCompare(b.projectName || "") ||
    (a.materialNumber || "").localeCompare(b.materialNumber || "")
  ); */
  const groupArr = Array.from(groups.values()).sort((a,b) =>
    (a.projectName || "").localeCompare(b.projectName || "") ||
    (a.chillerSerialNumber || "").localeCompare(b.chillerSerialNumber || "")
  );

  bodyEl.innerHTML = groupArr.map(g => {

    

    // Group header row (Project + Material)
    const headerRow = `
      <div class="ganttRow groupRow">
        <div class="ganttCell project" style="grid-column: 1 / span 3;">
          <div class="groupHeaderRow">
            <div class="title">${escapeHtml(g.projectName)}</div>
            <div class="materialRight">
              <b>${escapeHtml(g.chillerSerialNumber  || "-")}</b>
              <span class="divider">|</span>
              <b>${escapeHtml(g.materialNumber|| "-")}</b>
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
      const visibleSegs = u.segs.filter(
        seg => !(seg.end.getTime() <= rangeMin.getTime() || seg.start.getTime() >= rangeMax.getTime())
      );

      const segsWithWaiting = injectWaitingIntoUnitSegs(visibleSegs);

      const cur = latestSegment(visibleSegs) || null;
      const procNo = getProcessNo(cur?.processLabel);
      const st = statusUi(cur?.status);

      const bars = segsWithWaiting
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

                  const isHoldGap = (p.type === "on_hold_gap");
                  const isWaiting = (p.type === "waiting" || seg.phase === "waiting" || seg.status === "waiting");

                  const stClass =
                    isHoldGap ? "st-holdgap" :
                    isWaiting ? "st-waiting" :
                    stationClass(seg.station);

                  const statusCls =
                    isHoldGap ? "status-holdgap" :
                    isWaiting ? "status-waiting" :
                    seg.status === "completed" ? "status-completed" :
                    seg.status === "on_hold" ? "status-onhold" :
                    "status-running";

                  
                  const tipText = tipTextBuilder(
                    seg,
                    sliceStart,
                    sliceEnd,
                    isHoldGap ? "on_hold_gap" : isWaiting ? "waiting" : "process",
                    p
                  );

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

async function render({ forceRefresh = false } = {}) {

  try {
    let runs = [];

    const mode = el("dateMode")?.value || "daily";

    const picker = el("dayPicker");
    const todayKey = getMYTodayKey();
    const dayKey = picker?.value || todayKey;

    if (!isPastCutoff()) {
      btnAutoStop.disabled = true;
      btnAutoStop.title = "Available after 5:30 PM";
    } else {
      btnAutoStop.disabled = false;
      btnAutoStop.title = "";
    }

    if (mode === "daily" || mode === "station") {
      runs = await loadRunsForDayWithCarryForward(dayKey, forceRefresh);
    }
    else if (mode === "month") {
      const mp = el("monthPicker");
      const now = new Date();
      const def = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
      const [yy, mm] = (mp?.value || def).split("-").map(Number);

      const monthKey = `${yy}-${String(mm).padStart(2, "0")}`;

      if (!forceRefresh && cachedRunsByMonth.has(monthKey)) {
        runs = cachedRunsByMonth.get(monthKey);
      } else {
        const lastDay = new Date(yy, mm, 0).getDate();

        const startKey = `${yy}-${String(mm).padStart(2, "0")}-01`;
        const endKey = `${yy}-${String(mm).padStart(2, "0")}-${String(lastDay).padStart(2, "0")}`;


        const q = query(
          collectionGroup(db, "runs"),
          where("runDate", ">=", startKey),
          where("runDate", "<=", endKey)
        );

        const snap = await getDocs(q);
        runs = [];
        snap.forEach(d => runs.push({ id: d.id, ...d.data() }));

        cachedRunsByMonth.set(monthKey, runs);
      }
    }

    if (!runs.length) {
      bodyEl.innerHTML = "";
      monthHeadEl.innerHTML = "";
      dayHeadEl.innerHTML = "";
      return;
    }

    // Build segments FIRST
    const { segments } = buildSegmentsFromRuns(runs);
    
    const preview = await previewAutoStopRuns();

      const eligibleKeys = new Set(
      preview.eligible.map(e =>
        `${normalize(e.serialNumber)}|${normalize(e.station)}|${normalize(e.processName)}`
      )
    );

    segments.forEach(seg => {
      const key = `${normalize(seg.serial)}|${normalize(seg.station)}|${normalize(seg.processName || seg.processLabel)}`;

      seg.isAutoStopCandidate = eligibleKeys.has(key);
    });

    console.log(
      "Auto-stop candidates:",
      segments.filter(s => s.isAutoStopCandidate)
    );

    const wrap = document.querySelector(".ganttWrap");
    const grid = document.querySelector(".ganttGrid");

    wrap?.classList.toggle("dailyMode", mode === "daily");
    wrap?.classList.toggle("monthMode", mode === "month");
    wrap?.classList.toggle("stationMode", mode === "station");

    grid?.classList.toggle("dailyMode", mode === "daily");
    grid?.classList.toggle("monthMode", mode === "month");
    grid?.classList.toggle("stationMode", mode === "station");

    // DAILY MODE
    if (mode === "daily") {
      renderLegend("legendStations", LEGEND_STATIONS);
      renderLegend("legendStatus", LEGEND_STATUS);

      const picker = el("dayPicker");
      const todayKey = getMYTodayKey();
      if (picker && !picker.value) picker.value = todayKey;

      const dayDate = parseDayKeyToDate(picker?.value || todayKey);

      const rangeMin = startOfWorkDay(dayDate);
      const rangeMax = endOfWorkDay(dayDate);

      const segsInWindow = segments.filter(s =>
        hasValidSegmentDates(s) &&
        s.end.getTime() > rangeMin.getTime() &&
        s.start.getTime() < rangeMax.getTime()
      );

      fitDailyToScreen();
      const hourW = getHourW();
      document.documentElement.style.setProperty("--colW", hourW + "px");
      document.documentElement.style.setProperty("--minorDiv", "2");

      renderGanttDaily(rangeMin, rangeMax, segsInWindow);
      return;
    }

    // MONTHLY MODE
    if (mode === "month") {
      renderLegend("legendStations", LEGEND_STATIONS);
      renderLegend("legendStatus", LEGEND_STATUS);

      const mp = el("monthPicker");
      const now = new Date();
      const def = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
      if (mp && !mp.value) mp.value = def;

      const [yy, mm] = (mp?.value || def).split("-").map(Number);
      const monthStart = new Date(yy, mm - 1, 1);
      const monthEnd = new Date(yy, mm, 0);

      const dayW = getDayW();
      document.documentElement.style.setProperty("--colW", dayW + "px");
      document.documentElement.style.setProperty("--minorDiv", "1");

      const rangeMin = startOfDay(monthStart);
      const rangeMax = endOfDay(monthEnd);

      const segsInMonth = segments.filter(s =>
        hasValidSegmentDates(s) &&
        s.end.getTime() > rangeMin.getTime() &&
        s.start.getTime() < rangeMax.getTime()
      );

      if (!segsInMonth.length) {
        bodyEl.innerHTML = `
          <div class="emptyState">
            No projects found for the selected month.
          </div>
        `;
        monthHeadEl.innerHTML = buildMonthHeader(buildDateRange(rangeMin, rangeMax));
        dayHeadEl.innerHTML = buildDateRange(rangeMin, rangeMax).map(d => `
          <div class="dayCol">
            <div class="d1">${dateKey(d)}</div>
            <div class="d2">${weekdayName(d)}</div>
          </div>
        `).join("");
        return;
      }

      const days = buildDateRange(rangeMin, rangeMax);
      renderGantt(days, rangeMin, rangeMax, segsInMonth);
      return;
    }

    // STATION MODE
    if (mode === "station") {
      renderLegendStatus(); // keep existing status legend if needed

      const picker = el("dayPicker"); // use dayPicker, not datePicker
      const todayKey = getMYTodayKey();
      if (picker && !picker.value) picker.value = todayKey;

      const dayDate = parseDayKeyToDate(picker?.value || todayKey);

      const rangeMin = startOfWorkDay(dayDate);
      const rangeMax = endOfWorkDay(dayDate);
        

      const segsInWindow = segments.filter(s =>
        hasValidSegmentDates(s) &&
        s.end.getTime() > rangeMin.getTime() &&
        s.start.getTime() < rangeMax.getTime()
      );

      fitDailyToScreen();
      const hourW = getHourW();
      document.documentElement.style.setProperty("--colW", hourW + "px");
      document.documentElement.style.setProperty("--minorDiv", "2");

      if (!segsInWindow.length) {
        bodyEl.innerHTML = `
          <div class="emptyState">
            No projects found for the selected day.
          </div>
        `;
        if (dayHeadEl) dayHeadEl.innerHTML = buildHourHeader();
        if (monthHeadEl) monthHeadEl.innerHTML = "";
        renderStationLegend([]);
        return;
      }

      renderGanttStation(rangeMin, rangeMax, segsInWindow);
      return;
    }

  } catch (err) {
    console.error(err);
  }
}

export function syncPickers(){
  const mode = el("dateMode")?.value || "daily";
  const daySlot = el("daySlot");
  const monthSlot = el("monthSlot");
  const btnToday = el("btnToday");

  if (daySlot) daySlot.classList.toggle("hidden", mode !== "daily");
  if (monthSlot) monthSlot.classList.toggle("hidden", mode !== "month");

  // TODAY button only for month mode
  if (btnToday) btnToday.classList.toggle("hidden", mode !== "month");
}

const stationBalancePicker = el("stationBalancePicker");
if (stationBalancePicker) {
  stationBalancePicker.addEventListener("change", async () => {
    await renderStationOnlyView();
  });
}

/* UI events */
const btnExport = el("btn-export");
if (btnExport) {
  btnExport.addEventListener("click", async () => {
    // Ensure we have the latest data (so export always includes newest runs)
    const runs = await loadRuns();   // reload from Firestore
    exportExcelReport(runs);
  });
}

/* Start */
export async function renderGanttView({ forceRefresh = false } = {}) {
  console.log("GANTT RENDER CALLED");
  await render({ forceRefresh });

  startGanttLiveRefresh();
}

/* Update the left header */
export function updateGanttLeftHeaders() {
  const mode = el("dateMode")?.value || "daily";
  const heads = document.querySelectorAll(".ganttHead .ganttLeftHead");

  if (heads.length < 3) return;

  if (mode === "station") {
    heads[0].textContent = "Station";
    heads[1].textContent = "Process Used";
    heads[2].textContent = "Overall Status";
    return;
  }

  heads[0].textContent = "Unit";
  heads[1].textContent = "Process No.";
  heads[2].textContent = "Status";
}


/* Tooltip functions */
function clearBarHover() {
  document.querySelectorAll(".bar-hover").forEach(el => {
    el.classList.remove("bar-hover");
  });

  document.querySelectorAll(".bar-dim").forEach(el => {
    el.classList.remove("bar-dim");
  });
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

/* Update here to hide tip if there are more stations */
function hideTip(){
  if (!tipEl) return;
  tipEl.classList.remove(
    "show",
    "status-waiting",
    "status-holdgap",
    "status-standard",
    "st-pv1",
    "st-pv2",
    "st-subassy",
    "st-piping",
    "st-fabrication",
    "st-pneumatic",
    "st-wc1",
    "st-wc2",
    "st-ac",
    "st-insulationab",
    "st-insulationg",
    "st-packing",
    "st-mig"

  );

  const tip = document.querySelector(".ganttTip");
  if (tip) tip.classList.remove("show");
  clearBarHover();
}

/* Show tool tip when interact with bar */
function showTipForBar(barEl){
  const tip = ensureTip();
  const html = barEl.getAttribute("data-tip") || "";
  if (!html) return;

  tip.className = "ganttTip show";

  clearBarHover();

  barEl.classList.add("bar-hover");

  const row = barEl.closest(".ganttRow");
  row?.querySelectorAll(".bar").forEach(el => {
    if (el !== barEl) el.classList.add("bar-dim");
  });

  // FIRST: handle status pills (Tree View)
  if (barEl.classList.contains("statusPill")) {
    if (barEl.classList.contains("running")) {
      tip.classList.add("status-running");
    }
    else if (barEl.classList.contains("completed")) {
      tip.classList.add("status-completed");
    }
    else if (barEl.classList.contains("on_hold") || barEl.classList.contains("onhold")) {
      tip.classList.add("status-onhold");
    }

    tip.innerHTML = html;
    return; //  IMPORTANT: stop here
  }

  // GANTT LOGIC BELOW

  if (barEl.classList.contains("standardBar")) {
    tip.classList.add("status-standard");
  }
  else if (barEl.classList.contains("status-holdgap")) {
    tip.classList.add("status-holdgap");
  }
  else if (barEl.classList.contains("status-waiting") || barEl.classList.contains("waiting")) {
    tip.classList.add("status-waiting");
  }
  else {
    // station-based color
    if (barEl.classList.contains("st-pv1")) tip.classList.add("st-pv1");
    else if (barEl.classList.contains("st-pv2")) tip.classList.add("st-pv2");
    else if (barEl.classList.contains("st-subassy")) tip.classList.add("st-subassy");
    else if (barEl.classList.contains("st-piping")) tip.classList.add("st-piping");
    else if (barEl.classList.contains("st-fabrication")) tip.classList.add("st-fabrication");
    else if (barEl.classList.contains("st-pneumatic")) tip.classList.add("st-pneumatic");
    else if (barEl.classList.contains("st-wc1")) tip.classList.add("st-wc1");
    else if (barEl.classList.contains("st-wc2")) tip.classList.add("st-wc2");
    else if (barEl.classList.contains("st-ac")) tip.classList.add("st-ac");
    else if (barEl.classList.contains("st-insulationab")) tip.classList.add("st-insulationab");
    else if (barEl.classList.contains("st-insulationg")) tip.classList.add("st-insulationg");
    else if (barEl.classList.contains("st-ipacking")) tip.classList.add("st-packing");
    else if (barEl.classList.contains("st-mig")) tip.classList.add("st-mig");
  }

  tip.innerHTML = html;
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
  document.addEventListener("mouseover", (e) => {
    const tipTarget = e.target.closest?.(".bar[data-tip], .statusPill[data-tip]");
    if (!tipTarget) return;
    showTipForBar(tipTarget);
  });

  document.addEventListener("mousemove", (e) => {
    if (!tipEl || !tipEl.classList.contains("show")) return;
    positionTip(e.clientX, e.clientY);
  });

  document.addEventListener("mouseout", (e) => {
    const tipTarget = e.target.closest?.(".bar[data-tip], .statusPill[data-tip]");
    if (!tipTarget) return;
    hideTip();
  });

  document.addEventListener("scroll", () => hideTip(), true);
}

/* Make the resize handler page aware */

window.addEventListener("resize", async () => {
  // Main dashboard page
  if (el("dateMode")) {
    fitDailyToScreen();
    await render();
    return;
  }

  // Station-only page
  if (document.body.classList.contains("station-page")) {
    fitDailyToScreen();
    await renderStationOnlyView();
  }
});

const btnAutoStop = document.getElementById("btnAutoStop");

function showAutoStopPopup({
  title = "Auto Stop",
  message = "",
  confirmText = "OK",
  cancelText = "",
  tone = "info"
} = {}) {
  return new Promise(resolve => {
    document.getElementById("auto-stop-popup")?.remove();

    const popup = document.createElement("div");
    popup.id = "auto-stop-popup";
    popup.innerHTML = `
      <div class="autoStopCard ${escapeHtml(tone)}">
        <div class="autoStopMark">${tone === "danger" ? "!" : tone === "success" ? "OK" : "i"}</div>
        <div class="autoStopTitle">${escapeHtml(title)}</div>
        <div class="autoStopText">${escapeHtml(message)}</div>
        <div class="autoStopActions">
          ${cancelText ? `<button type="button" class="autoStopBtn secondary" data-action="cancel">${escapeHtml(cancelText)}</button>` : ""}
          <button type="button" class="autoStopBtn primary" data-action="confirm">${escapeHtml(confirmText)}</button>
        </div>
      </div>
    `;

    const close = value => {
      popup.remove();
      resolve(value);
    };

    popup.addEventListener("click", e => {
      if (e.target === popup) close(false);
      const action = e.target?.dataset?.action;
      if (action === "confirm") close(true);
      if (action === "cancel") close(false);
    });

    document.body.appendChild(popup);
    popup.querySelector(".autoStopBtn.primary")?.focus();
  });
}

if (btnAutoStop) {
  btnAutoStop.addEventListener("click", async () => {
  try {
    const cutoff = getCutoffState();

    if (!cutoff) {
      await showAutoStopPopup({
        title: "Auto Stop Not Available",
        message: "Auto stop is only allowed after 5:30 PM.",
        confirmText: "Got it",
        tone: "info"
      });
      return;
    }

    const preview = await previewAutoStopRuns();

    if (!preview.eligible.length) {
      await showAutoStopPopup({
        title: "No Candidates",
        message: "There are no running processes to auto-stop.",
        confirmText: "Got it",
        tone: "info"
      });
      return;
    }

    const ok = await showAutoStopPopup({
      title: "Run Auto Stop?",
      message: `${preview.eligible.length} processes will be auto-held. Proceed?`,
      confirmText: "Run Auto Stop",
      cancelText: "Cancel",
      tone: "danger"
    });

    if (!ok) return;

      btnAutoStop.disabled = true;
      btnAutoStop.textContent = "Running...";

      const result = await autoStopRuns();

      console.log("Auto stop result:", result);

      await render(); // refresh dashboard after update

      await showAutoStopPopup({
        title: "Auto Stop Complete",
        message: `Updated ${result.updated} run(s).`,
        confirmText: "Done",
        tone: "success"
      });
    } catch (err) {
      console.error("Auto stop failed:", err);
      await showAutoStopPopup({
        title: "Auto Stop Failed",
        message: "Auto stop failed. Check console for details.",
        confirmText: "Close",
        tone: "danger"
      });
    } finally {
      btnAutoStop.disabled = false;
      btnAutoStop.textContent = "Run Auto Stop";
    }
  });

}

const btnExportStationExcel = document.getElementById("btnExportStationExcel");

btnExportStationExcel?.addEventListener("click", async () => {
  await exportStationSelectedDateExcel();
});


bindFloatingTooltip();
