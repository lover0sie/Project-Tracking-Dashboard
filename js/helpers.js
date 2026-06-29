/* Helpers shared across different js */

export const STANDARD_TIME_MIN_DETAIL = {
  "ZUWV": {
    "CHILLER": {
      "ALL": {
        "C - Major components assembly": 243.9,
        "D - Steel pipe welding": 1494.61,
        "E - Copper pipe brazing": 449.24,
        "F - Control box and wiring": 723.15,
        "G - Piping insulation": 171.8
      }
    },

    "PV": {
      "EVAPORATOR": {
        "6A - Hole Bevelling": 60,
        "7 - Connector welding": 264.83,
        "8A - Internal plate assembly": 119.13,
        "8B - Fitting internal plate": 119.13,
        "9 - Fitting and welding distribution box": 268.97,
        "10 - Tube support, bush fitting, and tube sheet fitting": 165.4,
        "11 - Tubesheet welding": 221.2,
        "12 - Bracket and attachment welding, copper tube brazing": 121.7,
        "13 - Unit side plate and base welding": 243.77,
        "14A - Tube slotting": 276.1,
        "14B - Tube expansion": 276.1,
        "15 - Primer painting": 115,
        "16 - Pneumatic testing": 30,
        "17 - Hydrostatic testing": 215.6,
        "18, 19 - Primer painting (weld seam) and top coat painting": 115
        
      },
    } 
  }, 

  "HXE-TG": {
    "PV": {
      "EVAPORATOR": {
        "9 - Fitting and welding distribution box": 250
      },
      "CONDENSER": {
        "9 - Fitting and welding distribution box": 280
      }
    }
  }
};

export const STANDARD_TIME_MIN = {
  "6A - Hole Bevelling": 80,
  "7 - Connector welding": 100,
  "8A - Internal plate assembly": 200,
  "8B - Fitting internal plate": 300,
  "8C - GMAW C&B": 400,
  "9 - Fitting and welding distribution box": 250,
  "10 - Tube support, bush fitting, and tube sheet fitting": 200,
  "11 - Tubesheet welding": 220,
  "12 - Bracket and attachment welding, copper tube brazing": 340,
  "13 - Unit side plate and base welding": 380,
  "14A - Tube slotting": 100,
  "14B - Tube expansion": 400,
  "14C - Shell body slotting": 450,
  "15 - Primer painting": 180,
  "16 - Pneumatic testing": 120,
  "17 - Hydrostatic testing": 300,
  "18, 19 - Primer painting (weld seam) and top coat painting": 600,

  // Old process name data 
  "8 - Fitting internal plate & GMAW": 100,
  "6, 7 - Hole bevelling and connector welding": 200,
  "6, 7, 8 - Hole bevelling, connector welding, fitting internal plate and GMAW C&B": 350,
  "9, 10, 11 - Distribution box, tube support and bush, tubesheet fitting and welding": 500,
  "8, 9, 10, 11 - Internal plate, distribution box, tube support and bush fitting and welding": 500,
  "12 - Bracket and attachment fitting and welding": 300,
  "12, 13 - Bracket, attachment, side plate, and base fitting and welding and copper tube brazing": 200,
  "19 - Top coat painting": 400,
  "8A - Fitting internal plate": 300,
  "8B - GMAW C&B": 210,

  "Piping shop": 300,
  "A - Insulation 1": 480,
  "B - Insulation 2": 480,
  "C - Major components assembly": 600,
  "D - Steel pipe welding": 300,
  "E - Copper pipe brazing": 350,
  "F - Control box and wiring": 240,
  "G - Piping insulation": 500,
  "H - Packing": 360
};

export const LEGEND_STATIONS = [
  // PV
  { cls: "st-pv1", label: "PV1" },
  { cls: "st-pv2", label: "PV2" },
  { cls: "st-subassy", label: "Sub Assembly" },
  { cls: "st-piping", label: "Piping" },
  { cls: "st-fabrication", label: "Fabrication" },
  { cls: "st-pneumatic", label: "Pneumatic" },

  // Chiller
  { cls: "st-wc1", label: "WC1" },
  { cls: "st-wc2", label: "WC2" },
  { cls: "st-ac", label: "AC" },
  { cls: "st-insulationab", label: "Insulation AB" },
  { cls: "st-insulationg", label: "Insulation G" },
  { cls: "st-packing", label: "Packing" },
  { cls: "st-mig", label: "MIG" },
  { cls: "st-wiring", label: "Wiring" }

];

