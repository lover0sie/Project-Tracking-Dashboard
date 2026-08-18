import {
  buildSegmentsFromRuns,
  getActualEffectiveDurationMs,
  getProcessCode,
  getStationLabelFromRun,
  getStationOptionsFromSegments,
  STANDARD_BASELINE_FROM,
  STANDARD_BASELINE_TO,
  STANDARD_FACTOR
} from "../js/helpers.js";

import {
  loadProjectHeadersFallbackFromRuns,
  loadRunsForDayWithCarryForward,
  loadRunsForProject
} from "../js/timeline.js";


/* =========================================================
   DOM ELEMENTS
========================================================= */

const periodPicker = document.getElementById("periodPicker");
const stationSelect = document.getElementById("stationSelect");
const refreshBtn = document.getElementById("refreshBtn");

const selectedStationText = document.getElementById("selectedStationText");
const projectCountText =  document.getElementById("projectCountText");
const completedCountText = document.getElementById("completedCountText");
const runningCountText = document.getElementById("runningCountText");
const onHoldCountText = document.getElementById("onHoldCountText");
const progressTitle = document.getElementById("progressTitle");
const progressSubTitle = document.getElementById("progressSubTitle");
const progressTableBody = document.getElementById("progressTableBody");
const lastUpdateText = document.getElementById("lastUpdateText");


/* =========================================================
   CONSTANTS
========================================================= */

const NO_STANDARD_REFERENCE_MINUTES = 450;

/* =========================================================
   STATE
========================================================= */

let dailyRuns = [];
let allHistoricalSegments = [];
let historicalStandards = {};

let selectedStation = "";

let autoRefreshTimer = null;
let lastDashboardUpdateAt = null;


/* =========================================================
   URL STATE
========================================================= */

function getUrlState() {
  const params =
    new URLSearchParams(window.location.search);

  return {
    date: normalizeText(params.get("date") || ""),
    station: normalizeText(params.get("station") || "")
  };
}

function updateUrlState() {
  const params =
    new URLSearchParams(window.location.search);

  if (periodPicker.value) {
    params.set("date", periodPicker.value);
  } else {
    params.delete("date");
  }

  if (selectedStation) {
    params.set("station", selectedStation);
  } else {
    params.delete("station");
  }

  params.delete("process");

  const query =
    params.toString();

  const nextUrl =
    `${window.location.pathname}${query ? `?${query}` : ""}${window.location.hash}`;

  window.history.replaceState(null, "", nextUrl);
}


/* =========================================================
   BASIC HELPERS
========================================================= */

function getCurrentDateKey() {
  return new Date().toLocaleDateString("en-CA", {
    timeZone: "Asia/Kuala_Lumpur"
  });
}

function normalizeText(value = "") {
  return String(value)
    .trim()
    .replace(/\s+/g, " ");
}

function normalizeUpper(value = "") {
  return normalizeText(value).toUpperCase();
}

function escapeHtml(value = "") {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function getTimestampMs(value) {
  if (!value) return null;

  if (typeof value === "number") {
    return Number.isFinite(value) ? value : null;
  }

  if (typeof value.toMillis === "function") {
    return value.toMillis();
  }

  if (typeof value.toDate === "function") {
    return value.toDate().getTime();
  }

  const parsed = new Date(value).getTime();

  return Number.isFinite(parsed) ? parsed : null;
}

function formatClockTime(ms) {
  if (!Number.isFinite(ms) || ms <= 0) return "-";

  return new Date(ms).toLocaleTimeString("en-MY", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: true,
    timeZone: "Asia/Kuala_Lumpur"
  });
}

function formatDuration(minutes) {
  const value = Number(minutes);

  if (!Number.isFinite(value) || value <= 0) {
    return "-";
  }

  const totalMinutes = Math.round(value);
  const hours = Math.floor(totalMinutes / 60);
  const remainingMinutes = totalMinutes % 60;

  if (hours <= 0) {
    return `${remainingMinutes} min`;
  }

  if (remainingMinutes === 0) {
    return `${hours} hr`;
  }

  return `${hours} hr ${remainingMinutes} min`;
}

