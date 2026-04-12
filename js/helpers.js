/* Helpers shared across different js */

/* Array mapping START */

// Station -> vessel type -> processes 
export const PROCESS_BY_LINE = {
  "PV 1": [
      "1 - Plasma cutting to bevelling",
      "2 - Shotblast to rolling",
      "3 - Longtidunal SAW",
      "4 - Rerolling",
      "5 - Circumference SAW (Two shells joining)",
      "6 - Hole bevelling",
      "7 - Connector welding",
      "8A - Internal plate assembly",
      "8B - Fitting internal plate",
      "8C - GMAW C&B",
      "9 - Fitting and welding distribution box",
      "10 - Tube support, bush fitting, and tube sheet fitting",
      "11 - Tubesheet welding",
      "12 - Bracket and attachment welding, copper tube brazing",
      "13 - Unit side plate and base welding",
      "14A - Tube slotting",
      "14B - Tube expansion"
    
  ],

  "PV 2": [
    
      "1 - Plasma cutting to bevelling",
      "2 - Shotblast to rolling",
      "3 - Longtidunal SAW",
      "4 - Rerolling",
      "5 - Circumference SAW (Two shells joining)",
      "6 - Hole bevelling",
      "7 - Connector welding",
      "8A - Internal plate assembly",
      "8B - Fitting internal plate",
      "8C - GMAW C&B",
      "9 - Fitting and welding distribution box",
      "10 - Tube support, bush fitting, and tube sheet fitting",
      "11 - Tubesheet welding",
      "12 - Bracket and attachment welding, copper tube brazing",
      "13 - Unit side plate and base welding",
      "14A - Tube slotting",
      "14B - Tube expansion"
  ],


  "Sub Assy": {
    "ECONOMIZER": [
      "6, 7 - Hole bevelling and connector welding",
      "8, 9, 10, 11 - Internal plate distribution box tube support and bush fitting and welding",
      "12 - Bracket and attachment fitting and welding",
    ],

    
    "OIL SEPARATOR": [
      "6, 7 - Hole bevelling and connector welding",
      "8, 9, 10, 11 - Internal plate distribution box tube support and bush fitting and welding",
      "12 - Bracket and attachment fitting and welding",
    ]
  },

   "Pneumatic": {
    "EVAPORATOR": [
      "15 - Primer painting",
      "16 - Pneumatic testing",
      "17 - Hydrostatic testing",
      "18, 19 - Primer painting (weld seam) and top coat painting"
    ],
    
    "CONDENSER": [
      "15 - Primer painting",
      "16 - Pneumatic testing",
      "17 - Hydrostatic testing",
      "18, 19 - Primer painting (weld seam) and top coat painting"
    ],

    "OIL SEPARATOR": [
      "15 - Primer painting",
      "16 - Pneumatic testing",
      "18, 19 - Primer painting (weld seam) and top coat painting"
    ],

    "ECONOMIZER": [
      "15 - Primer painting",
      "16 - Pneumatic testing",
      "18, 19 - Primer painting (weld seam) and top coat painting"
    ]
  }
};

export const PROCESS_BY_CHILLER = {

  "WC 1": {
    "WATER-COOLED": [
      "Major components assembly",
      "Steel pipe welding",
      "Copper pipe brazing",
      "Control and starter box wiring"
    ]
  },

  "WC 2": {
    "WATER-COOLED": [
      "Major components assembly",
      "Steel pipe welding",
      "Copper pipe brazing",
      "Control and starter box wiring"
    ]
  },

   "AC 1": {
    "AIR-COOLED": [
      "Major components assembly",
      "Steel pipe welding",
      "Copper pipe brazing",
      "Control and starter box wiring"
    ]
  },

   "AC 2": {
    "AIR-COOLED": [
      "Major components assembly",
      "Steel pipe welding",
      "Copper pipe brazing",
      "Control and starter box wiring"
    ]
  },

  "Insulation 1": {
    "AIR-COOLED": [
      "Insulation 1",
      "Insulation 2"
    ],

    "WATER-COOLED": [
      "Insulation 1",
      "Insulation 2"
    ]
  },

  "Insulation 2": {
    "AIR-COOLED": [
      "Insulation 1",
      "Insulation 2"
    ],

    "WATER-COOLED": [
      "Insulation 1",
      "Insulation 2"
    ]
  },

  "Packing": {
    "AIR-COOLED":[
      "Packing"
    ],

    "WATER-COOLED":[
      "Packing"
    ]
  }
  
};

// Allowed vessels to stations
export const STATION_ALLOWED_VESSELS = {
  "PV 1": ["EVAPORATOR", "CONDENSER"],
  "PV 2": ["EVAPORATOR", "CONDENSER"],
  "Sub Assy": ["ECONOMIZER", "OIL SEPARATOR"],
  "Pneumatic": [
    "EVAPORATOR",
    "CONDENSER",
    "ECONOMIZER",
    "OIL SEPARATOR"
  ]
};

export const STATION_ALLOWED_CHILLER_TYPES = {
  "Piping Shop": ["AIR-COOLED"],
  "WC 1": ["WATER-COOLED"],
  "WC 2": ["WATER-COOLED"],
  "AC 1": ["WATER-COOLED"],
  "AC 2": ["WATER-COOLED"],
  "Insulation 1": ["AIR-COOLED", "WATER-COOLED"],
  "Insulation 1": ["AIR-COOLED", "WATER-COOLED"],
  "Packing": ["AIR-COOLED", "WATER-COOLED"],
};

// A normalized station key to match with state.js (PROCESS_BY_LINE)
export function getStationKey(employeeData = state.employeeData){
  const raw = String(
    employeeData?.station ||
    employeeData?.lineStation ||
    employeeData?.processLine ||
    ""
  ).trim().toUpperCase();

  const map = {
    "PV1": "PV 1",
    "PV 1": "PV 1",
    "PV2": "PV 2",
    "PV 2": "PV 2",
    "SUBASSY" : "Sub Assy",
    "SUB ASSY": "Sub Assy",
    "PNEUMATIC": "Pneumatic"
  };

  return map[raw] || "";
}


/* Array mapping END */

export const STANDARD_TIME_MIN = {
  "6 - Hole bevelling": 80,
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
  "15 - Primer painting": 180,
  "16 - Pneumatic testing": 120,
  "17 - Hydrostatic testing": 300,
  "18, 19 - Primer painting (weld seam) and top coat painting": 600,

  "6, 7 - Hole bevelling and connector welding": 200,
  "6, 7, 8 - Hole bevelling, connector welding, fitting internal plate and GMAW C&B": 350,
  "9, 10, 11 - Distribution box, tube support and bush, tubesheet fitting and welding": 500,
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
  { cls: "st-mig", label: "MIG" }
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

export function getStandardMinutesFromLabel(processLabel) {
  if (!processLabel) return 0;

  const label = String(processLabel).trim();

  // direct match
  if (STANDARD_TIME_MIN[label] != null) {
    return STANDARD_TIME_MIN[label];
  }

  // fallback: try startsWith match (for safety)
  const foundKey = Object.keys(STANDARD_TIME_MIN).find(k =>
    label.startsWith(k)
  );

  return foundKey ? STANDARD_TIME_MIN[foundKey] : 0;
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

    const isOpen = !Number.isFinite(resumeMs);
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

export function getStationOptionsFromSegments(segments) {
  return Array.from(
    new Set(
      segments.map(seg => String(seg?.station || "UNKNOWN").trim() || "UNKNOWN")
    )
  ).sort((a, b) => a.localeCompare(b));
}

