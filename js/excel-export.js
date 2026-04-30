/* Export the data from firebase to excel workbook */

function tsOrMsToDate(ts, ms) {
  if (ts && typeof ts.toDate === "function") return ts.toDate();

  const n =
    typeof ms === "number"
      ? ms
      : typeof ms === "string" && ms.trim() !== "" && !isNaN(ms)
      ? Number(ms)
      : null;

  if (typeof n === "number" && Number.isFinite(n)) return new Date(n);
  return null;
}

function overlapMs(startA, endA, startB, endB) {
  const start = Math.max(startA.getTime(), startB.getTime());
  const end = Math.min(endA.getTime(), endB.getTime());
  return Math.max(0, end - start);
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

function getBreakOverlapMs(start, end) {
  if (!start || !end || end <= start) return 0;

  let total = 0;

  let curDay = new Date(start);
  curDay.setHours(0, 0, 0, 0);

  const lastDay = new Date(end);
  lastDay.setHours(0, 0, 0, 0);

  while (curDay <= lastDay) {
    const breaks = getDailyBreakWindows(curDay);

    for (const b of breaks) {
      total += overlapMs(start, end, b.start, b.end);
    }

    curDay.setDate(curDay.getDate() + 1);
  }

  return total;
}

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

function minutesFromMs(ms) {
  if (!ms || ms <= 0) return 0;
  return Math.round(ms / 60000);
}

function manHoursFromMs(ms, manpower) {
  const mp = Number(manpower || 0);
  if (!ms || ms <= 0 || mp <= 0) return 0;
  return (ms / 3600000) * mp;
}

function getUnitType(r) {
  if (String(r.qrKind || "").toUpperCase() === "PV") {
    return r.vesselType || "PV";
  }
  return "CHILLER";
}

function formatExcelDate(date) {
  if (!date) return "";
  const d = new Date(date);
  const day = String(d.getDate()).padStart(2, "0");
  const month = String(d.getMonth() + 1).padStart(2, "0");
  const year = d.getFullYear();
  return `${day}/${month}/${year}`;
}

function formatExcelTime(date) {
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

export function exportExcelReport(runs) {
  if (typeof XLSX === "undefined") {
    alert("XLSX library not loaded. Check the xlsx script tag in index.html.");
    return;
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
      status === "completed"
        ? endCompleted
        : status === "on_hold"
        ? (holdTime || new Date())
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

    const elapsedHours = elapsedMs > 0 ? elapsedMs / 3600000 : 0;
    const effectiveHours = effectiveMs > 0 ? effectiveMs / 3600000 : 0;

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
      Number(r.manpower || 0),
      r.status || "",
      formatExcelDate(start),
      formatExcelTime(start),
      formatExcelDate(effectiveEnd),
      formatExcelTime(effectiveEnd),
      elapsedMin,
      breakMin,
      effectiveMin,
      elapsedHours.toFixed(2),
      effectiveHours.toFixed(2),
      elapsedManHours.toFixed(2),
      effectiveManHours.toFixed(2)
    ]);

    const key = `${r.station || ""}__${r.processName || ""}`;
    if (!summaryMap.has(key)) {
      summaryMap.set(key, {
        station: r.station || "",
        process: r.processName || "",
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

    const row = summaryMap.get(key);
    row.runs += 1;
    row.totalElapsedMinutes += elapsedMin;
    row.totalBreakMinutes += breakMin;
    row.totalEffectiveMinutes += effectiveMin;
    row.totalElapsedHours += elapsedHours;
    row.totalEffectiveHours += effectiveHours;
    row.totalElapsedManHours += elapsedManHours;
    row.totalEffectiveManHours += effectiveManHours;
  }

  const summaryHeader = [
    "Station",
    "Process",
    "Runs",
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
    { wch: 24 },
    { wch: 22 },
    { wch: 16 },
    { wch: 14 },
    { wch: 16 },
    { wch: 34 },
    { wch: 14 },
    { wch: 10 },
    { wch: 12 },
    { wch: 14 },
    { wch: 14 },
    { wch: 14 },
    { wch: 14 },
    { wch: 22 },
    { wch: 20 },
    { wch: 24 },
    { wch: 22 },
    { wch: 24 },
    { wch: 20 },
    { wch: 22 }
  ];

  wsSummary["!cols"] = [
    { wch: 14 },
    { wch: 34 },
    { wch: 10 },
    { wch: 22 },
    { wch: 20 },
    { wch: 24 },
    { wch: 20 },
    { wch: 22 },
    { wch: 24 },
    { wch: 26 }
  ];

  XLSX.utils.book_append_sheet(wb, wsRaw, "Raw Runs");
  XLSX.utils.book_append_sheet(wb, wsSummary, "Summary");

  const filename = `ProcessReport_${new Date().toISOString().slice(0, 10)}.xlsx`;
  XLSX.writeFile(wb, filename);
}

export function exportStationViewExcel(segments, options = {}) {
  if (typeof XLSX === "undefined") {
    alert("XLSX library not loaded. Check the xlsx script tag in station.html.");
    return;
  }

  const {
    dayKey = "",
    station = "All Stations"
  } = options;

  const header = [
    "Station",
    "Process",
    "Project Name",
    "Serial Number",
    "Material Number",
    "Start Time and Date",
    "End Time and Date",
    "Status"
  ];

  const rows = [header];

  segments.forEach(seg => {
    const qrKind = String(seg.qrKind || "").toUpperCase();

    const serialNumber =
      qrKind === "PV"
        ? (seg.pvSerialNumber || seg.serialNumber || seg.serial || "")
        : (seg.chillerSerialNumber || seg.serialNumber || seg.serial || "");

    const status = String(seg.status || "").toLowerCase();

    rows.push([
      seg.station || "",
      seg.processLabel || seg.processName || "",
      seg.projectName || "",
      serialNumber,
      seg.materialNumber || "",
      `${formatExcelDate(seg.start)} ${formatExcelTime(seg.start)}`,
      status === "running"
        ? "Running"
        : `${formatExcelDate(seg.end)} ${formatExcelTime(seg.end)}`,
      seg.status || ""
    ]);
  });

  if (rows.length === 1) {
    alert("No station data found for selected date.");
    return;
  }

  const wb = XLSX.utils.book_new();
  const ws = XLSX.utils.aoa_to_sheet(rows);

  ws["!cols"] = [
  { wch: 16 }, // Station
  { wch: 34 }, // Process
  { wch: 28 }, // Project Name
  { wch: 18 }, // Serial Number
  { wch: 18 }, // Material Number
  { wch: 24 }, // Start Time and Date
  { wch: 24 }, // End Time and Date
  { wch: 16 }  // Status
];

  XLSX.utils.book_append_sheet(wb, ws, "Station View");

  const safeStation = String(station).replace(/[\\/:*?"<>|]/g, "_");
  const filename = `StationView_${safeStation}_${dayKey}.xlsx`;

  XLSX.writeFile(wb, filename);
}