function formatPerformanceMinutes(minutes) {
  const value = Number(minutes);

  if (!Number.isFinite(value) || value <= 0) {
    return "0 min";
  }

  return formatDuration(value);
}

function formatReadableTimeFromMinutes(minutes) {
  const value = Number(minutes);

  if (!Number.isFinite(value) || value <= 0) {
    return "0 hr 0 min";
  }

  const totalSeconds =
    Math.floor(value * 60);

  const hours =
    Math.floor(totalSeconds / 3600);

  const minutesPart =
    Math.floor((totalSeconds % 3600) / 60);

  return `${hours} hr ${minutesPart} min`;
}

function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max);
}


/* =========================================================
   PROCESS IDENTIFICATION
========================================================= */

function normalizePneumaticProcessName(processName) {
  return "Painting and Vessel Testing";

}

function getStationDisplayName(station) {
  const stationName =
    normalizeText(station);

  if (
    getComparableStationValue(stationName) ===
    getComparableStationValue("Pneumatic")
  ) {
    return normalizePneumaticProcessName(stationName);
  }

  return stationName;
}

function getFullProcessName(run) {
  return normalizeText(
    run.processName ||
    run.processLabel ||
    ""
  );
}

function getProcessDisplayName(run) {
  const processName =
    getFullProcessName(run);

  const dashIndex =
    processName.indexOf("-");

  if (dashIndex < 0) {
    return processName;
  }

  return normalizeText(
    processName.slice(0, dashIndex)
  );
}

function getProcessSortParts(run) {
  const displayName =
    getProcessDisplayName(run);

  const match =
    displayName.match(/^(\d+)([A-Z]*)/i);

  if (!match) {
    return {
      number: Number.MAX_SAFE_INTEGER,
      suffix: normalizeUpper(displayName)
    };
  }

  return {
    number: Number(match[1]),
    suffix: normalizeUpper(match[2] || "")
  };
}

function getTypeDisplayName(type) {
  const normalized =
    normalizeUpper(type);

  if (normalized === "EVAPORATOR") return "EVAP";
  if (normalized === "CONDENSER") return "COND";
  if (normalized === "ECONOMIZER") return "ECON";
  if (normalized === "OIL SEPARATOR") return "OIL SEP";

  return normalizeText(type);
}

function getProcessCodeForRun(run) {
  return normalizeUpper(
    getProcessCode(getFullProcessName(run))
  );
}


/* =========================================================
   STATION HELPERS
========================================================= */

function getRunStation(run) {
  return getStationLabelFromRun(run);
}

function getComparableStationValue(value = "") {
  return normalizeUpper(value)
    .replace(/\s+/g, "");
}

function resolveStationSelection(value, stations) {
  if (!value) return "";

  if (stations.includes(value)) {
    return value;
  }

  const comparableValue =
    getComparableStationValue(value);

  return stations.find(station =>
    getComparableStationValue(station) === comparableValue
  ) || "";
}

function getUniqueStations(runs) {
  const result =
    buildSegmentsFromRuns(runs);

  const segments =
    Array.isArray(result)
      ? result
      : result.segments || [];

  return getStationOptionsFromSegments(segments);
}

/* =========================================================
   STANDARD TIME
========================================================= */

function parseDateStartMs(value) {
  if (!value) return null;

  const [year, month, day] =
    String(value).split("-").map(Number);

  if (!year || !month || !day) return null;

  return new Date(
    year,
    month - 1,
    day,
    0,
    0,
    0,
    0
  ).getTime();
}

function parseDateEndMs(value) {
  if (!value) return null;

  const [year, month, day] =
    String(value).split("-").map(Number);

  if (!year || !month || !day) return null;

  return new Date(
    year,
    month - 1,
    day,
    23,
    59,
    59,
    999
  ).getTime();
}

