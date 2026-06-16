/* Export the data from firebase to excel workbook */

import {
  buildSegmentsFromRuns,
  getActualEffectiveDurationMs
} from "./helpers.js";


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
  return ms / 60000;
}

function manHoursFromMs(ms, manpower) {
  const mp = Number(manpower || 0); // Convert manpower to number, default to 0 if invalid
  if (!ms || ms <= 0 || mp <= 0) return 0; // Return 0 if no time or manpower
  return (ms / 3600000) * mp; // Convert ms to hours and multiply by manpower
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
      "Model",
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
  const summaryHeader = [
    "Station",
    "Process",
    "Runs",
    "Total Elapsed Duration (Minutes)",
    "Total Break Time (Minutes)",
    "Total Effective Duration (Minutes)",
    "Total Elapsed Duration (Hours)",
    "Total Effective Duration (Hours)",
    "Total Elapsed Man-Hours",
    "Total Effective Man-Hours"
  ];
  const summaryMap = new Map();
  const result = buildSegmentsFromRuns(runs);
  const segments =
    Array.isArray(result)
      ? result
      : result.segments || [];

  const modelBySerial = new Map();

  for (const run of runs) {
    const serial =
      run.serialNumber ||
      run.pvSerialNumber ||
      run.chillerSerialNumber ||
      "";

    if (serial && run.model) {
      modelBySerial.set(String(serial).trim(), run.model);
    }
  }

  for (const r of segments) {

    const start = r.start || null;
    const effectiveEnd = r.end || null;

    const elapsedMs =
      start && effectiveEnd
        ? Math.max(
            0,
            effectiveEnd.getTime() - start.getTime()
          )
        : 0;

    const effectiveMs =
      getActualEffectiveDurationMs(r);

    const elapsedMin =
      minutesFromMs(elapsedMs);

    const effectiveMin =
      minutesFromMs(effectiveMs);

    const breakMin =
      Math.max(
        0,
        elapsedMin - effectiveMin
      );

    const elapsedHours =
      elapsedMs > 0
        ? elapsedMs / 3600000
        : 0;

    const effectiveHours =
      effectiveMs > 0
        ? effectiveMs / 3600000
        : 0;

    const elapsedManHours =
      manHoursFromMs(
        elapsedMs,
        r.manpower
      );

    const effectiveManHours =
      manHoursFromMs(
        effectiveMs,
        r.manpower
      );

    rawRows.push([
      r.projectName || "",
      r.description || "",
      r.serialNumber ||
      r.pvSerialNumber ||
      r.chillerSerialNumber ||
      "",
      getUnitType(r),
      r.model ||
      modelBySerial.get(String(
        r.serialNumber ||
        r.pvSerialNumber ||
        r.chillerSerialNumber ||
        ""
      ).trim()) ||
      "",
      r.materialNumber || "",
      r.processName || r.processLabel || "",
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

    const key =
      `${r.station || ""}__${r.processName || r.processLabel || ""}`;

    if (!summaryMap.has(key)) {
      summaryMap.set(key, {
        station: r.station || "",
        process: r.processName || r.processLabel || "",
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
    { wch: 12 }, // Model
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
    { wch: 22 } // Effective Man-Hours
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
    "Type",
    "Serial Number",
    "Material Number",
    "Start Time and Date",
    "End Time and Date",
    "Status"
  ];

  const rows = [header];

  segments.forEach(seg => {
    const qrKind = String(seg.qrKind || "").toUpperCase();

    const typeText =
      qrKind === "PV"
        ? (seg.vesselType || "")
        : (seg.coolingType || "");

    const serialNumber =
      qrKind === "PV"
        ? (seg.pvSerialNumber || seg.serialNumber || seg.serial || "")
        : (seg.chillerSerialNumber || seg.serialNumber || seg.serial || "");

    const status = String(seg.status || "").toLowerCase();

    rows.push([
      seg.station || "",
      seg.processLabel || seg.processName || "",
      seg.projectName || "",
      typeText,
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
    { wch: 18 }, // Type
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

export function exportLineBalanceStandardRawData(segments, options = {}) {
  if (typeof XLSX === "undefined") {
    alert("XLSX library not loaded.");
    return;
  }

  const {
    fromDate = "2026-05-01", // Start date
    toDate = "2026-06-12", // End date
    factor = 0.8
  } = options;

  const fromMs = new Date(`${fromDate}T00:00:00`).getTime();
  const toMs = new Date(`${toDate}T23:59:59`).getTime();

  const rawRows = [[
    "Model",
    "Process Code",
    "Process",
    "Project Name",
    "Serial Number",
    "Type",
    "Start Date",
    "Start Time",
    "Effective Duration (Minutes)"
  ]];

  const summaryMap = new Map();

  for (const seg of segments || []) {
    if (seg.phase === "waiting" || seg.status === "waiting") continue;

    const start = seg.start instanceof Date ? seg.start : null;
    if (!start) continue;

    const startMs = start.getTime();
    if (startMs < fromMs || startMs > toMs) continue;

    const model = String(seg.model || "").trim();
    const process = seg.processName || seg.processLabel || "";
    const processCode = String(process).split("-")[0].trim();

    if (!model || !processCode) continue;

    const effectiveMin = getActualEffectiveDurationMs(seg) / 60000;
    if (!Number.isFinite(effectiveMin) || effectiveMin <= 0) continue;

    const serial =
      seg.serialNumber ||
      seg.pvSerialNumber ||
      seg.chillerSerialNumber ||
      "";

    rawRows.push([
      model,
      processCode,
      process,
      seg.projectName || "",
      serial,
      getUnitType(seg),
      formatExcelDate(start),
      formatExcelTime(start),
      Number(effectiveMin.toFixed(1))
    ]);

    const type = getUnitType(seg);
    const key = `${model}__${type}__${processCode}`;

    if (!summaryMap.has(key)) {
      summaryMap.set(key, {
        model,
        type,
        processCode,
        process,
        count: 0,
        totalEffectiveMin: 0,
        values: []
      });
    }

    const row = summaryMap.get(key);
    row.count++;
    row.totalEffectiveMin += effectiveMin;
    row.values.push(effectiveMin);
  }

  const summaryRows = [[
    "Model",
    "Type",
    "Process Code",
    "Process",
    "Count",
    "Average Effective Duration (Minutes)",
    "Standard Factor",
    "Standard Time = Average × Factor",
    "Median Effective Duration (Minutes)",
    "Median × Factor"
  ]];

  for (const row of Array.from(summaryMap.values()).sort((a, b) =>
    a.model.localeCompare(b.model) ||
    a.type.localeCompare(b.type) ||
    a.processCode.localeCompare(b.processCode)
  )) {
    const average = row.totalEffectiveMin / row.count;

    const sorted = [...row.values].sort((a, b) => a - b);
    const mid = Math.floor(sorted.length / 2);
    const median =
      sorted.length % 2
        ? sorted[mid]
        : (sorted[mid - 1] + sorted[mid]) / 2;

    summaryRows.push([
      row.model,
      row.type,
      row.processCode,
      row.process,
      row.count,
      Number(average.toFixed(1)),
      factor,
      Number((average * factor).toFixed(1)),
      Number(median.toFixed(1)),
      Number((median * factor).toFixed(1))
    ]);
  }

  if (rawRows.length === 1) {
    alert("No baseline data found for selected standard time range.");
    return;
  }

  const wb = XLSX.utils.book_new();

  const wsRaw = XLSX.utils.aoa_to_sheet(rawRows);
  const wsSummary = XLSX.utils.aoa_to_sheet(summaryRows);

  wsRaw["!cols"] = [
    { wch: 14 },
    { wch: 14 },
    { wch: 40 },
    { wch: 28 },
    { wch: 18 },
    { wch: 16 },
    { wch: 14 },
    { wch: 14 },
    { wch: 28 }
  ];

  wsSummary["!cols"] = [
    { wch: 14 },
    { wch: 16 },
    { wch: 14 },
    { wch: 40 },
    { wch: 10 },
    { wch: 32 },
    { wch: 16 },
    { wch: 32 },
    { wch: 32 },
    { wch: 18 }
  ];

  XLSX.utils.book_append_sheet(wb, wsRaw, "Raw Baseline Data");
  XLSX.utils.book_append_sheet(wb, wsSummary, "Standard Summary");

  XLSX.writeFile(
    wb,
    `LineBalance_Standard_Verification_${fromDate}_to_${toDate}.xlsx`
  );
}