export const LEGEND_STATUS = [
  { cls: "swatch-standard", label: "Standard" },
  { cls: "swatch-waiting", label: "Waiting" },
  { cls: "swatch-hold", label: "On Hold" }
];

/* Helpers for time */

const TZ = "Asia/Kuala_Lumpur";
const START_HOUR = 8;
const END_HOUR = 21;

export function renderLegend(containerId, items) {
  const el = document.getElementById(containerId);
  if (!el) return;

  el.innerHTML = items.map(item => `
    <span class="legItem">
      <span class="swatch ${item.cls}"></span>
      ${item.label}
    </span>
  `).join("");
}

export function getStandardMinutes({
  processLabel,
  model = "",
  qrKind = "",
  vesselType = ""
}) {

  if (!processLabel) return 0;

  const label = String(processLabel).trim();
  const cleanModel = String(model || "").trim().toUpperCase();
  const cleanQrKind = String(qrKind || "").trim().toUpperCase();
  const cleanVesselType =
    String(vesselType || "ALL").trim().toUpperCase();

  // ===== DETAIL STANDARD =====
  const modelData =
    STANDARD_TIME_MIN_DETAIL[cleanModel];

  const kindData =
    modelData?.[cleanQrKind];

  // Exact vessel match
  if (
    kindData?.[cleanVesselType]?.[label] != null
  ) {
    return kindData[cleanVesselType][label];
  }

  // CHILLER ALL fallback
  if (
    kindData?.ALL?.[label] != null
  ) {
    return kindData.ALL[label];
  }

  // ===== GLOBAL FALLBACK =====

  // Exact global match
  if (
    STANDARD_TIME_MIN[label] != null
  ) {
    return STANDARD_TIME_MIN[label];
  }

  // startsWith safety fallback
  const foundKey =
    Object.keys(STANDARD_TIME_MIN)
    .find(k => label.startsWith(k));

  if (foundKey) {
    return STANDARD_TIME_MIN[foundKey];
  }
  

  return 0;
}

export function getStandardMinutesFromLabel(processLabel, model = "") {
  if (!processLabel) return 0;

  const label = String(processLabel).trim();
  const cleanModel = String(model || "").trim().toUpperCase();

  // 1. Model-specific exact match
  if (
    STANDARD_TIME_MIN_DETAIL[cleanModel] &&
    STANDARD_TIME_MIN_DETAIL[cleanModel][label] != null
  ) {
    return STANDARD_TIME_MIN_DETAIL[cleanModel][label];
  }

  // 2. Model-specific startsWith fallback
  if (STANDARD_TIME_MIN_DETAIL[cleanModel]) {

    const foundModelKey =
      Object.keys(STANDARD_TIME_MIN_DETAIL[cleanModel])
      .find(k => label.startsWith(k));

    if (foundModelKey) {
      return STANDARD_TIME_MIN_DETAIL[cleanModel][foundModelKey];
    }

  }

  // 3. Old global exact match
  if (STANDARD_TIME_MIN[label] != null) {
    return STANDARD_TIME_MIN[label];
  }

  // 4. Old global startsWith fallback
  const foundKey =
    Object.keys(STANDARD_TIME_MIN)
    .find(k => label.startsWith(k));

  return foundKey
    ? STANDARD_TIME_MIN[foundKey]
    : 0;
}



export function getProcessNo(seg) {
  const label = String(seg?.processLabel || "").trim();
  const match = label.match(/^(\d+)/); // first number
  return match ? match[1] : label || "UNKNOWN";
}

export function getProcessCode(processName = "") {
  const str = String(processName || "").trim();

  // take everything before "-"
  const m = str.match(/^(.+?)\s*-/);
  if (!m) return str;

  let codePart = m[1].trim();

  // normalize spaces after commas → "6, 7" → "6,7"
  codePart = codePart.replace(/\s*,\s*/g, ",");

  return codePart;
}