function isSegmentInStandardBaseline(segment) {
  const startMs =
    segment?.start instanceof Date
      ? segment.start.getTime()
      : Number(
          segment?.run?.startEpochMs ||
          segment?.startEpochMs ||
          0
        );

  const fromMs =
    parseDateStartMs(STANDARD_BASELINE_FROM);

  const toMs =
    parseDateEndMs(STANDARD_BASELINE_TO);

  if (!Number.isFinite(startMs)) return false;

  return startMs >= fromMs && startMs <= toMs;
}

function getStandardType(record) {
  const qrKind = normalizeUpper(record.qrKind);

  if (qrKind === "PV") {
    return normalizeUpper(record.vesselType || "PV");
  }

  return "CHILLER";
}

function getStandardKey(model, type, processCode) {
  return [
    normalizeUpper(model),
    normalizeUpper(type),
    normalizeUpper(processCode)
  ].join("__");
}

function calculateStandardFromValues(values) {
  const validValues = values.filter(
    value => Number.isFinite(value) && value > 0
  );

  if (!validValues.length) return 0;

  const average =
    validValues.reduce((sum, value) => sum + value, 0) /
    validValues.length;

  return average * STANDARD_FACTOR;
}

function buildHistoricalStandards(segments) {
  const valueMap = new Map();

  for (const segment of segments) {
    if (
      segment.phase === "waiting" ||
      segment.status === "waiting"
    ) {
      continue;
    }

    if (!isSegmentInStandardBaseline(segment)) {
      continue;
    }

    const processName =
      segment.processLabel ||
      segment.processName ||
      "";

    const processCode = normalizeUpper(getProcessCode(processName));
    const model = normalizeUpper(segment.model);
    const type = getStandardType(segment);

    if (!model || !type || !processCode) {
      continue;
    }

    const actualMinutes =
      getActualEffectiveDurationMs(segment) / 60000;

    if (
      !Number.isFinite(actualMinutes) ||
      actualMinutes <= 0
    ) {
      continue;
    }

    const key =
      getStandardKey(model, type, processCode);

    if (!valueMap.has(key)) {
      valueMap.set(key, []);
    }

    valueMap.get(key).push(actualMinutes);
  }

  const result = {};

  for (const [key, values] of valueMap.entries()) {
    result[key] = calculateStandardFromValues(values);
  }

  return result;
}

function getStandardMinutes(run) {
  const key = getStandardKey(
    run.model,
    getStandardType(run),
    getProcessCodeForRun(run)
  );

  return Number(historicalStandards[key] || 0);
}

/* =========================================================
   RUN TIME CALCULATION
========================================================= */

function normalizeStatus(status = "") {
  const value = normalizeUpper(status)
    .replaceAll("-", "_")
    .replaceAll(" ", "_");

  if (value === "COMPLETED") return "completed";
  if (value === "ON_HOLD") return "on_hold";
  if (value === "RUNNING") return "running";

  return value.toLowerCase();
}

function getLiveEffectiveDurationMs(run) {
  const normalizedRun = {
    ...run,
    serialNumber:
      run.serialNumber ||
      run.pvSerialNumber ||
      run.chillerSerialNumber ||
      ""
  };

  const result =
    buildSegmentsFromRuns([normalizedRun]);

  const segments =
    Array.isArray(result)
      ? result
      : result.segments || [];

  const segment =
    segments[0];

  return segment
    ? getActualEffectiveDurationMs(segment)
    : 0;
}

function getSelectedDayRangeMs() {
  const dateKey =
    periodPicker.value;

  if (!dateKey) return null;

  const [year, month, day] =
    String(dateKey).split("-").map(Number);

  if (!year || !month || !day) return null;

  const startMs =
    new Date(year, month - 1, day, 0, 0, 0, 0).getTime();

  const endMs =
    new Date(year, month - 1, day, 23, 59, 59, 999).getTime();

  return { startMs, endMs };
}

