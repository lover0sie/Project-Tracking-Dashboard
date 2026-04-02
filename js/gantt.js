import { loadRuns, clearCache } from "./timeline.js";

// Estimated time in minutes for each process
const STANDARD_TIME_MIN = {
  "6 - Hole bevelling": 80,
  "7 - Connector welding": 100,
  "8A - Fitting internal plate": 200,
  "8B - GMAW C&B": 300,
  "9 - Fitting and welding distribution box": 250,
  "10 - Tube support, bush fitting, and tube sheet fitting": 200,
  "11 - Tubesheet welding": 220,
  "12 - Bracket and attachment welding, copper tube brazing": 340,
  "13 - Unit side plate and base welding": 380,
  "14A - Tube slotting": 100,
  "14B - Tube expansion": 400,
  "15 - Primer painting": 180,
  "16 - Pneumatic testing": 120,
  "17 - Hydrostatic testing": 300,
  "18, 19 - Primer painting (weld seam) and top coat painting": 600,

  "6, 7 - Hole bevelling and connector welding": 200,
  "8, 9, 10, 11 - Internal plate, distribution box, tube support and bush fitting and welding": 500,
  "12 - Bracket and attachment fitting and welding": 300,
  "19 - Top coat painting": 400,

  "Piping shop": 300,
  "A - Insulation 1": 480,
  "B - Insulation 2": 480,
  "C - Major components assembly": 600,
  "D - Steel pipe welding": 300,
  "E - Copper pipe brazing": 350,
  "F - Control box and wiring": 240,
  "G - Piping insulation": 500,
  "H - Packing": 360
  
}


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

function isLateAgainstStandard(seg) {
  const varianceMs = getVarianceMs(seg);
  return varianceMs != null && varianceMs > 0;
}

function getDailyBreakWindows(baseDate) {
  const makeRange = (startH, startM, endH, endM) => {
    const start = new Date(baseDate);
    start.setHours(startH, startM, 0, 0);

    const end = new Date(baseDate);
    end.setHours(endH, endM, 0, 0);

    return { start, end };
  };

  return [
    makeRange(10, 0, 10, 15),
    makeRange(12, 0, 12, 30),
    makeRange(15, 0, 15, 15)
  ];
}

function overlapMs(startA, endA, startB, endB) {
  const start = Math.max(startA.getTime(), startB.getTime());
  const end = Math.min(endA.getTime(), endB.getTime());
  return Math.max(0, end - start);
}

function getBreakOverlapMs(start, end) {
  if (!start || !end || end <= start) return 0;

  let total = 0;

  let curDay = new Date(start);
  curDay.setHours(0,0,0,0);

  const lastDay = new Date(end);
  lastDay.setHours(0,0,0,0);

  while (curDay <= lastDay) {

    const breaks = getDailyBreakWindows(curDay);

    for (const b of breaks) {
      total += overlapMs(start, end, b.start, b.end);
    }

    curDay.setDate(curDay.getDate() + 1);
  }

  return total;
}

// Legacy function since currently using buildHoldWindowsFromRun
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

let ganttLiveTimer = null;

function startGanttLiveRefresh() {
  stopGanttLiveRefresh();
  ganttLiveTimer = setInterval(() => {
    renderGanttView();
  }, 60000); // every 1 minute
}

export function stopGanttLiveRefresh() {
  if (ganttLiveTimer) {
    clearInterval(ganttLiveTimer);
    ganttLiveTimer = null;
  }
}


function getEffectiveDurationMs(start, end) {
  if (!start || !end || end <= start) return 0;

  const raw = end.getTime() - start.getTime();
  const breakMs = getBreakOverlapMs(start, end);

  return Math.max(0, raw - breakMs);
}