function getSegmentSortOrder(seg) {
  const name = String(seg.processName || "");
  const m = name.match(/^(\d+)([A-Z]?)/i);

  if (!m) {
    return { major: 9999, suffix: "" };
  }

  return {
    major: Number(m[1]),
    suffix: (m[2] || "").toUpperCase()
  };
}

function compareSortOrder(a, b) {
  if ((a?.major ?? 9999) !== (b?.major ?? 9999)) {
    return (a?.major ?? 9999) - (b?.major ?? 9999);
  }
  return (a?.suffix || "").localeCompare(b?.suffix || "");
}

export function getFullProcessLabelFromSegs(processNo, segs) {
  if (!Array.isArray(segs) || !segs.length) return processNo;

  const found = segs.find(s => {
    const label = String(s.processLabel || "").trim();
    return label.startsWith(processNo);
  });

  return found?.processLabel || processNo;
}


/* Get the daily break windows */
function getDailyBreakWindows(baseDate) {
  const makeRange = (startH, startM, endH, endM) => {
    const start = new Date(baseDate);
    start.setHours(startH, startM, 0, 0);

    const end = new Date(baseDate);
    end.setHours(endH, endM, 0, 0);

    return { start, end };
  };

  return [
    makeRange(10, 0, 10, 15), // 10:00:00 AM - 10:15:00 AM
    makeRange(12, 0, 12, 30), // 12:00:00 PM - 12:30:00 PM
    makeRange(15, 0, 15, 15)  // 03:00:00 PM - 03:15:00 PM
  ];
}

/* Create waiting and on hold process based on the status */
const HOLD_DISPLAY_START_HOUR = 7;
const HOLD_DISPLAY_END_HOUR = 22;

function localDayKey(date) {
  return [
    date.getFullYear(),
    String(date.getMonth() + 1).padStart(2, "0"),
    String(date.getDate()).padStart(2, "0")
  ].join("-");
}

function workWindowStart(date) {
  return new Date(
    date.getFullYear(),
    date.getMonth(),
    date.getDate(),
    HOLD_DISPLAY_START_HOUR,
    0,
    0,
    0
  );
}

function workWindowEnd(date) {
  return new Date(
    date.getFullYear(),
    date.getMonth(),
    date.getDate(),
    HOLD_DISPLAY_END_HOUR,
    0,
    0,
    0
  );
}

function laterDate(a, b) {
  return a.getTime() >= b.getTime() ? a : b;
}

function earlierDate(a, b) {
  return a.getTime() <= b.getTime() ? a : b;
}

function buildHoldDisplayParts(window) {
  const holdStart = window.start instanceof Date ? window.start : new Date(window.start);
  const holdEnd = window.end instanceof Date ? window.end : new Date(window.end);

  if (!(holdStart instanceof Date) || isNaN(holdStart.getTime())) return [];
  if (!(holdEnd instanceof Date) || isNaN(holdEnd.getTime())) return [];
  if (holdEnd <= holdStart) return [];

  if (localDayKey(holdStart) === localDayKey(holdEnd)) {
    return [{ start: holdStart, end: holdEnd }];
  }

  const parts = [];
  const firstEnd = workWindowEnd(holdStart);
  const firstStart = laterDate(holdStart, workWindowStart(holdStart));

  if (firstEnd > firstStart) {
    parts.push({ start: firstStart, end: firstEnd });
  }

  const lastStart = workWindowStart(holdEnd);
  const lastEnd = earlierDate(holdEnd, workWindowEnd(holdEnd));

  if (lastEnd > lastStart) {
    parts.push({ start: lastStart, end: lastEnd });
  }

  return parts;
}