function getRunSegment(run) {
  const normalizedRun = {
    ...run,
    serialNumber:
      run.serialNumber ||
      run.pvSerialNumber ||
      run.chillerSerialNumber ||
      ""
  };

  const result =
    buildSegmentsFromRuns([normalizedRun]);

  const segments =
    Array.isArray(result)
      ? result
      : result.segments || [];

  return segments[0] || null;
}

function getEffectiveDurationMsForWindow(run, windowStartMs, windowEndMs) {
  if (
    !Number.isFinite(windowStartMs) ||
    !Number.isFinite(windowEndMs) ||
    windowEndMs <= windowStartMs
  ) {
    return 0;
  }

  const segment =
    getRunSegment(run);

  if (!segment?.start || !segment?.end) {
    return 0;
  }

  const clippedStartMs =
    Math.max(segment.start.getTime(), windowStartMs);

  const clippedEndMs =
    Math.min(segment.end.getTime(), windowEndMs);

  if (clippedEndMs <= clippedStartMs) {
    return 0;
  }

  const clippedHoldWindows =
    (Array.isArray(segment.holdWindows) ? segment.holdWindows : [])
      .map(window => {
        const holdStartMs =
          window.start instanceof Date
            ? window.start.getTime()
            : new Date(window.start).getTime();

        const holdEndMs =
          window.end instanceof Date
            ? window.end.getTime()
            : new Date(window.end).getTime();

        const clippedHoldStartMs =
          Math.max(holdStartMs, clippedStartMs);

        const clippedHoldEndMs =
          Math.min(holdEndMs, clippedEndMs);

        if (
          !Number.isFinite(clippedHoldStartMs) ||
          !Number.isFinite(clippedHoldEndMs) ||
          clippedHoldEndMs <= clippedHoldStartMs
        ) {
          return null;
        }

        return {
          ...window,
          start: new Date(clippedHoldStartMs),
          end: new Date(clippedHoldEndMs)
        };
      })
      .filter(Boolean);

  return getActualEffectiveDurationMs({
    ...segment,
    start: new Date(clippedStartMs),
    end: new Date(clippedEndMs),
    holdWindows: clippedHoldWindows
  });
}

/* =========================================================
   EXPECTED COMPLETION
========================================================= */

function getExpectedCompletionMs(run, standardMinutes) {
  const startMs = getTimestampMs(
    run.startEpochMs ||
    run.startAt
  );

  if (
    !Number.isFinite(startMs) ||
    !Number.isFinite(standardMinutes) ||
    standardMinutes <= 0
  ) {
    return null;
  }

  /*
   * Basic calculation:
   * start time + standard duration.
   *
   * Example:
   * 08:00 + 240 minutes = 12:00.
   */
  return startMs + standardMinutes * 60000;
}


/* =========================================================
   DATA LOADING
========================================================= */

async function loadDailyRuns(dateKey, forceRefresh = false) {
  return loadRunsForDayWithCarryForward(dateKey, forceRefresh);
}

async function loadHistoricalSegments() {
  const projectHeaders =
    await loadProjectHeadersFallbackFromRuns();

  const projectRunsNested =
    await Promise.all(
      projectHeaders.map(project =>
        loadRunsForProject(
          project.chillerSerialNumber ||
          project.id
        )
      )
    );

  const allRuns =
    projectRunsNested.flat();

  const result =
    buildSegmentsFromRuns(allRuns);

  return Array.isArray(result)
    ? result
    : result.segments || [];
}

/* =========================================================
   DROPDOWN RENDERING
========================================================= */

function renderStationOptions() {
  const stations =
    getUniqueStations(dailyRuns);

  selectedStation =
    resolveStationSelection(
      selectedStation,
      stations
    );

  stationSelect.innerHTML = `
    <option value="">Select station</option>

    ${stations.map(station => `
      <option value="${escapeHtml(station)}">
        ${escapeHtml(getStationDisplayName(station))}
      </option>
    `).join("")}
  `;

  if (
    selectedStation &&
    stations.includes(selectedStation)
  ) {
    stationSelect.value = selectedStation;
  } else {
    selectedStation = stations[0] || "";

    stationSelect.value =
      selectedStation;
  }

  updateUrlState();
}