function getActualEffectiveDurationMs(seg) {
  const parts = sliceSegForWaiting(seg);

  let total = 0;

  for (const p of parts) {
    if (p.type !== "process") continue;
    if (!p.start || !p.end || p.end <= p.start) continue;

    const elapsed = p.end.getTime() - p.start.getTime();
    const breakMs = getBreakOverlapMs(p.start, p.end);

    total += Math.max(0, elapsed - breakMs);
  }

  return total;
}


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
function injectWaitingIntoLane(laneSegs) {
  const out = [];
  if (!Array.isArray(laneSegs) || !laneSegs.length) return out;

  const sorted = [...laneSegs].sort((a, b) => a.start - b.start);

  for (let i = 0; i < sorted.length; i++) {
    const cur = sorted[i];
    out.push(cur);

    const next = sorted[i + 1];
    if (!next) continue;

    const gapStart = cur.end;
    const gapEnd = next.start;

    if (
      gapStart &&
      gapEnd &&
      gapEnd.getTime() > gapStart.getTime()
    ) {
      out.push({
        phase: "waiting",
        status: "waiting",
        start: gapStart,
        end: gapEnd,
        station: cur.station,
        processLabel: "Waiting",
        projectName: cur.projectName,
        materialNumber: cur.materialNumber,
        description: cur.description,
        serial: cur.serial,
        qrKind: cur.qrKind,
        chillerSerialNumber: cur.chillerSerialNumber,
        pvSerialNumber: cur.pvSerialNumber,
        vesselType: cur.vesselType,
        coolingType: cur.coolingType
      });
    }
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


/* Get the unit type based on the qr code */
function getUnitType(r) {
  if (String(r.qrKind || "").toUpperCase() === "PV") {
    return r.vesselType || "PV";
  }
  return "CHILLER";
}

function getCurrentHoldDurationMs(run) {
  const windows = buildHoldWindowsFromRun(run, new Date());
  const openWindow = windows.find(w => w.isOpen);
  if (!openWindow) return 0;
  return Math.max(0, openWindow.end.getTime() - openWindow.start.getTime());
}

function getTotalHoldDurationMs(seg) {
  const windows = buildHoldWindowsFromRun(seg, new Date());
  return windows.reduce((sum, w) => {
    return sum + Math.max(0, w.end.getTime() - w.start.getTime());
  }, 0);
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
      <div class="tipTitle">ON HOLD</div>
      <div class="tipRow"><span class="tipLabel">Process:</span> ${seg.processLabel || "-"}</div>
      <div class="tipRow"><span class="tipLabel">Start:</span> ${formatDateTime(sliceStart)}</div>
      <div class="tipRow"><span class="tipLabel">End:</span> ${endText}</div>
      <div class="tipRow"><span class="tipLabel">Duration:</span> ${formatDuration(holdMs)}</div>
      <div class="tipRow"><span class="tipLabel">Reason:</span> ${
        holdReason === "others" && remarks
          ? "Others"
          : (normalizeHoldReason(holdReason) || "-")
      }</div>
      <div class="tipRow"><span class="tipLabel">Remark:</span> ${remarks || "-"}</div>
    `;
  }

  // WAITING slice
  if (isWaiting) {
    return `
      <div class="tipTitle">WAITING</div>
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
    <div class="tipRow"><span class="tipLabel">Station:</span> ${seg.station || "-"}</div>
    <div class="tipRow"><span class="tipLabel">Started By:</span> ${seg.employeeName || "-"} (${seg.employeeNumber || "-"})</div>
    <div class="tipRow"><span class="tipLabel">Resumed By:</span> ${seg.resumedByName || "-"} (${seg.resumedByNumber || "-"})</div>
    <div class="tipRow"><span class="tipLabel">Manpower:</span> ${seg.manpower ?? "-"}</div>
    <div class="tipRow"><span class="tipLabel">Start:</span> ${formatDateTime(realFrom)}</div>
    <div class="tipRow"><span class="tipLabel">End:</span> ${endText}</div>
    <div class="tipRow"><span class="tipLabel">Effective Duration:</span> ${formatDuration(sliceEffectiveMs)}</div>
    <div class="tipRow"><span class="tipLabel">Total Effective Duration:</span> ${formatDuration(totalEffectiveMs)}</div>
  `;
}

/* div class  not used */
/* <div class="tipRow"><span class="tipLabel">Slice Duration:</span> ${formatDuration(sliceDurationMs)}</div> */

/* Get the standard time in minutes */
function getStandardMinutes(processLabel) {
  return Number(STANDARD_TIME_MIN[processLabel] || 0);
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
    <div class="tipTitle">STANDARD TIME</div>
    <div class="tipRow"><span class="tipLabel">Process:</span> ${seg.processLabel || "-"}</div>
    <div class="tipRow"><span class="tipLabel">Standard Duration:</span> ${formatDuration(stdMs)}</div>
    <div class="tipRow"><span class="tipLabel">Effective Duration:</span> ${formatDuration(actualEffectiveMs)}</div>
    <div class="tipRow"><span class="tipLabel">Variance:</span> ${formatVariance(varianceMs)}</div>
    <div class="tipDivider"></div>
    <div class="tipRow"><span class="tipLabel">On Hold:</span> ${formatDuration(holdMs)}</div>
    <div class="tipRow"><span class="tipLabel">Break:</span> ${formatDuration(breakMs)}</div>
  `;
}


/* Fitting the columns of daily into the screen */
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
  const timelineWidth = Math.max(0, wrapWidth - (colProject + colProc + colStatus));

  // compute hour width from the visible space so the full daily grid fits the viewport
  const hourW = Math.max(16, Math.floor(timelineWidth / hoursCount));

  document.documentElement.style.setProperty("--hourW", hourW + "px");
}


/* Create waiting and on hold process based on the status */
function sliceSegForWaiting(seg) {
  const parts = [];
  const s = seg.start;
  const e = seg.end;
  if (!s || !e) return parts;

  if (seg.phase === "waiting" || seg.status === "waiting") {
    parts.push({ type: "waiting", start: s, end: e });
    return parts;
  }

  const windows = Array.isArray(seg.holdWindows) ? seg.holdWindows : [];

  if (!windows.length) {
    parts.push({ type: "process", start: s, end: e });
    return parts;
  }

  let cursor = s;

  for (const w of windows) {
    const holdStart = w.start instanceof Date ? w.start : new Date(w.start);

    // KEY FIX:
    const holdEnd = w.isOpen
      ? new Date()
      : (w.end instanceof Date ? w.end : new Date(w.end));

    if (!(holdStart instanceof Date) || isNaN(holdStart)) continue;
    if (!(holdEnd instanceof Date) || isNaN(holdEnd)) continue;
    if (holdEnd <= holdStart) continue;

    if (holdStart > cursor) {
      parts.push({
        type: "process",
        start: cursor,
        end: holdStart
      });
    }

    parts.push({
      type: "on_hold_gap",
      start: holdStart,
      end: holdEnd,
      holdReason: w.holdReason || "",
      remarks: w.remarks || "",
      isOpen: !!w.isOpen
    });

    cursor = holdEnd;
  }

  if (cursor < e) {
    parts.push({
      type: "process",
      start: cursor,
      end: e
    });
  }

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
  x.setHours(END_HOUR, 0,0,0);
  return x;
}

function hourLabel(h){
  // h in 24h
  const isPM = h >= 12;
  const twelve = (h % 12) || 12;
  return `${twelve}:00 ${isPM ? "PM" : "AM"}`;
}

/* Get the process number to display in the Process No. column */
function getProcessNo(processLabel){
  if(!processLabel) return "";

  // Special case

  if (processLabel.toLowerCase() === "piping shop") { return "Piping Shop";}

  const nums = processLabel.split("-")[0];
  return nums.replace(/\s+/g,"");
}

/* Normalize status */
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

/* =========================
   HOLD WINDOWS BUILDER
   supports:
   - old data version (single hold/resume fields)
   - new data version (holds[] / resumes[])
   - active on_hold without resume yet
========================= */
function buildHoldWindowsFromRun(r, segEnd = new Date()) {
  const windows = [];
  const status = String(r?.status || "").toLowerCase().trim();
  const effectiveEnd = segEnd instanceof Date ? segEnd : new Date(segEnd);

  const toDateSafe = (v) => {
    if (!v) return null;
    if (v instanceof Date) return isNaN(v.getTime()) ? null : v;
    if (typeof v === "number") {
      const d = new Date(v);
      return isNaN(d.getTime()) ? null : d;
    }
    if (typeof v?.toDate === "function") {
      const d = v.toDate();
      return d instanceof Date && !isNaN(d.getTime()) ? d : null;
    }
    return null;
  };

  // =========================
  // NEW SYSTEM: holds[] / resumes[]
  // =========================
  const holdsArr = Array.isArray(r?.holds) ? r.holds : [];
  const resumesArr = Array.isArray(r?.resumes) ? r.resumes : [];

  if (holdsArr.length > 0) {
    const holds = holdsArr
      .map((h) => ({
        holdAt:
          toDateSafe(h?.holdAtEpochMs) ||
          toDateSafe(h?.holdEpochMs) ||
          toDateSafe(h?.holdAt),
        holdReason: h?.holdReason || "",
        remarks: h?.remarks || ""
      }))
      .filter((h) => h.holdAt)
      .sort((a, b) => a.holdAt - b.holdAt);

    const resumes = resumesArr
      .map((x) => ({
        resumedAt:
          toDateSafe(x?.resumedAtEpochMs) ||
          toDateSafe(x?.resumeEpochMs) ||
          toDateSafe(x?.resumedAt) ||
          toDateSafe(x?.resumeAt)
      }))
      .filter((x) => x.resumedAt)
      .sort((a, b) => a.resumedAt - b.resumedAt);

    let resumeIdx = 0;

    for (const h of holds) {
      while (
        resumeIdx < resumes.length &&
        resumes[resumeIdx].resumedAt <= h.holdAt
      ) {
        resumeIdx++;
      }

      const matchedResume =
        resumeIdx < resumes.length ? resumes[resumeIdx] : null;

      const holdEnd =
        matchedResume?.resumedAt ||
        (status === "on_hold" ? effectiveEnd : null);

      if (!holdEnd || holdEnd <= h.holdAt) continue;

      windows.push({
        start: h.holdAt,
        end: holdEnd,
        holdReason: h.holdReason,
        remarks: h.remarks,
        isOpen: !matchedResume && status === "on_hold"
      });

      if (matchedResume) resumeIdx++;
    }

    return windows;
  }

  // =========================
  // OLD SYSTEM: single hold/resume fields
  // =========================
  const holdAt =
    toDateSafe(r?.holdEpochMs) ||
    toDateSafe(r?.holdAt);

  const resumedAt =
    toDateSafe(r?.resumedEpochMs) ||
    toDateSafe(r?.resumeEpochMs) ||
    toDateSafe(r?.resumedAt) ||
    toDateSafe(r?.resumeAt);

  if (holdAt) {
    const end =
      resumedAt ||
      (status === "on_hold" ? effectiveEnd : null);

    if (end && end > holdAt) {
      windows.push({
        start: holdAt,
        end,
        holdReason: r?.holdReason || "",
        remarks: r?.remarks || "",
        isOpen: !resumedAt && status === "on_hold"
      });
    }
  }

  return windows;
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
  if (s.includes ("wc1")) return "st-wc1"; // WC Line 1
  if (s.includes ("wc2")) return "st-wc2"; // WC Line 2
  if (s.includes ("ac")) return "st-ac"; // AC Line
  if (s.includes ("insulationab")) return "st-insulation1"; // Insulation AB 
  if (s.includes ("insulationg")) return "st-insulation2"; // Insulation G
  if (s.includes ("packing")) return "st-packing"; // Packing
  if (s.includes ("migwelding")) return "st-mig"; // Packing

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

    const holdWindows = buildHoldWindowsFromRun(r, end);

    segments.push({
      serial,
      projectName: r.projectName || "(No Project)",
      materialNumber: r.materialNumber || "",
      description: r.description || "",
      station,
      phase: "process",
      processLabel: r.processName || "-",
      manpower: Number(r.manpower ?? 0) || 0,
      employeeName: r.startedByName || "",
      employeeNumber: r.startedByNumber || "",
      resumedByName: r.resumedByName || "",
      resumedByNumber: r.resumedByNumber || "",
      start,
      end,
      status,
      holdReason: r.holdReason || "",
      remarks: r.remarks || "",

      holdAt: holdTime || null,
      resumedAt: resumed || null,
      holdEpochMs: r.holdEpochMs ?? null,
      resumedEpochMs: r.resumedEpochMs ?? null,
      holds: Array.isArray(r.holds) ? r.holds : [],
      resumes: Array.isArray(r.resumes) ? r.resumes : [],

      qrKind: r.qrKind || "",
      chillerSerialNumber: r.chillerSerialNumber || "",
      pvSerialNumber: r.pvSerialNumber || "",
      vesselType: r.vesselType || "",
      coolingType: r.coolingType || "",

      ongoing: (status === "running" || status === "on_hold"),
      durationMs: Math.max(0, durationMs),
      holdWindows
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

function renderLegendStatus() {
  const stEl = document.getElementById("legendStatus");
  if (!stEl) return;

  stEl.innerHTML = `
    <span class="legItem">
      <span class="swatch swatch-process"></span>
      Process
    </span>
    <span class="legItem">
      <span class="swatch swatch-standard"></span>
      Standard
    </span>
    <span class="legItem">
      <span class="swatch swatch-waiting"></span>
      Waiting
    </span>
    <span class="legItem">
      <span class="swatch swatch-hold"></span>
      On Hold
    </span>
  `;
}

/* Position bars by time */
function clamp(n, a, b) { return Math.max(a, Math.min(b, n)); }

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
      

      const lanes = buildLanes(segs).map(injectWaitingIntoLane);
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
          <div class="unitLaneRow standardLaneRow">
            <div class="ganttCell procNo">
              <div style="font-weight:900;">STD</div>
            </div>

            <div class="ganttCell status">
              <span class="statusPill standard">Standard</span>
            </div>

            <div class="ganttTimeline dailyGrid" style="width:${totalWidthPx}px">
              ${timeBands}
              ${standardBars}
            </div>
          </div>

          <div class="unitLaneRow">
            <div class="ganttCell procNo">
              <div style="font-weight:900;">${escapeHtml(procNo)}</div>
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

function exportExcelReport(runs) {
  if (typeof XLSX === "undefined") {
    alert("XLSX library not loaded. Check the xlsx script tag in index.html.");
    return;
  }

  function formatExcelDate(date){
    if (!date) return "";
    const d = new Date(date);
    const day = String(d.getDate()).padStart(2, "0");
    const month = String(d.getMonth() + 1).padStart(2, "0");
    const year = d.getFullYear();
    return `${day}/${month}/${year}`;
  }

  function formatExcelTime(date){
    if (!date) return "";
    const d = new Date(date);

    let hours = d.getHours();
    const minutes = String(d.getMinutes()).padStart(2, "0");
    const seconds = String(d.getSeconds()).padStart(2, "0");
    const ampm = hours >= 12 ? "PM" : "AM";

    hours = hours % 12;
    hours = hours === 0 ? 12 : hours;

    return `${hours}:${minutes}:${seconds} ${ampm}`;
  }

  const rawHeader = [
  "Project Name",
  "Description",
  "Serial Number",
  "Type",
  "Material Number",
  "Process",
  "Station",
  "Manpower",
  "Status",
  "Start Date",
  "Start Time",
  "End Date",
  "End Time",
  "Elapsed Duration (Minutes)",
  "Break Time (Minutes)",
  "Effective Duration (Minutes)",
  "Elapsed Duration (Hours)",
  "Effective Duration (Hours)",
  "Elapsed Man-Hours",
  "Effective Man-Hours"
];

  const rawRows = [rawHeader];

  const summaryMap = new Map();

  for (const r of runs) {
    const start = tsOrMsToDate(r.startAt, r.startEpochMs);
    const endCompleted = tsOrMsToDate(r.endAt, r.endEpochMs);
    const holdTime = tsOrMsToDate(r.holdAt, r.holdEpochMs);

    const status = String(r.status || "").toLowerCase().trim();

    const effectiveEnd =
      status === "completed" ? endCompleted
      : status === "on_hold" ? (holdTime || new Date())
      : new Date();

    let elapsedMs = 0;
    let breakMs = 0;
    let holdMs = 0;
    let effectiveMs = 0;

    if (start && effectiveEnd) {
      elapsedMs = Math.max(0, effectiveEnd.getTime() - start.getTime());
      breakMs = getBreakOverlapMs(start, effectiveEnd);
        if (status === "completed") {
          holdMs = getHoldDurationMsFromRun(r);
        }
        
      effectiveMs = Math.max(0, elapsedMs - breakMs - holdMs);
    }

    const elapsedMin = minutesFromMs(elapsedMs);
    const breakMin = minutesFromMs(breakMs);
    const effectiveMin = minutesFromMs(effectiveMs);

    const elapsedHours = elapsedMs > 0 ? (elapsedMs / 3600000) : 0;
    const effectiveHours = effectiveMs > 0 ? (effectiveMs / 3600000) : 0;

    const elapsedManHours = manHoursFromMs(elapsedMs, r.manpower);
    const effectiveManHours = manHoursFromMs(effectiveMs, r.manpower);

    rawRows.push([
      r.projectName || "",
      r.description || "",
      r.serialNumber || "",
      getUnitType(r),
      r.materialNumber || "",
      r.processName || "",
      r.station || "",
      r.manpower ?? "",
      String(r.status || "").replaceAll("_", " ").toUpperCase(),
      start ? formatExcelDate(start) : "",
      start ? formatExcelTime(start) : "",
      effectiveEnd ? formatExcelDate(effectiveEnd) : "",
      effectiveEnd ? formatExcelTime(effectiveEnd) : "",
      elapsedMin,
      breakMin,
      effectiveMin,
      elapsedHours.toFixed(2),
      effectiveHours.toFixed(2),
      elapsedManHours.toFixed(2),
      effectiveManHours.toFixed(2)
    ]);

    const station = r.station || "(No Station)";
    const proc = r.processName || "(No Process)";
    const key = `${station}||${proc}`;

    if (!summaryMap.has(key)) {
      summaryMap.set(key, {
        station,
        process: proc,
        runs: 0,
        totalElapsedMinutes: 0,
        totalBreakMinutes: 0,
        totalEffectiveMinutes: 0,
        totalElapsedHours: 0,
        totalEffectiveHours: 0,
        totalElapsedManHours: 0,
        totalEffectiveManHours: 0
      });
    }

    const agg = summaryMap.get(key);
    agg.runs += 1;
    agg.totalElapsedMinutes += elapsedMin;
    agg.totalBreakMinutes += breakMin;
    agg.totalEffectiveMinutes += effectiveMin;
    agg.totalElapsedHours += elapsedHours;
    agg.totalEffectiveHours += effectiveHours;
    agg.totalElapsedManHours += elapsedManHours;
    agg.totalEffectiveManHours += effectiveManHours;
  }

  const summaryHeader = [
    "Station",
    "Process",
    "Frequency",
    "Total Elapsed Minutes",
    "Total Break Minutes",
    "Total Effective Minutes",
    "Total Elapsed Hours",
    "Total Effective Hours",
    "Total Elapsed Man-Hours",
    "Total Effective Man-Hours"
  ];

  const summaryRows = [summaryHeader];

  const summaryArr = Array.from(summaryMap.values()).sort((a, b) => {
    return a.station.localeCompare(b.station) || a.process.localeCompare(b.process);
  });

  for (const s of summaryArr) {
    summaryRows.push([
      s.station,
      s.process,
      s.runs,
      s.totalElapsedMinutes,
      s.totalBreakMinutes,
      s.totalEffectiveMinutes,
      s.totalElapsedHours.toFixed(2),
      s.totalEffectiveHours.toFixed(2),
      s.totalElapsedManHours.toFixed(2),
      s.totalEffectiveManHours.toFixed(2)
    ]);
  }

  const wb = XLSX.utils.book_new();

  const wsRaw = XLSX.utils.aoa_to_sheet(rawRows);
  const wsSummary = XLSX.utils.aoa_to_sheet(summaryRows);

  wsRaw["!cols"] = [
    { wch: 24 }, // Project Name
    { wch: 22 }, // Description
    { wch: 16 }, // Serial Number
    { wch: 14 }, // Type
    { wch: 16 }, // Material Number
    { wch: 34 }, // Process
    { wch: 14 }, // Station
    { wch: 10 }, // Manpower
    { wch: 12 }, // Status
    { wch: 14 }, // Start Date
    { wch: 14 }, // Start Time
    { wch: 14 }, // End Date
    { wch: 14 }, // End Time
    { wch: 22 }, // Elapsed Duration (Minutes)
    { wch: 20 }, // Break Time (Minutes)
    { wch: 24 }, // Effective Duration (Minutes)
    { wch: 22 }, // Elapsed Duration (Hours)
    { wch: 24 }, // Effective Duration (Hours)
    { wch: 20 }, // Elapsed Man-Hours
    { wch: 22 }  // Effective Man-Hours
  ];

  wsSummary["!cols"] = [
    { wch: 14 }, // Station
    { wch: 34 }, // Process
    { wch: 10 }, // Runs
    { wch: 22 }, // Total Elapsed Minutes
    { wch: 20 }, // Total Break Minutes
    { wch: 24 }, // Total Effective Minutes
    { wch: 20 }, // Total Elapsed Hours
    { wch: 22 }, // Total Effective Hours
    { wch: 24 }, // Total Elapsed Man-Hours
    { wch: 26 }  // Total Effective Man-Hours
  ];

  XLSX.utils.book_append_sheet(wb, wsRaw, "Raw Runs");
  XLSX.utils.book_append_sheet(wb, wsSummary, "Summary");

  const filename = `ProcessReport_${new Date().toISOString().slice(0, 10)}.xlsx`;
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
    renderLegendStatus();

    const mode = el("dateMode")?.value || "daily";
    const wrap = document.querySelector(".ganttWrap");
    const grid = document.querySelector(".ganttGrid");

    wrap?.classList.toggle("dailyMode", mode === "daily");
    wrap?.classList.toggle("monthMode", mode === "month");

    grid?.classList.toggle("dailyMode", mode === "daily");
    grid?.classList.toggle("monthMode", mode === "month");

    // DAILY MODE
    if (mode === "daily") {
      const picker = el("dayPicker");
      const todayKey = getMYTodayKey();
      if (picker && !picker.value) picker.value = todayKey;

      const dayDate = parseDayKeyToDate(picker?.value || todayKey);

      const rangeMin = startOfWorkDay(dayDate);
      const rangeMax = endOfWorkDay(dayDate);

      const segsInWindow = segments.filter(s =>
        s.end.getTime() > rangeMin.getTime() && s.start.getTime() < rangeMax.getTime()
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

      const segsInMonth = segments.filter(s =>
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

/* UI events */

el("btn-export").addEventListener("click", async () => {
  // Ensure we have the latest data (so export always includes newest runs)
  const runs = await loadRuns();   // reload from Firestore
  exportExcelReport(runs);
});

/* Start */
export async function renderGanttView() {
  console.log("GANTT RENDER CALLED");
  await render();

  startGanttLiveRefresh();
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

window.addEventListener("resize", () => {
  fitDailyToScreen();
  render();
});



bindFloatingTooltip();