export function sliceSegForWaiting(seg) {
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
    const holdEnd = w.end instanceof Date ? w.end : new Date(w.end);

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

    for (const displayPart of buildHoldDisplayParts(w)) {
      parts.push({
        type: "on_hold_gap",
        start: displayPart.start,
        end: displayPart.end,
        holdReason: w.holdReason || "",
        remarks: w.remarks || "",
        isOpen: !!w.isOpen
      });
    }

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


/* Get the actual effective duration by substracting the break time from elapsed time based on slices */
export function getActualEffectiveDurationMs(seg) {
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

export function getTotalDurationMs(seg) {
  if (!seg?.start || !seg?.end) return 0;
  if (!(seg.start instanceof Date) || !(seg.end instanceof Date)) return 0;
  if (seg.end <= seg.start) return 0;

  return seg.end.getTime() - seg.start.getTime();
}

function buildStationEffectiveHoursData(segments, selectedChillerSerial) {
  const filtered = segments.filter(seg =>
    String(seg.chillerSerialNumber || "").trim() === String(selectedChillerSerial || "").trim()
  );

  const stationMap = new Map();

  for (const seg of filtered) {
    const station = String(seg.station || "Unknown").trim();
    const effectiveMs = getActualEffectiveDurationMs(seg);

    if (!stationMap.has(station)) {
      stationMap.set(station, {
        station,
        totalMs: 0,
        sortOrder: getSegmentSortOrder(seg)
      });
    }

    const row = stationMap.get(station);
    row.totalMs += effectiveMs;

    // keep earliest process order for station sorting
    const curr = getSegmentSortOrder(seg);
    if (compareSortOrder(curr, row.sortOrder) < 0) {
      row.sortOrder = curr;
    }
  }

  return Array.from(stationMap.values())
    .sort((a, b) => compareSortOrder(a.sortOrder, b.sortOrder))
    .map(item => ({
      station: item.station,
      hours: +(item.totalMs / 3600000).toFixed(2),
      totalMs: item.totalMs
    }));
}

/* Get the duration of overlap end and start time */
export function overlapMs(startA, endA, startB, endB) {
  const start = Math.max(startA.getTime(), startB.getTime());
  const end = Math.min(endA.getTime(), endB.getTime());
  return Math.max(0, end - start);
}

/* Get the duration of overlapped break time */
export function getBreakOverlapMs(start, end) {
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

export function getStandardMinutesFromProcessNo(processNo) {
  const map = {
    "10": 30,
    "20": 45,
    "30": 60
  };

  return map[processNo] || 0;
}

// Update to accept epoch long int
export function tsOrMsToDate(ts, ms) {
  if (ts && typeof ts.toDate === "function") return ts.toDate();

  const n = (typeof ms === "number") ? ms
          : (typeof ms === "string" && ms.trim() !== "" && !isNaN(ms)) ? Number(ms)
          : null;

  if (typeof n === "number" && Number.isFinite(n)) return new Date(n);
  return null;
}

function isValidDate(value) {
  return value instanceof Date && Number.isFinite(value.getTime());
}

export function getMYTodayKey() {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: TZ,
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).formatToParts(new Date());

  const year = parts.find(p => p.type === "year")?.value;
  const month = parts.find(p => p.type === "month")?.value;
  const day = parts.find(p => p.type === "day")?.value;

  return `${year}-${month}-${day}`;
}

/* =========================
   HOLD WINDOWS BUILDER
   supports:
   - old data version (single hold/resume fields)
   - new data version (holds[] / resumes[])
   - active on_hold without resume yet
========================= */
export function buildHoldWindowsFromRun(run, now = new Date()) {
  const holds = Array.isArray(run?.holds) ? run.holds : [];
  const resumes = Array.isArray(run?.resumes) ? run.resumes : [];

  const windows = [];

  for (let i = 0; i < holds.length; i++) {
    const h = holds[i];
    const holdStartMs = Number(h?.holdAtEpochMs);

    if (!Number.isFinite(holdStartMs)) continue;

    const r = resumes[i];
    const resumeMs = Number(r?.resumedAtEpochMs);

    // Fix open hold detection
    const isOpen =
      !Number.isFinite(resumeMs) &&
      String(run.status).toLowerCase() === "on_hold";
    const rawEndMs = isOpen ? now.getTime() : resumeMs;

    // Important: keep open hold alive even when called at same timestamp
    const holdEndMs = isOpen
      ? Math.max(rawEndMs, holdStartMs + 1)
      : rawEndMs;

    if (!Number.isFinite(holdEndMs)) continue;
    if (holdEndMs < holdStartMs) continue;

    windows.push({
      start: new Date(holdStartMs),
      end: new Date(holdEndMs),
      isOpen,
      holdReason: h?.holdReason || run?.holdReason || "",
      remarks: h?.remarks || run?.remarks || "",
      byName: h?.byName || "",
      byNumber: h?.byNumber || "",
      autoStopType: run?.autoStopType || ""
    });
  }

  // Legacy fallback
  if (!windows.length) {
    const holdMs =
      typeof run?.holdEpochMs === "number" ? run.holdEpochMs : null;

    const resumeMs =
      typeof run?.resumedEpochMs === "number" ? run.resumedEpochMs : null;

    if (holdMs != null) {
      const status = String(run?.status || "").toLowerCase().trim();
      const isOpen = resumeMs == null && status === "on_hold";
      const rawEndMs = resumeMs != null ? resumeMs : (isOpen ? now.getTime() : null);

      const endMs = isOpen
        ? Math.max(rawEndMs ?? holdMs, holdMs + 1)
        : rawEndMs;

      if (endMs != null && endMs >= holdMs) {
        windows.push({
          start: new Date(holdMs),
          end: new Date(endMs),
          isOpen,
          holdReason: run?.holdReason || "",
          remarks: run?.remarks || "",
          byName: "",
          byNumber: "",
          autoStopType: run?.autoStopType || ""
        });
      }
    }
  }

  return windows.sort((a, b) => a.start - b.start);
}


export function buildSegmentsFromRuns(runs) {
  const segments = [];
  const issues = [];

  for (const r of runs) {
    const serial = r.serialNumber || "";
    const station = r.station || "";
    const id = r.id

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

    if (!serial || !station || !isValidDate(start)) {
      issues.push({ type: "missing_fields", id: r.id, serial, station });
      continue;
    }

    if (!isValidDate(end)) {
      issues.push({
        type: "missing_end_time",
        id: r.id,
        serial,
        station,
        status
      });
      end = status === "completed" ? new Date(start.getTime()) : new Date();
    }

    if (end && end.getTime() < start.getTime()) end = new Date(start.getTime());

    const durationMs =
      typeof r.durationMs === "number"
        ? r.durationMs
        : (start && end ? (end.getTime() - start.getTime()) : 0);

    const holdWindows = buildHoldWindowsFromRun(
      r,
      status === "on_hold" ? new Date() : end
    );

    segments.push({
      serial,
      projectName: r.projectName || "(No Project)",
      materialNumber: r.materialNumber || "",
      description: r.description || "",
      station,
      model: r.model || "",
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
      holdReason: status === "on_hold" ? (r.holdReason || "") : "",
      remarks: status === "on_hold" ? (r.remarks || "") : "",

      holdAt: status === "on_hold" ? holdTime : null,
      holdEpochMs: status === "on_hold" ? r.holdEpochMs : null,
      resumedAt: resumed || null,
      resumedEpochMs: r.resumedEpochMs ?? null,
      holds: Array.isArray(r.holds) ? r.holds : [],
      resumes: Array.isArray(r.resumes) ? r.resumes : [],

      qrKind: r.qrKind || "",
      chillerSerialNumber: r.chillerSerialNumber || "",
      pvSerialNumber: r.pvSerialNumber || "",
      vesselType: r.vesselType || "",
      coolingType: r.coolingType || "",

      // added for insulation item merging
      serialNumber: r.serialNumber || "",
      insulationItemType: r.insulationItemType || "",
      relatedQrKind: r.relatedQrKind || "",
      relatedPvSerialNumber: r.relatedPvSerialNumber || "",
      

      ongoing: (status === "running" || status === "on_hold"),
      durationMs: Math.max(0, durationMs),
      holdWindows
    });
  }

  return { segments, issues };
}

export function getStationOptionsFromSegments(segments) {
  return Array.from(
    new Set(
      segments.map(seg => String(seg?.station || "UNKNOWN").trim() || "UNKNOWN")
    )
  ).sort((a, b) => a.localeCompare(b));
}