/* =========================================================
   FILTERING
========================================================= */

function getSelectedRuns() {
  if (!selectedStation) {
    return [];
  }

  return dailyRuns.filter(run =>
    getRunStation(run) === selectedStation
  );
}


/* =========================================================
   TABLE ROW BUILDING
========================================================= */

function getStatusLabel(status) {
  const normalized = normalizeStatus(status);

  if (normalized === "completed") {
    return "Completed";
  }

  if (normalized === "on_hold") {
    return "On Hold";
  }

  if (normalized === "running") {
    return "Running";
  }

  return status || "-";
}

function getStatusClass(status) {
  const normalized = normalizeStatus(status);

  if (normalized === "completed") {
    return "status-completed";
  }

  if (normalized === "on_hold") {
    return "status-hold";
  }

  if (normalized === "running") {
    return "status-running";
  }

  return "";
}

function doesRunContinueAfterSelectedDay(run) {
  const selectedDayRange =
    getSelectedDayRangeMs();

  if (!selectedDayRange) return false;

  const segment =
    getRunSegment(run);

  if (!segment?.start || !segment?.end) {
    return false;
  }

  return (
    segment.start.getTime() <= selectedDayRange.endMs &&
    segment.end.getTime() > selectedDayRange.endMs
  );
}

function getDisplayStatusLabel(run) {
  if (doesRunContinueAfterSelectedDay(run)) {
    return "Next Day";
  }

  return getStatusLabel(run.status);
}

function getDisplayStatusClass(run) {
  if (doesRunContinueAfterSelectedDay(run)) {
    return "status-running-next-day";
  }

  return getStatusClass(run.status);
}

function getDisplayStatusKey(run) {
  if (doesRunContinueAfterSelectedDay(run)) {
    return "running";
  }

  return normalizeStatus(run.status);
}

function getPerformanceState(run, actualMinutes, standardMinutes, dayActualMinutes, beforeDayActualMinutes) {
  const status =
    normalizeStatus(run.status);

  const actualHms =
    formatReadableTimeFromMinutes(actualMinutes);

  const daySliceMinutes =
    Number.isFinite(dayActualMinutes)
      ? Math.max(0, dayActualMinutes)
      : actualMinutes;

  const daySliceHms =
    formatReadableTimeFromMinutes(daySliceMinutes);

  const beforeSliceMinutes =
    Number.isFinite(beforeDayActualMinutes)
      ? Math.max(0, beforeDayActualMinutes)
      : Math.max(0, actualMinutes - daySliceMinutes);

  function getBarPercent(minutes) {
    if (!Number.isFinite(minutes) || minutes <= 0) {
      return 0;
    }

    return Math.max(
      0.8,
      clamp(minutes / NO_STANDARD_REFERENCE_MINUTES * 100, 0, 100)
    );
  }

  const actualBarPercent =
    getBarPercent(daySliceMinutes);

  function buildSingleSegment(className, percent = actualBarPercent) {
    return [
      {
        className,
        percent
      }
    ];
  }

  function buildExceededSegments(baseClassName) {
    const remainingStandardMinutes =
      Math.max(0, standardMinutes - beforeSliceMinutes);

    const standardSliceMinutes =
      Math.min(daySliceMinutes, remainingStandardMinutes);

    const exceededSliceMinutes =
      Math.max(0, daySliceMinutes - standardSliceMinutes);

    return [
      {
        className: baseClassName,
        percent: getBarPercent(standardSliceMinutes)
      },
      {
        className: "performance-exceeded",
        percent: getBarPercent(exceededSliceMinutes)
      }
    ].filter(segment => segment.percent > 0);
  }

  if (
    !Number.isFinite(standardMinutes) ||
    standardMinutes <= 0
  ) {
    const noStandardClass =
      status === "completed"
        ? "performance-no-standard-completed"
        : status === "on_hold"
          ? "performance-no-standard-hold"
          : "performance-no-standard-running";

    return {
      className: noStandardClass,
      label: "No standard",
      totalTimeText: `Total Time: ${actualHms}`,
      detail: `${actualHms} elapsed time`,
      barPercent: actualBarPercent,
      segments: buildSingleSegment("performance-no-standard"),
      sectionWidthPercent: 10
    };
  }

  const varianceMinutes =
    standardMinutes - actualMinutes;

  const exceededHms =
    formatReadableTimeFromMinutes(
      Math.max(0, actualMinutes - standardMinutes)
    );

  if (status === "completed") {
    if (varianceMinutes >= 0) {
      return {
        className: "performance-on-track",
        label: "Completed on track",
        totalTimeText: `Total Time: ${actualHms}`,
        detail: `${actualHms} within standard`,
        barPercent: actualBarPercent,
        segments: buildSingleSegment("performance-on-track"),
        sectionWidthPercent: 10
      };
    }

    return {
      className: "performance-completed-exceeded",
      label: "Completed exceeded",
      totalTimeText: `Total Time: ${actualHms}`,
      detail: `${exceededHms} exceeded standard`,
      barPercent: actualBarPercent,
      segments: buildExceededSegments("performance-on-track"),
      sectionWidthPercent: 10
    };
  }

  if (status === "on_hold") {
    return {
      className: "performance-hold",
      label: "On hold",
      totalTimeText: `Total Time: ${actualHms}`,
      detail: varianceMinutes >= 0
        ? `${actualHms} within standard`
        : `${exceededHms} exceeded standard`,
      barPercent: actualBarPercent,
      segments: buildSingleSegment("performance-hold"),
      sectionWidthPercent: 10
    };
  }

  if (varianceMinutes < 0) {
    return {
      className: "performance-running-exceeded",
      label: "Exceeded standard",
      totalTimeText: `Total Time: ${actualHms}`,
      detail: `${exceededHms} exceeded standard`,
      barPercent: actualBarPercent,
      segments: buildExceededSegments("performance-running"),
      sectionWidthPercent: 10
    };
  }

  return {
    className: "performance-running",
    label: "Running",
    totalTimeText: `Total Time: ${actualHms}`,
    detail: `${daySliceHms} currently running today`,
    barPercent: actualBarPercent,
    segments: buildSingleSegment("performance-running"),
    sectionWidthPercent: 10
  };
}

function buildTableRows(runs) {
  const selectedDayRange =
    getSelectedDayRangeMs();

  return runs
    .map(run => {
      const standardMinutes =
        getStandardMinutes(run);

      const actualMinutes =
        getLiveEffectiveDurationMs(run) / 60000;

      const dayActualMinutes =
        selectedDayRange
          ? getEffectiveDurationMsForWindow(
              run,
              selectedDayRange.startMs,
              selectedDayRange.endMs
            ) / 60000
          : actualMinutes;

      const beforeDayActualMinutes =
        selectedDayRange
          ? getEffectiveDurationMsForWindow(
              run,
              0,
              selectedDayRange.startMs
            ) / 60000
          : 0;

      const performance =
        getPerformanceState(
          run,
          actualMinutes,
          standardMinutes,
          dayActualMinutes,
          beforeDayActualMinutes
        );

      return {
        run,
        standardMinutes,
        actualMinutes,
        dayActualMinutes,
        beforeDayActualMinutes,
        performance,

        expectedCompletionMs:
          getExpectedCompletionMs(
            run,
            standardMinutes
          )
      };
    })
    .sort((a, b) => {
      const aProcess =
        getProcessSortParts(a.run);

      const bProcess =
        getProcessSortParts(b.run);

      if (aProcess.number !== bProcess.number) {
        return aProcess.number - bProcess.number;
      }

      const suffixCompare =
        aProcess.suffix.localeCompare(
          bProcess.suffix,
          undefined,
          { numeric: true }
        );

      if (suffixCompare !== 0) {
        return suffixCompare;
      }

      return (
        getTimestampMs(a.run.startEpochMs) -
        getTimestampMs(b.run.startEpochMs)
      );
    });
}


/* =========================================================
   TABLE RENDERING
========================================================= */

function renderTable(runs) {
  if (!selectedStation) {
    progressTableBody.innerHTML = `
      <tr>
        <td colspan="8" class="empty-cell">
          Select a date and station.
        </td>
      </tr>
    `;

    return;
  }

  if (!runs.length) {
    progressTableBody.innerHTML = `
      <tr>
        <td colspan="8" class="empty-cell">
          No projects found for this selection.
        </td>
      </tr>
    `;

    return;
  }

  const rows =
    buildTableRows(runs);

  progressTableBody.innerHTML =
    rows.map(row => {
    const run = row.run;

    const statusClass =
      getDisplayStatusClass(run);

    const standardDisplay =
      row.standardMinutes > 0
        ? formatDuration(row.standardMinutes)
        : "No standard";

    const endDisplay =
      normalizeStatus(run.status) === "completed"
        ? formatClockTime(
            getTimestampMs(
              run.endEpochMs ||
              run.endAt
            )
          )
        : "-";

    const startDisplay =
      formatClockTime(
        getTimestampMs(
          run.startEpochMs ||
          run.startAt
        )
      );

    const typeDisplay =
      getTypeDisplayName(
        normalizeUpper(run.qrKind) === "PV"
          ? run.vesselType || "-"
          : run.coolingType || "CHILLER"
      );

    const performance =
      row.performance;

    return `
      <tr class="performance-row ${performance.className}">
        <td class="project-cell">
            <strong>
              ${escapeHtml(run.projectName || "-")}
            </strong>

            <small class="serial-text">
              Material Number: ${escapeHtml(run.materialNumber || "-")}
            </small>
        </td>

        <td class="process-cell">
          <strong>
            ${escapeHtml(getProcessDisplayName(run) || "-")}
          </strong>
        </td>

        <td>
          <span class="status-badge ${statusClass}">
            ${escapeHtml(getDisplayStatusLabel(run))}
          </span>
        </td>

        <td>${escapeHtml(typeDisplay)}</td>

        <td>${startDisplay}</td>

        <td>${endDisplay}</td>

        <td>${standardDisplay}</td>

        <td class="performance-column">
          <div class="performance-meta">
            <span class="performance-total-time">
              ${escapeHtml(performance.totalTimeText || "-")}
            </span>
            <span>${escapeHtml(performance.detail)}</span>
          </div>

          <div
            class="row-performance-track"
            style="--section-width: ${performance.sectionWidthPercent || 10}%">
            ${(performance.segments || []).map(segment => `
              <div
                class="row-performance-bar ${segment.className}"
                style="width: ${segment.percent}%">
              </div>
            `).join("")}
          </div>
        </td>
      </tr>
    `;
  }).join("");
}


/* =========================================================
   SUMMARY RENDERING
========================================================= */

function renderSummary(runs) {
  const completed = runs.filter(
    run => getDisplayStatusKey(run) === "completed"
  ).length;

  const running = runs.filter(
    run => getDisplayStatusKey(run) === "running"
  ).length;

  const onHold = runs.filter(
    run => getDisplayStatusKey(run) === "on_hold"
  ).length;

  const selectedStationDisplay =
    selectedStation
      ? getStationDisplayName(selectedStation)
      : "";

  selectedStationText.textContent =
    selectedStationDisplay || "-";

  projectCountText.textContent = runs.length;
  completedCountText.textContent = completed;
  runningCountText.textContent = running;
  onHoldCountText.textContent = onHold;

  progressTitle.textContent =
    selectedStation
      ? `${selectedStationDisplay} Process Performance`
      : "Daily Process Performance";

  progressSubTitle.textContent =
    selectedStation
      ? `Station: ${selectedStationDisplay}`
      : "Select a date and station to view project progress.";
}

function renderDashboard() {
  const selectedRuns =
    getSelectedRuns();

  renderSummary(selectedRuns);
  renderTable(selectedRuns);

  lastDashboardUpdateAt =
    new Date();

  updateLastUpdateText();
}

/* =========================================================
   LAST UPDATE
========================================================= */

function formatRelativeTime(date) {
  if (!date) return "-";

  const differenceMs =
    Date.now() - date.getTime();

  const seconds =
    Math.max(
      0,
      Math.floor(differenceMs / 1000)
    );

  if (seconds < 60) {
    return "Just now";
  }

  const minutes = Math.floor(seconds / 60);

  if (minutes < 60) {
    return `${minutes} minute${minutes === 1 ? "" : "s"} ago`;
  }

  const hours = Math.floor(minutes / 60);

  if (hours < 24) {
    return `${hours} hour${hours === 1 ? "" : "s"} ago`;
  }

  const days = Math.floor(hours / 24);

  return `${days} day${days === 1 ? "" : "s"} ago`;
}

function updateLastUpdateText() {
  lastUpdateText.textContent = formatRelativeTime(lastDashboardUpdateAt);
}


/* =========================================================
   LOADING STATE
========================================================= */

function setLoading(isLoading) {
  refreshBtn.disabled = isLoading;

  refreshBtn.textContent =
    isLoading
      ? "Loading..."
      : "Refresh";

  periodPicker.disabled = isLoading;
  stationSelect.disabled = isLoading;
}


/* =========================================================
   MAIN LOAD FUNCTIONS
========================================================= */

async function loadDailyDashboard({ forceRefresh = false } = {}) {
  try {
    setLoading(true);

    const selectedDate =
      periodPicker.value;

    dailyRuns =
      await loadDailyRuns(selectedDate, forceRefresh);

    renderStationOptions();
    renderDashboard();

  } catch (error) {
    console.error(
      "Failed to load daily dashboard:",
      error
    );

    progressTableBody.innerHTML = `
      <tr>
        <td colspan="7" class="empty-cell error-cell">
          Failed to load Firebase data.
        </td>
      </tr>
    `;

  } finally {
    setLoading(false);
  }
}

async function initializeStandards() {
  try {
    allHistoricalSegments =
      await loadHistoricalSegments();

    historicalStandards =
      buildHistoricalStandards(
        allHistoricalSegments
      );

    console.log(
      "Historical standards loaded:",
      historicalStandards
    );

  } catch (error) {
    console.error(
      "Failed to load historical standards:",
      error
    );

    historicalStandards = {};
  }
}

async function initializeDashboard() {
  const urlState =
    getUrlState();

  periodPicker.value =
    urlState.date || getCurrentDateKey();

  selectedStation =
    urlState.station;

  await loadDailyDashboard();

  initializeStandards()
    .then(() => {
      if (dailyRuns.length) {
        renderDashboard();
      }
    });

  autoRefreshTimer =
    setInterval(
      () => loadDailyDashboard({ forceRefresh: true }),
      60000
    );

  setInterval(
    updateLastUpdateText,
    30000
  );
}


/* =========================================================
   EVENT LISTENERS
========================================================= */

periodPicker.addEventListener(
  "change",
  async () => {
    selectedStation = "";

    await loadDailyDashboard();
  }
);

stationSelect.addEventListener(
  "change",
  () => {
    selectedStation =
      stationSelect.value;

    renderDashboard();
    updateUrlState();
  }
);

refreshBtn.addEventListener(
  "click",
  () => loadDailyDashboard({ forceRefresh: true })
);


/* =========================================================
   START
========================================================= */

initializeDashboard();
