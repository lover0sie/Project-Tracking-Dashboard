import {
  buildSegmentsFromRuns,
  getActualEffectiveDurationMs,
  getStandardMinutes,
  getProcessCode,
  buildHistoricalStandardsByModelProcess as buildSharedHistoricalStandardsByModelProcess,
  STANDARD_BASELINE_FROM,
  STANDARD_BASELINE_TO,
  STANDARD_FACTOR
} from "./helpers.js";

import { PV_COMBINED_LINE_BALANCE } from "./pv-combined-list.js";

import { loadProjectHeadersFallbackFromRuns, loadRunsForProject } from "./timeline.js";
import {
  exportLineBalanceStandardRawData,
  exportCombinedLineBalanceRawData
} from "./excel-export.js";

const projectNameEl = document.getElementById("lbProjectName");
const chillerSerialEl = document.getElementById("lbChillerSerial");
const projectListEl = document.getElementById("lbProjectList");
const projectCountEl = document.getElementById("lbProjectCount");
const qrKindViewEl = document.getElementById("lbQrKindView");
const chartsContainerEl = document.getElementById("lineBalanceCharts");
const projectSearchEl = document.getElementById("lbProjectSearch");
const projectSearchClearEl = document.getElementById("lbProjectSearchClear");
const projectSortEl = document.getElementById("lbProjectSort");
const projectSortMenuEl = document.getElementById("lbProjectSortMenu");
const modeViewEl = document.getElementById("lbModeView");
const countLabelEl = document.getElementById("lbCountLabel");
const chillerSerialGroupEl = document.getElementById("lbChillerSerialGroup");
const modelDateFromGroupEl = document.getElementById("lbModelDateFromGroup");
const modelDateToGroupEl = document.getElementById("lbModelDateToGroup");
const modelDateFromEl = document.getElementById("lbModelDateFrom");
const modelDateToEl = document.getElementById("lbModelDateTo");


let projectSortMode = "latest";
let selectedProjectSerial = "";
let currentProjects = [];
let allRunsCache = [];
let allSegmentsCache = [];
let tooltipEl = null;
let selectedProjectRuns = [];
let selectedProjectSegments = [];
let projectSearchTerm = "";
let lineBalanceMode = "PROJECT";
let currentModels = [];
let selectedModel = "";
let modelDateFrom = "";
let modelDateTo = "";
let modelDateBoundsInitialized = false;
let historicalStandardsByModelProcess = {};
let combinedLineBalanceDebugRows = [];

let lineBalanceView = {
  showStandard: true, // default on
  showActual: true,   // default on
  showTotal: false    // default off
};

let lineBalanceVesselView = {
  EVAPORATOR: true,
  CONDENSER: true,
  "OIL SEPARATOR": true,
  ECONOMIZER: true
};

const CHILLER_PROCESS_ORDER = {
  "AIR-COOLED": [
    "PIPING SHOP",
    "A1",
    "A2",
    "B1",
    "B2",
    "B3",
    "B4",
    "B5",
    "C1",
    "C2",
    "D1",
    "D2",
    "D3",
    "D4",
    "D5",
    "D6",
    "H1",
    "H2",
    "H3"
  ],
  "WATER-COOLED": [
    "PIPING SHOP",
    "STEEL PIPE SUB-ASSEMBLY (FITTING)",
    "STEEL PIPE SUB-ASSEMBLY WELDING",
    "STEEL PIPE SUB-ASSEMBLY (WELDING)",
    "STEEL PIPE SUB-ASSEMBLY",
    "A",
    "B",
    "C",
    "D",
    "E",
    "F",
    "G",
    "H1",
    "H2",
    "H3"
  ]
};

const CHILLER_PROCESS_RANKS = Object.fromEntries(
  Object.entries(CHILLER_PROCESS_ORDER).map(([type, processes]) => [
    type,
    new Map(processes.map((process, index) => [normalizeProcessOrderCode(process), index]))
  ])
);

function getProjectSortTime(project) {
  return Number(
    project.latestStart ||
    project.updatedAtEpochMs ||
    project.lastUpdatedEpochMs ||
    project.startEpochMs ||
    project.firstStart ||
    0
  );
}

function getSegmentType(seg) {
  if (String(seg?.qrKind || "").toUpperCase() === "PV") {
    return String(seg?.vesselType || "PV").trim();
  }

  return "CHILLER";
}

function getStandardKey(model, type, processCode) {
  return [
    String(model || "").trim(),
    String(type || "").trim(),
    String(processCode || "").trim()
  ].join("__");
}

function sortProjects(projects) {
  const list = Array.isArray(projects) ? [...projects] : [];

  return list.sort((a, b) => {
    const aName = String(a.projectName || "").toLowerCase();
    const bName = String(b.projectName || "").toLowerCase();

    const aTime = getProjectSortTime(a);
    const bTime = getProjectSortTime(b);

    if (projectSortMode === "az") {
      return aName.localeCompare(bName);
    }

    if (projectSortMode === "za") {
      return bName.localeCompare(aName);
    }

    if (projectSortMode === "oldest") {
      return aTime - bTime;
    }

    return bTime - aTime;
  });
}

const PV1_MODELS = ["HXE-TT", "HXE-M", "HXE-TG", "HXE-HT", "ZUWV", "ZUWS", "ZUWY"];

function isPv1Model(model = "") {
  const modelKey = String(model || "").trim().toUpperCase();
  return PV1_MODELS.includes(modelKey);
}

// Normalize process code for combined chart
function normalizeProcessCodeForCombined(processCode, model = "") {
  const code = String(processCode || "").trim().toUpperCase();
  const modelKey = String(model || "").trim().toUpperCase();

  if (code === "19" || code === "18, 19") return "18,19";

  if (PV1_MODELS.includes(modelKey)) {
    if (code === "6A" || code === "6B") return "6";
    if (code === "8A" || code === "8B" || code === "8C") return "8";
    if (code === "9B") return "9";

  }

  return code;
}

function shouldSkipProcessForCombined(processCode, model = "") {
  const code = String(processCode || "").trim().toUpperCase();
  const modelKey = String(model || "").trim().toUpperCase();

  if (PV1_MODELS.includes(modelKey)) {
    // For PV1, ignore 9A. Only 9B is taken as process 9.
    if (code === "9A") return true;
  }

  return false;
}

function applyProcess13LargestOnly(rows) {
  const process13Rows = rows.filter(row =>
    String(row.label || "").trim().toUpperCase() === "13" &&
    Number(row.actual || 0) > 0
  );

  if (process13Rows.length <= 1) return rows;

  const largest = process13Rows.reduce((max, row) =>
    Number(row.actual || 0) > Number(max.actual || 0) ? row : max
  );

  return rows.filter(row => {
    if (String(row.label || "").trim().toUpperCase() !== "13") return true;
    return row === largest;
  });
}

// Get the combined chart configuration for a given model, if it exists
function getPvCombinedConfig(model) {
  const modelKey = String(model || "").trim().toUpperCase();

  return PV_COMBINED_LINE_BALANCE.find(config =>
    config.models.some(m => String(m).toUpperCase() === modelKey)
  );
}

function findCombinedGroup(config, vesselType, processCode) {
  const vessel = String(vesselType || "").trim().toUpperCase();
  const code = String(processCode || "").trim().toUpperCase();

  for (let groupIndex = 0; groupIndex < config.groups.length; groupIndex++) {
    const group = config.groups[groupIndex];

    const vesselMatch = group.vessels.some(v =>
      String(v).toUpperCase() === vessel
    );

    const processMatch = group.processes.some(p =>
      String(p).toUpperCase() === code
    );

    if (vesselMatch && processMatch) {
      return { group, groupIndex };
    }
  }

  return null;
}

function updateSearchClearVisibility() {
  if (!projectSearchEl || !projectSearchClearEl) return;

  const hasText = projectSearchEl.value.trim().length > 0;

  if (hasText) {
    projectSearchClearEl.classList.add("show");
  } else {
    projectSearchClearEl.classList.remove("show");
  }
}

function updateToolbarModeUi() {
  const isModelBase = lineBalanceMode === "MODEL";
  document.querySelector(".lineBalanceToolbar")?.classList.toggle("modelMode", isModelBase);

  if (countLabelEl) {
    countLabelEl.textContent = isModelBase ? "Total Models" : "Total Projects";
  }

  if (chillerSerialGroupEl) {
    chillerSerialGroupEl.style.display = isModelBase ? "none" : "";
  }

  if (projectNameEl) {
    const label = projectNameEl.closest(".toolbarGroup")?.querySelector("label");
    if (label) {
      label.textContent = isModelBase ? "Selected Model" : "Selected Project";
    }
  }

  modelDateFromGroupEl?.classList.toggle("hidden", !isModelBase);
  modelDateToGroupEl?.classList.toggle("hidden", !isModelBase);
}

function setModelDateControlsLoading(isLoading) {
  if (modelDateFromEl) modelDateFromEl.disabled = isLoading;
  if (modelDateToEl) modelDateToEl.disabled = isLoading;
}

function renderModelFilterLoading() {
  if (projectListEl) {
    projectListEl.innerHTML = `<div class="emptyState">Loading models for selected date range...</div>`;
  }

  if (chartsContainerEl) {
    chartsContainerEl.innerHTML = `<div class="emptyState">Loading line balance for selected date range...</div>`;
  }
}

// Calculate the standard time from an array of actual duration values using the chosen method and applying the standard factor
function calculateStandardFromValues(values) {
  if (!values.length) return 0;

  // OPTION 1: Average × 80%
  const average = values.reduce((sum, v) => sum + v, 0) / values.length;
  return average * STANDARD_FACTOR;

  // OPTION 2: Median × 80%
  // const sorted = [...values].sort((a, b) => a - b);
  // const mid = Math.floor(sorted.length / 2);
  // const median =
  //   sorted.length % 2
  //     ? sorted[mid]
  //     : (sorted[mid - 1] + sorted[mid]) / 2;
  // return median * STANDARD_FACTOR;
}

function isSegmentInStandardBaseline(seg) {
  const startMs =
    seg?.start instanceof Date
      ? seg.start.getTime()
      : Number(seg?.run?.startEpochMs || seg?.startEpochMs || 0);

  const fromMs = parseDateStartMs(STANDARD_BASELINE_FROM);
  const toMs = parseDateEndMs(STANDARD_BASELINE_TO);

  return startMs >= fromMs && startMs <= toMs;
}

function getTotalDurationMs(seg) {
  const startMs = seg?.start instanceof Date ? seg.start.getTime() : null;
  const endMs = seg?.end instanceof Date ? seg.end.getTime() : null;

  if (startMs == null || endMs == null) return 0;
  return Math.max(0, endMs - startMs);
}

// get manpower for segment, default to 1 if not available or invalid
function getSegmentManpower(seg) {
  const manpower = Number(seg?.manpower || seg?.run?.manpower || 1);
  return Number.isFinite(manpower) && manpower > 0 ? manpower : 1;
}

function roundManpower(manpower) {
  const value = Number(manpower || 1);
  return Number.isFinite(value) && value > 0 ? Math.ceil(value) : 1;
}

function getMetricUnitLabel() {
  return "Duration (mins)";
}

function normalizeProjectHeaders(rows) {
  return (Array.isArray(rows) ? rows : [])
    .map(row => ({
      chillerSerialNumber: String(row.chillerSerialNumber || row.id || "").trim(),
      projectName: row.projectName || "-",
      materialNumber: row.materialNumber || "-",
      model: String(
        row.model ||
        row.chillerModel ||
        row.unitModel ||
        row.modelName ||
        "-"
      ).trim(),
      runCount: Number(row.runCount || 0),
      qrKinds: Array.isArray(row.qrKinds) ? row.qrKinds : [],

      latestStart: Number(row.latestStart || 0),
      firstStart: Number(row.firstStart || 0)
    }))
    .filter(row => row.chillerSerialNumber);
}

function parseDateStartMs(value) {
  if (!value) return null;

  const [year, month, day] = String(value).split("-").map(Number);
  if (!year || !month || !day) return null;

  return new Date(year, month - 1, day, 0, 0, 0, 0).getTime();
}

function formatDateInputValue(ms) {
  if (!Number.isFinite(ms) || ms <= 0) return "";

  const date = new Date(ms);
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");

  return `${year}-${month}-${day}`;
}

function getProjectDateBounds(projects) {
  let earliestMs = Infinity;
  let latestMs = 0;

  for (const project of projects || []) {
    const firstStart = Number(project?.firstStart || 0);
    const latestStart = Number(project?.latestStart || 0);

    if (firstStart > 0) earliestMs = Math.min(earliestMs, firstStart);
    if (latestStart > 0) latestMs = Math.max(latestMs, latestStart);
  }

  return {
    earliestMs: earliestMs === Infinity ? null : earliestMs,
    latestMs: latestMs || null
  };
}

function applyModelDateBounds(projects) {
  const { earliestMs, latestMs } = getProjectDateBounds(projects);
  const earliestValue = formatDateInputValue(earliestMs);
  const latestValue = formatDateInputValue(latestMs);

  if (modelDateFromEl) {
    modelDateFromEl.placeholder = earliestValue || "From";
    if (earliestValue) modelDateFromEl.min = earliestValue;
    if (latestValue) modelDateFromEl.max = latestValue;
  }

  if (modelDateToEl) {
    modelDateToEl.placeholder = latestValue || "To";
    if (earliestValue) modelDateToEl.min = earliestValue;
    if (latestValue) modelDateToEl.max = latestValue;
  }

  if (!modelDateBoundsInitialized) {
    if (modelDateFromEl && earliestValue && !modelDateFromEl.value) {
      modelDateFromEl.value = earliestValue;
      modelDateFrom = earliestValue;
    }

    if (modelDateToEl && latestValue && !modelDateToEl.value) {
      modelDateToEl.value = latestValue;
      modelDateTo = latestValue;
    }

    modelDateBoundsInitialized = true;
  }
}

function parseDateEndMs(value) {
  if (!value) return null;

  const [year, month, day] = String(value).split("-").map(Number);
  if (!year || !month || !day) return null;

  return new Date(year, month - 1, day, 23, 59, 59, 999).getTime();
}

function getModelDateRange() {
  const fromMs = parseDateStartMs(modelDateFrom);
  const toMs = parseDateEndMs(modelDateTo);

  if (fromMs != null && toMs != null && fromMs > toMs) {
    return { fromMs: toMs, toMs: fromMs };
  }

  return { fromMs, toMs };
}

function getRunStartMs(run) {
  const startMs = Number(run?.startEpochMs);
  if (Number.isFinite(startMs)) return startMs;

  if (run?.startAt && typeof run.startAt.toMillis === "function") {
    return run.startAt.toMillis();
  }

  if (run?.startAt && typeof run.startAt.toDate === "function") {
    return run.startAt.toDate().getTime();
  }

  return null;
}

function isRunInModelDateRange(run) {
  const { fromMs, toMs } = getModelDateRange();
  if (fromMs == null && toMs == null) return true;

  const startMs = getRunStartMs(run);
  if (!Number.isFinite(startMs)) return false;

  if (fromMs != null && startMs < fromMs) return false;
  if (toMs != null && startMs > toMs) return false;

  return true;
}

function isProjectInModelDateRange(project) {
  const { fromMs, toMs } = getModelDateRange();
  if (fromMs == null && toMs == null) return true;

  const firstStart = Number(project?.firstStart || 0);
  const latestStart = Number(project?.latestStart || 0);

  if (!firstStart && !latestStart) return false;
  if (fromMs != null && latestStart && latestStart < fromMs) return false;
  if (toMs != null && firstStart && firstStart > toMs) return false;

  return true;
}

function escapeHtml(str = "") {
  return String(str)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function formatActualDurationSummary(value) {
  const minutes = Number(value || 0);
  const hours = minutes / 60;
  const days = hours / 24;

  return `${hours.toLocaleString(undefined, {
    maximumFractionDigits: 1
  })} hr / ${days.toLocaleString(undefined, {
    maximumFractionDigits: 1
  })} days`;
}

function getCombinedActualTotal(data, filterVessels = false) {
  return (Array.isArray(data) ? data : []).reduce((sum, row) => {
    if (filterVessels && Array.isArray(row.stackParts)) {
      const visibleParts = row.stackParts.filter(part =>
        lineBalanceVesselView[String(part?.key || "").toUpperCase()] !== false
      );

      if (!visibleParts.length) return sum;

      return sum + visibleParts.reduce(
        (partSum, part) => partSum + Number(part.actual || 0),
        0
      );
    }

    return sum + Number(row.actual || 0);
  }, 0);
}

function getSegmentProcessLabel(seg) {
  return String(seg.processLabel || seg.processName || "").trim() || "Unknown";
}

function normalizeProcessOrderCode(processCode = "") {
  return String(processCode || "")
    .trim()
    .replace(/\s*,\s*/g, ",")
    .replace(/\s+/g, " ")
    .toUpperCase();
}

function normalizeChillerType(value = "") {
  return String(value || "").trim().toUpperCase();
}

function getChillerProcessType(seg) {
  if (String(seg?.qrKind || "").trim().toUpperCase() !== "CHILLER") return "";

  const coolingType = normalizeChillerType(seg?.coolingType);
  const vesselType = normalizeChillerType(seg?.vesselType);

  if (CHILLER_PROCESS_RANKS[coolingType]) return coolingType;
  if (CHILLER_PROCESS_RANKS[vesselType]) return vesselType;

  return "";
}

function getKnownChillerProcessCode(processName = "", chillerType = "") {
  const label = normalizeProcessOrderCode(processName);
  const type = normalizeChillerType(chillerType);
  const typeProcesses = CHILLER_PROCESS_ORDER[type] || [];
  const allProcesses = Array.from(
    new Set(Object.values(CHILLER_PROCESS_ORDER).flat())
  );
  const candidates = (typeProcesses.length ? typeProcesses : allProcesses)
    .map(normalizeProcessOrderCode)
    .sort((a, b) => b.length - a.length);

  return candidates.find(code =>
    label === code ||
    label.startsWith(`${code} -`) ||
    label.startsWith(`${code} `)
  ) || "";
}

function getLineBalanceProcessCode(processName = "", chillerType = "") {
  return getKnownChillerProcessCode(processName, chillerType) || getProcessCode(processName);
}

function inferChillerProcessType(segments) {
  let airSignals = 0;
  let waterSignals = 0;
  const explicitTypes = new Map();

  for (const seg of segments || []) {
    if (String(seg?.qrKind || "").trim().toUpperCase() !== "CHILLER") continue;

    const explicitType = getChillerProcessType(seg);
    if (explicitType) {
      explicitTypes.set(explicitType, (explicitTypes.get(explicitType) || 0) + 1);
    }

    const code = getKnownChillerProcessCode(getSegmentProcessLabel(seg), "");
    if (!code) continue;

    const inAir = CHILLER_PROCESS_RANKS["AIR-COOLED"].has(code);
    const inWater = CHILLER_PROCESS_RANKS["WATER-COOLED"].has(code);

    if (inAir && !inWater) airSignals++;
    if (inWater && !inAir) waterSignals++;
  }

  if (airSignals || waterSignals) {
    return airSignals >= waterSignals ? "AIR-COOLED" : "WATER-COOLED";
  }

  return Array.from(explicitTypes.entries())
    .sort((a, b) => b[1] - a[1])[0]?.[0] || "";
}

function getChillerProcessRank(processCode = "", chillerType = "") {
  const code = normalizeProcessOrderCode(processCode);
  const type = normalizeChillerType(chillerType);

  if (CHILLER_PROCESS_RANKS[type]?.has(code)) {
    return CHILLER_PROCESS_RANKS[type].get(code);
  }

  const leadingCodeMatch = code.match(/^([A-Z]+\d*)\b/);
  const leadingCode = leadingCodeMatch?.[1] || "";

  if (leadingCode && CHILLER_PROCESS_RANKS[type]?.has(leadingCode)) {
    return CHILLER_PROCESS_RANKS[type].get(leadingCode);
  }

  if (leadingCode) {
    const leadingCodeRanks = Object.values(CHILLER_PROCESS_RANKS)
      .map(rankMap => rankMap.get(leadingCode))
      .filter(rank => rank != null);

    if (leadingCodeRanks.length) return Math.min(...leadingCodeRanks);
  }

  if (CHILLER_PROCESS_RANKS[type]) {
    return null;
  }

  const matchingRanks = Object.values(CHILLER_PROCESS_RANKS)
    .map(rankMap => rankMap.get(code))
    .filter(rank => rank != null);

  return matchingRanks.length ? Math.min(...matchingRanks) : null;
}

function getProcessSortKey(processName = "", chillerType = "") {
  const code = getLineBalanceProcessCode(processName, chillerType);
  const first = String(code || "").split(",")[0].trim();
  const m = first.match(/^(\d+)([A-Z]?)/i);
  const chillerRank =
    getChillerProcessRank(code, chillerType) ??
    getChillerProcessRank(processName, chillerType);

  if (!m) {
    return {
      chillerRank,
      major: 9999,
      suffix: "",
      label: normalizeProcessOrderCode(code)
    };
  }

  return {
    chillerRank,
    major: Number(m[1]),
    suffix: (m[2] || "").toUpperCase(),
    label: normalizeProcessOrderCode(code)
  };
}

function getProcessDisplayName(processName = "") {
  const label = String(processName || "").trim();
  return label.replace(/^.+?\s*-\s*/, "").trim() || label;
}

function formatUniqueList(values) {
  return Array.from(values || [])
    .map(value => String(value || "").trim())
    .filter(Boolean)
    .sort((a, b) => a.localeCompare(b))
    .join(", ");
}

function compareProcessSortKey(a, b) {
  const aRank = a?.chillerRank;
  const bRank = b?.chillerRank;

  if (aRank != null || bRank != null) {
    if (aRank == null) return 1;
    if (bRank == null) return -1;
    if (aRank !== bRank) return aRank - bRank;
  }

  if ((a?.major ?? 9999) !== (b?.major ?? 9999)) {
    return (a?.major ?? 9999) - (b?.major ?? 9999);
  }

  const suffixCompare = (a?.suffix || "").localeCompare(b?.suffix || "");
  if (suffixCompare) return suffixCompare;

  return (a?.label || "").localeCompare(b?.label || "");
}

function buildAverageProcessChartData(segments) {
  const processMap = new Map();
  const chartChillerType = inferChillerProcessType(segments);

  for (const seg of segments) {
    if (seg.phase === "waiting" || seg.status === "waiting") continue;

    const fullLabel = getSegmentProcessLabel(seg);
    const chillerType = chartChillerType || getChillerProcessType(seg);
    const processCode = getLineBalanceProcessCode(fullLabel, chillerType);

  
    const actualMin = getActualEffectiveDurationMs(seg) / 60000;
    const totalMin = getTotalDurationMs(seg) / 60000;
    const standardMin = getHistoricalStandardMin(seg, processCode);

    if (!processMap.has(processCode)) {
      processMap.set(processCode, {
        label: processCode,
        fullLabel,
        actualSum: 0,
        totalSum: 0,
        standardMin,
        manpowerSum: 0,
        count: 0,
        projectNames: new Set(),
        serialNumbers: new Set(),
        sortKey: getProcessSortKey(fullLabel, chillerType)
      });
    }

    const row = processMap.get(processCode);
    const manpower = getSegmentManpower(seg);
    const projectName = String(seg.projectName || "").trim();
    const serialNumber = String(seg.chillerSerialNumber || "").trim();

    row.actualSum += actualMin;
    row.totalSum += totalMin;
    row.manpowerSum += manpower;
    if (projectName) row.projectNames.add(projectName);
    if (serialNumber) row.serialNumbers.add(serialNumber);
    row.count++;
  }
  return Array.from(processMap.values())
    .sort((a, b) => compareProcessSortKey(
      getProcessSortKey(a.label, chartChillerType),
      getProcessSortKey(b.label, chartChillerType)
    ))
    .map(row => {
      const divisor = Number(row.count || 1);
      const avgManpower = roundManpower(row.manpowerSum / row.count);
      const actual = row.actualSum / divisor;
      const total = row.totalSum / divisor;
      const standard = row.standardMin;

      return {
        label: row.label, // process code only
        fullLabel: row.fullLabel,
        projectName: formatUniqueList(row.projectNames),
        serialNumber: formatUniqueList(row.serialNumbers),
        actual: Number(actual.toFixed(1)),
        total: Number(total.toFixed(1)),
        standard: Number(standard.toFixed(1)),
        avgManpower
      };
    });
}

function buildModels(runs) {
  const map = new Map();

  for (const run of runs) {
    const model = String(run.model || "").trim();
    if (!model) continue;

    if (!map.has(model)) {
      map.set(model, {
        model,
        runCount: 0,
        vesselTypes: new Set()
      });
    }

    const row = map.get(model);

    row.runCount++;

    if (run.vesselType) {
      row.vesselTypes.add(
        String(run.vesselType).trim()
      );
    }
  }

  return Array.from(map.values()).map(item => ({
    ...item,
    vesselTypes: Array.from(item.vesselTypes)
  }));
}

function buildProjects(runs) {
  
  const map = new Map();

  for (const run of runs) {
    const serial = String(run.chillerSerialNumber || "").trim();
    if (!serial) continue;

    if (!map.has(serial)) {
      map.set(serial, {
        chillerSerialNumber: serial,
        projectName: run.projectName || "-",
        materialNumber: run.materialNumber || "-",
        model: run.model || "-",
        runCount: 0,
        qrKinds: new Set(),
        latestStart: 0,
        firstStart: Infinity
      });
    }

    const row = map.get(serial);
    row.runCount += 1;

    const startMs = Number(run.startEpochMs || 0);

    if (startMs) {
      row.latestStart = Math.max(row.latestStart || 0, startMs);
      row.firstStart = Math.min(row.firstStart || Infinity, startMs);
    }

    if (run.qrKind) {
      row.qrKinds.add(String(run.qrKind).trim());
    }

  
  }

  return Array.from(map.values())

  .map(item => ({
    ...item,
    qrKinds: Array.from(item.qrKinds),
    firstStart: item.firstStart === Infinity ? 0 : item.firstStart
  }));
}

// Build historical standards by model and process code from segments that are within the defined baseline period
function getHistoricalStandardMin(seg, processCode) {
  const key = getStandardKey(seg.model, getSegmentType(seg), processCode);
  return historicalStandardsByModelProcess[key] || 0;
}

function getProjectSegments(segments, chillerSerialNumber) {
  return segments.filter(seg =>
    String(seg.chillerSerialNumber || "").trim() === String(chillerSerialNumber || "").trim()
  );
}

function groupPvSegmentsByVesselType(segments) {
  const map = new Map();

  for (const seg of segments) {
    const vesselType = String(seg.vesselType || "").trim();
    if (!vesselType) continue;

    if (!map.has(vesselType)) {
      map.set(vesselType, []);
    }

    map.get(vesselType).push(seg);
  }

  return map;
}

function buildProcessChartData(segments) {
  const processMap = new Map();
  const chartChillerType = inferChillerProcessType(segments);

  for (const seg of segments) {
    if (seg.phase === "waiting" || seg.status === "waiting") continue;

    const fullLabel = getSegmentProcessLabel(seg);
    const chillerType = chartChillerType || getChillerProcessType(seg);
    const processCode = getLineBalanceProcessCode(fullLabel, chillerType);

    const actualMin = getActualEffectiveDurationMs(seg) / 60000;
    const totalMin = getTotalDurationMs(seg) / 60000;

    const standardMin = getHistoricalStandardMin(seg, processCode);

    if (!processMap.has(processCode)) {
      processMap.set(processCode, {
        label: processCode,
        fullLabel,
        actualMin: 0,
        totalMin: 0,
        standardMin,
        manpowerSum: 0,
        segmentCount: 0,
        projectNames: new Set(),
        serialNumbers: new Set(),
        sortKey: getProcessSortKey(fullLabel, chillerType)
      });
    }

    const row = processMap.get(processCode);

    const manpower = getSegmentManpower(seg);
    const projectName = String(seg.projectName || "").trim();
    const serialNumber = String(seg.chillerSerialNumber || "").trim();

    row.actualMin += actualMin;
    row.totalMin += totalMin;

    row.manpowerSum += manpower;
    if (projectName) row.projectNames.add(projectName);
    if (serialNumber) row.serialNumbers.add(serialNumber);
    row.segmentCount++;
  }

  return Array.from(processMap.values())
    .sort((a, b) => compareProcessSortKey(
      getProcessSortKey(a.label, chartChillerType),
      getProcessSortKey(b.label, chartChillerType)
    ))
    .map(item => {
      const avgManpower = roundManpower(item.manpowerSum / item.segmentCount);

      return {
        label: item.label, // process code only
        fullLabel: item.fullLabel,
        projectName: formatUniqueList(item.projectNames),
        serialNumber: formatUniqueList(item.serialNumbers),
        actual: Number(item.actualMin.toFixed(1)),
        total: Number(item.totalMin.toFixed(1)),
        standard: Number(item.standardMin.toFixed(1)),
        avgManpower
      };
    });
}

function ensureTooltip() {
  if (tooltipEl) return tooltipEl;

  tooltipEl = document.createElement("div");
  tooltipEl.className = "lbTooltip";
  tooltipEl.style.display = "none";
  document.body.appendChild(tooltipEl);
  return tooltipEl;
}

function showTooltip(html, x, y) {
  const el = ensureTooltip();
  el.innerHTML = html;
  el.style.display = "block";

  const pad = 14;
  const rect = el.getBoundingClientRect();

  let left = x + 14;
  let top = y + 14;

  if (left + rect.width > window.innerWidth - pad) {
    left = x - rect.width - 14;
  }

  if (top + rect.height > window.innerHeight - pad) {
    top = y - rect.height - 14;
  }

  el.style.left = `${Math.max(pad, left)}px`;
  el.style.top = `${Math.max(pad, top)}px`;
}

function hideTooltip() {
  if (tooltipEl) {
    tooltipEl.style.display = "none";
  }
}

function clearCharts() {
  hideTooltip();
  combinedLineBalanceDebugRows = [];
  if (chartsContainerEl) {
    chartsContainerEl.innerHTML = "";
    chartsContainerEl.scrollTop = 0;
  }
}

function createChartCard(titleText, options = {}) {
  const vesselTitle = ["CHILLER", "EVAPORATOR", "CONDENSER", "OIL SEPARATOR", "ECONOMIZER"]
    .find(type => String(titleText || "").includes(type));
  const displayTitle = vesselTitle || titleText;
  const showVesselLegend = !!options.showVesselLegend && lineBalanceView.showActual;
  const actualLegendClass = String(options.actualVesselClass || "").trim();
  const summaryText = String(options.summaryText || "").trim();
  const summaryHtml = summaryText
    ? `<div class="lbChartSummary">${escapeHtml(summaryText)}</div>`
    : "";
  const vesselLegendHtml = showVesselLegend
    ? `
      <div class="lbLegend lbVesselLegend">
        ${["EVAPORATOR", "CONDENSER", "OIL SEPARATOR", "ECONOMIZER"].map(vessel => `
          <label class="lbLegendItem vesselFilter">
            <input
              type="checkbox"
              class="lbToggleVessel"
              data-vessel="${escapeHtml(vessel)}"
              ${lineBalanceVesselView[vessel] ? "checked" : ""}>
            <span class="lbLegendSwatch vessel ${getVesselStackClass(vessel)}"></span>
            ${escapeHtml(formatVesselStackLabel(vessel))}
          </label>
        `).join("")}
      </div>
    `
    : "";

  const wrap = document.createElement("div");
  wrap.className = "chartCard";

  wrap.innerHTML = `
    <div class="lbChartHeader">
      <div class="lbChartTitle">${escapeHtml(displayTitle)}</div>
      ${summaryHtml}
    </div>

    <div class="lbLegend">
      <label class="lbLegendItem">
        <input type="checkbox" class="lbToggleStandard" ${lineBalanceView.showStandard ? "checked" : ""}>
        <span class="lbLegendSwatch standard"></span>
        Standard Time
      </label>

      <label class="lbLegendItem">
        <input type="checkbox" class="lbToggleActual" ${lineBalanceView.showActual ? "checked" : ""}>
        <span class="lbLegendSwatch actual ${escapeHtml(actualLegendClass)}"></span>
        Actual Time
      </label>

      <label class="lbLegendItem">
        <input type="checkbox" class="lbToggleTotal" ${lineBalanceView.showTotal ? "checked" : ""}>
        <span class="lbLegendSwatch total"></span>
        Total Duration
      </label>

      <span class="lbLegendItem">
        <span class="lbLegendLine"></span>
        Takt Time (450 min)
      </span>
    </div>

    ${vesselLegendHtml}

    <div class="lbChartMount"></div>
  `;

  const standardToggle = wrap.querySelector(".lbToggleStandard");
  const actualToggle = wrap.querySelector(".lbToggleActual");
  const totalToggle = wrap.querySelector(".lbToggleTotal");
  const vesselToggles = wrap.querySelectorAll(".lbToggleVessel");

  function rerenderActiveChart() {
    if (lineBalanceMode === "MODEL") {
      const activeModel = currentModels.find(
        m => String(m.model || "") === String(selectedModel || "")
      );

      if (activeModel) {
        renderModelCharts(activeModel);
      }

      return;
    }

    const activeProject = currentProjects.find(
      p => String(p.chillerSerialNumber || "") === String(selectedProjectSerial || "")
    );

    if (activeProject) {
      renderSelectedProjectCharts(activeProject);
    }
  }

  standardToggle?.addEventListener("change", () => {
    lineBalanceView.showStandard = standardToggle.checked;
    rerenderActiveChart();
  });

  actualToggle?.addEventListener("change", () => {
    lineBalanceView.showActual = actualToggle.checked;
    rerenderActiveChart();
  });

  totalToggle?.addEventListener("change", () => {
    lineBalanceView.showTotal = totalToggle.checked;
    rerenderActiveChart();
  });

  vesselToggles.forEach(toggle => {
    toggle.addEventListener("change", () => {
      const vessel = toggle.dataset.vessel;
      if (!vessel) return;

      lineBalanceVesselView[vessel] = toggle.checked;

      if (!Object.values(lineBalanceVesselView).some(Boolean)) {
        lineBalanceVesselView[vessel] = true;
        toggle.checked = true;
      }

      rerenderActiveChart();
    });
  });

  chartsContainerEl.appendChild(wrap);
  return wrap.querySelector(".lbChartMount");
}

function renderCustomLineBalanceChart(container, data, options = {}) {
  if (!container) return;
  if (!Array.isArray(data) || !data.length) {
    container.innerHTML = `<div class="emptyState">No data available for this view.</div>`;
    return;
  }

  const takt = Number(options.taktTime ?? 450);
  const defaultActualVesselClass = options.actualVesselClass || "";
  const filterVessels = !!options.filterVessels && lineBalanceView.showActual;
  const isVisibleVessel = part => !filterVessels || lineBalanceVesselView[String(part?.key || "").toUpperCase()] !== false;
  const chartData = data
    .map(row => {
      const stackParts = Array.isArray(row.stackParts)
        ? row.stackParts.filter(isVisibleVessel)
        : [];

      if (!filterVessels || !Array.isArray(row.stackParts)) return row;
      if (!stackParts.length) return null;

      return {
        ...row,
        stackParts,
        standard: Number(stackParts.reduce((sum, part) => sum + Number(part.standard || 0), 0).toFixed(1)),
        actual: Number(stackParts.reduce((sum, part) => sum + Number(part.actual || 0), 0).toFixed(1)),
        total: Number(stackParts.reduce((sum, part) => sum + Number(part.total || 0), 0).toFixed(1))
      };
    })
    .filter(Boolean);

  if (!chartData.length) {
    container.innerHTML = `<div class="emptyState">No data available for the selected vessel filters.</div>`;
    return;
  }

  const visibleSeries = [];
  if (lineBalanceView.showStandard) visibleSeries.push("standard");
  if (lineBalanceView.showActual) visibleSeries.push("actual");
  if (lineBalanceView.showTotal) visibleSeries.push("total");

  const rawMax = Math.max(
    takt,
    ...chartData.flatMap(d => [
      lineBalanceView.showStandard ? Number(d.standard || 0) : 0,
      lineBalanceView.showActual ? Number(d.actual || 0) : 0,
      lineBalanceView.showTotal ? Number(d.total || 0) : 0
    ])
  );

  const chartMax = Math.max(500, Math.ceil((rawMax * 1.12) / 50) * 50);
  const tickCount = 5;

  const yAxisHtml = Array.from({ length: tickCount + 1 }, (_, i) => {
    const value = (chartMax / tickCount) * (tickCount - i);
    const pct = (i / tickCount) * 100;

    return `
      <div class="lbTick" style="top:${pct}%">
        <span class="lbTickLabel">${Math.round(value)}</span>
      </div>
    `;
  }).join("");

  const gridHtml = Array.from({ length: tickCount + 1 }, (_, i) => {
    const pct = (i / tickCount) * 100;
    return `<div class="lbGridLine" style="top:${pct}%"></div>`;
  }).join("");

  const taktPct = (takt / chartMax) * 100;

  const colsHtml = chartData.map((d, idx) => {
    const standardPct = (Number(d.standard || 0) / chartMax) * 100;
    const actualPct = (Number(d.actual || 0) / chartMax) * 100;
    const totalPct = (Number(d.total || 0) / chartMax) * 100;
    const standardStackParts = Array.isArray(d.stackParts)
      ? d.stackParts.filter(part => Number(part.standard || 0) > 0)
      : [];
    const actualStackParts = Array.isArray(d.stackParts)
      ? d.stackParts.filter(part => Number(part.actual || 0) > 0)
      : [];
    const showStandardStack = standardStackParts.length > 1 && Number(d.standard || 0) > 0;
    const showActualStack = actualStackParts.length > 1 && Number(d.actual || 0) > 0;
    const singleActualVesselClass = actualStackParts.length === 1
      ? getVesselStackClass(actualStackParts[0].key || actualStackParts[0].label)
      : defaultActualVesselClass;

    const standardValueClass = "";
    const actualValueClass = "";
    const totalValueClass = "";

    let barsHtml = "";

    const renderStackBar = ({ parts, totalValue, totalPctValue, series, valueClass }) => {
      const stackHtml = parts.map((part, partIndex) => {
        const partValue = Number(part[series] || 0);
        const partPct = (partValue / Number(totalValue || 1)) * 100;
        const vesselClass = getVesselStackClass(part.key || part.label);

        return `
          <div
            class="lbStackPart part${partIndex % 4} ${vesselClass}"
            style="height:${partPct}%"
            data-stack-series="${escapeHtml(series)}"
            data-stack-label="${escapeHtml(part.label || part.key || "")}"
            data-stack-value="${partValue.toFixed(1)}"
            title="${escapeHtml(part.label || part.key || "")}: ${partValue.toFixed(0)}">
          </div>
        `;
      }).join("");

      return `
        <div class="lbBar ${series} stacked" style="height:${totalPctValue}%">
          <span class="lbBarValue${valueClass}">${Number(totalValue || 0).toFixed(0)}</span>
          ${stackHtml}
        </div>
      `;
    };

    if (lineBalanceView.showStandard) {
      if (showStandardStack) {
        barsHtml += renderStackBar({
          parts: standardStackParts,
          totalValue: Number(d.standard || 0),
          totalPctValue: standardPct,
          series: "standard",
          valueClass: standardValueClass
        });
      } else {
        barsHtml += `
          <div class="lbBar standard" style="height:${standardPct}%">
            <span class="lbBarValue${standardValueClass}">${Number(d.standard || 0).toFixed(0)}</span>
          </div>
        `;
      }
    }

    if (lineBalanceView.showActual) {
      if (showActualStack) {
        barsHtml += renderStackBar({
          parts: actualStackParts,
          totalValue: Number(d.actual || 0),
          totalPctValue: actualPct,
          series: "actual",
          valueClass: actualValueClass
        });
      } else {
        barsHtml += `
          <div class="lbBar actual ${singleActualVesselClass}" style="height:${actualPct}%">
            <span class="lbBarValue${actualValueClass}">${Number(d.actual || 0).toFixed(0)}</span>
          </div>
        `;
      }
    }

    if (lineBalanceView.showTotal) {
      barsHtml += `
        <div class="lbBar total" style="height:${totalPct}%">
          <span class="lbBarValue${totalValueClass}">${Number(d.total || 0).toFixed(0)}</span>
        </div>
      `;
    }

    return `
      <div class="lbCol"
          data-idx="${idx}"
          data-label="${escapeHtml(d.label || "")}"
          data-full-label="${escapeHtml(d.fullLabel || d.label || "")}"
          data-actual="${Number(d.actual || 0).toFixed(1)}"
          data-standard="${Number(d.standard || 0).toFixed(1)}"
          data-total="${Number(d.total || 0).toFixed(1)}"
          data-stack-parts="${escapeHtml(actualStackParts.map(part => `${part.label || part.key}: ${Number(part.actual || 0).toFixed(1)}`).join(" | "))}"
          data-standard-stack-parts="${escapeHtml(standardStackParts.map(part => `${part.label || part.key}: ${Number(part.standard || 0).toFixed(1)}`).join(" | "))}"
          data-manpower="${roundManpower(d.avgManpower)}">
        
        <div class="lbColPlot">
          <div class="lbBarGroup">
            ${barsHtml}
          </div>
        </div>

        <div class="lbColLabel">${escapeHtml(d.label || "")}</div>
      </div>
    `;
  }).join("");

  container.innerHTML = `
    <div class="lbCustomChart" style="--lbColCount:${chartData.length}">
      <div class="lbYAxis">
        <div class="lbYAxisTitle">${getMetricUnitLabel()}</div>
        <div class="lbYAxisInner">
          ${yAxisHtml}
        </div>
      </div>

      <div class="lbPlotWrap">
        <div class="lbPlot">
          <div class="lbGrid">
            ${gridHtml}
            <div class="lbTaktLine" style="bottom:${taktPct}%">
            </div>
          </div>

          <div class="lbCols">
            ${colsHtml}
          </div>
        </div>
      </div>

      <div class="lbXAxisTitle">Process</div>
    </div>
  `;

  container.querySelectorAll(".lbCol").forEach(col => {
    col.addEventListener("mousemove", e => {
      const fullLabel = col.dataset.fullLabel || col.dataset.label || "-";
      const actual = col.dataset.actual || "0.0";
      const standard = col.dataset.standard || "0.0";
      const total = col.dataset.total || "0.0";
      const stackParts = col.dataset.stackParts || "";
      const standardStackParts = col.dataset.standardStackParts || "";
      const manpower = col.dataset.manpower || "1";
      const stackPart = e.target.closest?.(".lbStackPart");
      const hasStackBreakdown = Boolean(stackParts || standardStackParts);

      let tooltipRows = `
        <div class="lbTooltipTitle">${escapeHtml(fullLabel)}</div>
      `;

      if (stackPart) {
        const stackSeries = stackPart.dataset.stackSeries || "actual";
        const stackLabel = stackPart.dataset.stackLabel || "-";
        const stackValue = stackPart.dataset.stackValue || "0.0";
        const label = stackSeries === "standard" ? "Standard breakdown" : "Actual breakdown";
        tooltipRows += `<div>${label}: ${escapeHtml(stackLabel)} ${escapeHtml(stackValue)} min</div>`;
        showTooltip(tooltipRows, e.clientX, e.clientY);
        return;
      }

      if (hasStackBreakdown) {
        if (lineBalanceView.showStandard) {
          tooltipRows += `<div>Standard: ${escapeHtml(standard)} min</div>`;
        }

        if (lineBalanceView.showActual) {
          tooltipRows += `<div>Actual: ${escapeHtml(actual)} min</div>`;
        }

        showTooltip(tooltipRows, e.clientX, e.clientY);
        return;
      }

      tooltipRows += `<div>Manpower: ${escapeHtml(manpower)}</div>`;

      if (lineBalanceView.showStandard) {
        tooltipRows += `<div>Standard: ${escapeHtml(standard)} min</div>`;
        if (standardStackParts) {
          tooltipRows += `<div>Standard breakdown: ${escapeHtml(standardStackParts)}</div>`;
        }
      }

      if (lineBalanceView.showActual) {
        tooltipRows += `<div>Actual: ${escapeHtml(actual)} min</div>`;
        if (stackParts) {
          tooltipRows += `<div>Actual breakdown: ${escapeHtml(stackParts)}</div>`;
        }
      }

      if (lineBalanceView.showTotal) {
        tooltipRows += `<div>Total Duration: ${escapeHtml(total)} min</div>`;
      }


      showTooltip(tooltipRows, e.clientX, e.clientY);
    });

    col.addEventListener("mouseleave", hideTooltip);
  });
}

function getProcessMajor(processCode) {
  const match = String(processCode || "").match(/^(\d+)/);
  return match ? Number(match[1]) : 9999;
}

function getPvCombinedGroupKey(seg) {
  const fullLabel = getSegmentProcessLabel(seg);
  const processCode = getProcessCode(fullLabel);
  const major = getProcessMajor(processCode);
  const vesselType = String(seg.vesselType || "").trim().toUpperCase();

  // Process 6, 7, 8, 9:
  // separate Evaporator and Condenser
  if (major >= 6 && major <= 9) {
    if (vesselType === "EVAPORATOR" || vesselType === "CONDENSER") {
      return {
        key: `${vesselType}__${processCode}`,
        label: `${vesselType} ${processCode}`,
        fullLabel: `${vesselType} — ${fullLabel}`,
        sortPrefix: vesselType === "EVAPORATOR" ? 1 : 2
      };
    }
  }

  // Process 10 until 19:
  // group regardless of vessel type
  if (major >= 10 && major <= 19) {
    return {
      key: `ALL__${processCode}`,
      label: processCode,
      fullLabel,
      sortPrefix: 3
    };
  }

  // Other process fallback
  return {
    key: `OTHER__${processCode}`,
    label: processCode,
    fullLabel,
    sortPrefix: 9
  };
}

function getCombinedProcessCode(processCode) {
  const code = String(processCode || "").trim();

  // Group these together although code is different
  if (code === "18,19" || code === "19") {
    return "18,19";
  }

  return code;
}

function getSegmentUnitKey(seg) {
  const chillerSerial =
    seg.chillerSerialNumber ||
    seg.run?.chillerSerialNumber;

  if (chillerSerial) {
    return String(chillerSerial).trim();
  }

  return [
    seg.projectName || "",
    seg.materialNumber || "",
    seg.model || ""
  ].join("__");
}

function addCombinedRow(combinedMap, vessel, row, group, groupIndex) {
  const key = `${groupIndex}__${group.vessels.join("_")}__${group.processes.join("_")}`;
  const label = group.processes.join(",");

  if (!combinedMap.has(key)) {
    combinedMap.set(key, {
      label,
      fullLabel: label,
      actual: 0,
      standard: 0,
      total: 0,
      manpowerSum: 0,
      count: 0,
      parts: new Map(),
      sortPrefix: groupIndex,
      sortKey: getProcessSortKey(label)
    });
  }

  const item = combinedMap.get(key);

  item.actual += Number(row.actual || 0);
  item.standard += Number(row.standard || 0);
  item.total += Number(row.total || 0);
  item.manpowerSum += Number(row.avgManpower || 1);
  item.count++;

  const partKey = vessel || "UNKNOWN";

  if (!item.parts.has(partKey)) {
    item.parts.set(partKey, {
      key: partKey,
      label: formatVesselStackLabel(partKey),
      actual: 0,
      standard: 0,
      total: 0
    });
  }

  const part = item.parts.get(partKey);

  part.actual += Number(row.actual || 0);
  part.standard += Number(row.standard || 0);
  part.total += Number(row.total || 0);
}

function buildPvCombinedFromVesselCharts(pvSegs, averageMode = false) {
  const model = String(pvSegs?.[0]?.model || "").trim();
  const config = getPvCombinedConfig(model);

  if (!config) {
    combinedLineBalanceDebugRows = [];
    return [];
  }

  const vesselMap = groupPvSegmentsByVesselType(pvSegs);
  const combinedMap = new Map();

  const debugRows = [];
  const process13Candidates = []; // Store process 13 inside this temporary array to filter later for largest only

  for (const [vesselType, segs] of vesselMap.entries()) {
    const vesselData = averageMode
      ? buildAverageProcessChartData(segs)
      : buildProcessChartData(segs);

    for (const row of vesselData) {
      const rawProcessCode = getProcessCode(row.fullLabel || row.label);
      if (shouldSkipProcessForCombined(rawProcessCode, model)) continue;
      const processCode = normalizeProcessCodeForCombined(rawProcessCode, model);

      // Check if the process is 10, then put in temporary array to split into 10A and 10B later
      const rowsToAdd = [];

      if (isPv1Model(model) && rawProcessCode === "10") {
        // Take 50% of the actual, standard, and total for 10A
        rowsToAdd.push({
          ...row,
          actual: Number(row.actual || 0) * 0.5,
          standard: Number(row.standard || 0) * 0.5,
          total: Number(row.total || 0) * 0.5,
          processCode: "10A"
        });

        // Take 50% of the actual, standard, and total for 10B
        rowsToAdd.push({
          ...row,
          actual: Number(row.actual || 0) * 0.5,
          standard: Number(row.standard || 0) * 0.5,
          total: Number(row.total || 0) * 0.5,
          processCode: "10B"
        });
      } else {
        rowsToAdd.push({
          ...row,
          processCode
        });
      }
      const vessel = String(vesselType || "").trim().toUpperCase();

      for (const splitRow of rowsToAdd) {
        const finalProcessCode = splitRow.processCode;

        const matched = findCombinedGroup(config, vessel, finalProcessCode);
        if (!matched) continue;

        if (finalProcessCode === "13") {
          process13Candidates.push({
            vessel,
            row: splitRow,
            matched
          });
          continue;
        }

        const { group, groupIndex } = matched;

        debugRows.push({
          model,
          project: splitRow.projectName || "",
          serial: splitRow.serialNumber || "",
          vessel,
          originalProcess: rawProcessCode,
          combinedProcess: finalProcessCode,
          groupLabel: group.processes.join(", "),
          actual: Number(splitRow.actual || 0).toFixed(1),
          standard: Number(splitRow.standard || 0).toFixed(1),
          total: Number(splitRow.total || 0).toFixed(1)
        });

        addCombinedRow(combinedMap, vessel, splitRow, group, groupIndex);
      }
    }
  }

  const evap13 = process13Candidates.find(p => p.vessel === "EVAPORATOR");
  const cond13 = process13Candidates.find(p => p.vessel === "CONDENSER");

  let selected13 = null;

  // Select which process 13 to include in the combined chart based on actual time
  if (evap13 && cond13) {
      selected13 =
          Number(evap13.row.actual) >= Number(cond13.row.actual)
              ? evap13
              : cond13;
  } else {
      selected13 = evap13 || cond13;
  }

  if (selected13) {
    const { vessel, row, matched } = selected13;
    const { group, groupIndex } = matched;

    debugRows.push({
      model,
      project: row.projectName || "",
      serial: row.serialNumber || "",
      vessel,
      originalProcess: "13",
      combinedProcess: "13",
      groupLabel: group.processes.join(", "),
      actual: Number(row.actual || 0).toFixed(1),
      standard: Number(row.standard || 0).toFixed(1),
      total: Number(row.total || 0).toFixed(1)
    });

    addCombinedRow(combinedMap, vessel, row, group, groupIndex);
  }

  combinedLineBalanceDebugRows = debugRows;

  return Array.from(combinedMap.values())
  .sort((a, b) => a.sortPrefix - b.sortPrefix)
  .map(row => ({
    label: row.label,
    fullLabel: row.fullLabel,
    actual: Number(row.actual.toFixed(1)),
    standard: Number(row.standard.toFixed(1)),
    total: Number(row.total.toFixed(1)),
    avgManpower: roundManpower(row.manpowerSum / Math.max(row.count, 1)),
    stackParts: Array.from(row.parts.values()).map(part => ({
      ...part,
      actual: Number(part.actual.toFixed(1)),
      standard: Number(part.standard.toFixed(1)),
      total: Number(part.total.toFixed(1))
    }))
  }));
}

function formatVesselStackLabel(vesselType) {
  const key = String(vesselType || "").toUpperCase();
  if (key === "EVAPORATOR") return "EVAP";
  if (key === "CONDENSER") return "COND";
  if (key === "OIL SEPARATOR") return "OIL";
  if (key === "ECONOMIZER") return "ECO";
  return key || "OTHER";
}

function getVesselStackClass(vesselType) {
  const key = String(vesselType || "").toUpperCase();
  if (key === "EVAPORATOR" || key === "EVAP") return "vessel-evap";
  if (key === "CONDENSER" || key === "COND") return "vessel-cond";
  if (key === "OIL SEPARATOR" || key === "OIL") return "vessel-oil";
  if (key === "ECONOMIZER" || key === "ECO") return "vessel-eco";
  return "vessel-other";
}

function renderSelectedProjectCharts(project) {
  clearCharts();

  const projectSegments = selectedProjectSegments;
  const qrKindView = qrKindViewEl?.value || "CHILLER";

  if (qrKindView === "CHILLER") {
    const chillerSegs = projectSegments.filter(seg =>
      String(seg.qrKind || "").trim() === "CHILLER"
    );

    const data = buildProcessChartData(chillerSegs);
    const mount = createChartCard(
      `${project.projectName || project.chillerSerialNumber} — CHILLER`
    );
    renderCustomLineBalanceChart(mount, data, { taktTime: 450 });
    return;
  }

  
  const pvSegs = projectSegments.filter(seg =>
    String(seg.qrKind || "").trim() === "PV"
  );

  const combinedData = buildPvCombinedFromVesselCharts(pvSegs, false);
  const combinedMount = createChartCard(`${project.projectName || project.chillerSerialNumber} — PV COMBINED`, { showVesselLegend: true });
  renderCustomLineBalanceChart(combinedMount, combinedData, { taktTime: 450, filterVessels: true });

  const vesselMap = groupPvSegmentsByVesselType(pvSegs);

  if (!vesselMap.size) {
    const mount = createChartCard(
      `${project.projectName || project.chillerSerialNumber} — PV`
    );
    mount.innerHTML = `<div class="emptyState">No PV data found for this project.</div>`;
    return;
  }

  const preferredOrder = ["EVAPORATOR", "CONDENSER", "OIL SEPARATOR", "ECONOMIZER"];

  const entries = Array.from(vesselMap.entries()).sort((a, b) => {
    const ai = preferredOrder.indexOf(a[0]);
    const bi = preferredOrder.indexOf(b[0]);

    if (ai === -1 && bi === -1) return a[0].localeCompare(b[0]);
    if (ai === -1) return 1;
    if (bi === -1) return -1;
    return ai - bi;
  });

  for (const [vesselType, segs] of entries) {
    const data = buildProcessChartData(segs);
    const actualVesselClass = getVesselStackClass(vesselType);
    const mount = createChartCard(
      `${project.projectName || project.chillerSerialNumber} — ${vesselType}`,
      { actualVesselClass }
    );
    renderCustomLineBalanceChart(mount, data, {
      taktTime: 450,
      actualVesselClass
    });
  }
}

async function onProjectClick(project) {
  selectedProjectSerial = project.chillerSerialNumber || "";

  if (projectNameEl) {
    projectNameEl.textContent = project.projectName || "-";
  }

  if (chillerSerialEl) {
    chillerSerialEl.textContent = project.chillerSerialNumber || "-";
  }

  renderProjectList(currentProjects);

  
  const runs = await loadRunsForProject(project.chillerSerialNumber);

  const result = buildSegmentsFromRuns(runs);
  
  selectedProjectSegments = Array.isArray(result) ? result : result.segments || [];


  renderSelectedProjectCharts(project);
}

function filterProjects(projects, searchTerm) {
  const q = String(searchTerm || "").trim().toLowerCase();
  if (!q) return Array.isArray(projects) ? projects : [];

  return (Array.isArray(projects) ? projects : []).filter(project => {
    const projectName = String(project.projectName || "").toLowerCase();
    const serial = String(project.chillerSerialNumber || "").toLowerCase();
    const materialNumber = String(project.materialNumber || "").toLowerCase();

    return (
      projectName.includes(q) ||
      serial.includes(q) ||
      materialNumber.includes(q)
    );
  });
}

function renderProjectList(projects) {
  if (!projectListEl) return;

  const filteredProjects = sortProjects(
    filterProjects(projects, projectSearchTerm)
  );

  if (projectCountEl) {
    projectCountEl.textContent = String(filteredProjects.length);
  }

  if (!filteredProjects.length) {
    projectListEl.innerHTML = `<div class="emptyState">No matching projects found.</div>`;
    return;
  }

  projectListEl.innerHTML = filteredProjects.map(project => {
    const activeClass =
      String(project.chillerSerialNumber || "") === String(selectedProjectSerial || "")
        ? " active"
        : "";

    return `
      <div class="projectListItem${activeClass}" data-serial="${escapeHtml(project.chillerSerialNumber)}">
        <div class="projectListTitle">${escapeHtml(project.projectName || "-")}</div>
        <div class="projectListMeta">
          ${escapeHtml(project.model || "-")} | ${escapeHtml(project.chillerSerialNumber || "-")} | ${escapeHtml(project.materialNumber || "-")} | ${escapeHtml(String(project.runCount || 0))} run(s)
        </div>
      </div>
    `;
  }).join("");

  projectListEl.querySelectorAll(".projectListItem").forEach(itemEl => {
    itemEl.addEventListener("click", () => {
      const serial = itemEl.dataset.serial || "";
      const chosen = filteredProjects.find(p =>
        String(p.chillerSerialNumber || "") === String(serial)
      );

      if (chosen) onProjectClick(chosen);
    });
  });

}

async function onModelClick(modelRow) {
  selectedModel = modelRow.model || "";

  if (projectNameEl) {
    projectNameEl.textContent = selectedModel || "-";
  }

  if (chillerSerialEl) {
    chillerSerialEl.textContent = "All serial numbers";
  }

  const filteredModels = getVisibleModels();
  renderModelList(filteredModels);

  const modelProjects = getVisibleModelProjects().filter(project =>
    String(project.model || "").trim() === String(selectedModel || "").trim()
  );


  const runsNested = await Promise.all(
    modelProjects.map(project =>
      loadRunsForProject(project.chillerSerialNumber)
    )
  );

  const modelRuns = runsNested.flat().filter(isRunInModelDateRange);

  const result = buildSegmentsFromRuns(modelRuns);

  selectedProjectSegments =
    Array.isArray(result)
      ? result
      : result.segments || [];

  renderModelCharts(modelRow);
}

// Render charts for the selected model, including combined PV chart and individual vessel charts
function renderModelCharts(modelRow) {
  clearCharts();

  const qrKindView = qrKindViewEl?.value || "PV";

  if (qrKindView === "CHILLER") {
    const chillerSegs = selectedProjectSegments.filter(seg =>
      String(seg.qrKind || "").trim() === "CHILLER"
    );

    const data = buildAverageProcessChartData(chillerSegs);
    const mount = createChartCard(`${modelRow.model} — CHILLER`);

    renderCustomLineBalanceChart(mount, data, { taktTime: 450 });
    return;
  }

  // Filter only PV segments for the model view
  const pvSegs = selectedProjectSegments.filter(seg =>
    String(seg.qrKind || "").trim() === "PV"
  );

  // Build combined PV chart for the model view using averages
  const combinedData = buildPvCombinedFromVesselCharts(pvSegs, true);
  const combinedActualTotal = getCombinedActualTotal(combinedData, true);
  const combinedMount = createChartCard(`${modelRow.model} — PV COMBINED`, {
    showVesselLegend: true,
    summaryText: `Total Actual: ${formatActualDurationSummary(combinedActualTotal)}`
  });

  renderCustomLineBalanceChart(combinedMount, combinedData, { taktTime: 450, filterVessels: true });

  const vesselMap = groupPvSegmentsByVesselType(pvSegs);

  if (!vesselMap.size) {
    const mount = createChartCard(`${modelRow.model} — PV`);
    mount.innerHTML = `<div class="emptyState">No PV data found for this model.</div>`;
    return;
  }

  const preferredOrder = ["EVAPORATOR", "CONDENSER", "OIL SEPARATOR", "ECONOMIZER"];

  const entries = Array.from(vesselMap.entries()).sort((a, b) => {
    const ai = preferredOrder.indexOf(a[0]);
    const bi = preferredOrder.indexOf(b[0]);

    if (ai === -1 && bi === -1) return a[0].localeCompare(b[0]);
    if (ai === -1) return 1;
    if (bi === -1) return -1;
    return ai - bi;
  });

  for (const [vesselType, segs] of entries) {
   const data = buildAverageProcessChartData(segs);
    const actualVesselClass = getVesselStackClass(vesselType);
    const mount = createChartCard(`${modelRow.model} — ${vesselType}`, {
      actualVesselClass
    });

    renderCustomLineBalanceChart(mount, data, {
      taktTime: 450,
      actualVesselClass
    });
  }
}

function renderModelList(models) {
  if (!projectListEl) return;

  const list = Array.isArray(models) ? models : [];

  if (projectCountEl) {
    projectCountEl.textContent = String(list.length);
  }

  if (!list.length) {
    projectListEl.innerHTML = `<div class="emptyState">No models found.</div>`;
    return;
  }

  projectListEl.innerHTML = list.map(modelRow => {
    const activeClass =
      String(modelRow.model || "") === String(selectedModel || "")
        ? " active"
        : "";

    return `
      <div class="projectListItem${activeClass}" data-model="${escapeHtml(modelRow.model)}">
        <div class="projectListTitle">${escapeHtml(modelRow.model || "-")}</div>
        <div class="projectListMeta">
          ${escapeHtml(String(modelRow.runCount || 0))} run(s)
        </div>
      </div>
    `;
  }).join("");

  projectListEl.querySelectorAll(".projectListItem").forEach(itemEl => {
    itemEl.addEventListener("click", () => {
      const model = itemEl.dataset.model || "";

      const chosen = list.find(row =>
        String(row.model || "") === String(model)
      );

      if (chosen) {
        onModelClick(chosen);
      }
    });
  });
}

function getVisibleModelProjects() {
  return currentProjects.filter(isProjectInModelDateRange);
}

function getVisibleModels() {
  return buildModelsFromProjects(getVisibleModelProjects());
}

function buildModelsFromProjects(projects) {

  const map = new Map();

  for (const project of projects) {

    const model = String(project.model || "").trim();

    if (!model) continue;

    if (!map.has(model)) {
      map.set(model, {
        model,
        runCount: 0,
        projectCount: 0
      });
    }

    const row = map.get(model);

    row.projectCount++;

    row.runCount += Number(project.runCount || 0);
  }

  return Array.from(map.values())
    .sort((a, b) => a.model.localeCompare(b.model));
}

async function renderPage() {
  const rawHeaders = await loadProjectHeadersFallbackFromRuns();

  currentProjects = normalizeProjectHeaders(rawHeaders);

    const allRunsNested = await Promise.all(
      currentProjects.map(project =>
        loadRunsForProject(project.chillerSerialNumber)
      )
    );

    const allRuns = allRunsNested.flat();

    const allSegmentsResult = buildSegmentsFromRuns(allRuns);

    allSegmentsCache = Array.isArray(allSegmentsResult)
      ? allSegmentsResult
      : allSegmentsResult.segments || [];

    historicalStandardsByModelProcess =
      buildSharedHistoricalStandardsByModelProcess(allSegmentsCache);

  applyModelDateBounds(currentProjects);
  currentModels = getVisibleModels();

  if (!currentProjects.length) {
    if (projectNameEl) projectNameEl.textContent = "-";
    if (chillerSerialEl) chillerSerialEl.textContent = "-";
    clearCharts();
    return;
  }

  if (lineBalanceMode === "PROJECT") {
    renderProjectList(currentProjects);

    const stillExists = currentProjects.find(
      p => String(p.chillerSerialNumber || "") === String(selectedProjectSerial || "")
    );

    const projectToShow = stillExists || currentProjects[0];

    await onProjectClick(projectToShow);
  } else {
    currentModels = getVisibleModels();
    renderModelList(currentModels);

    const stillExists = currentModels.find(
      m => String(m.model || "") === String(selectedModel || "")
    );

    const modelToShow = stillExists || currentModels[0];

    if (modelToShow) {
      await onModelClick(modelToShow);
    }
  }
}



qrKindViewEl?.addEventListener("change", () => {
  if (lineBalanceMode === "MODEL") {
    const activeModel = currentModels.find(
      m => String(m.model || "") === String(selectedModel || "")
    );

    if (activeModel) {
      renderModelCharts(activeModel);
    }

    return;
  }

  const activeProject = currentProjects.find(
    p => String(p.chillerSerialNumber || "") === String(selectedProjectSerial || "")
  );

  if (activeProject) {
    renderSelectedProjectCharts(activeProject);
  }
});

projectSearchClearEl?.addEventListener("click", () => {
  projectSearchTerm = "";

  if (projectSearchEl) {
    projectSearchEl.value = "";
    projectSearchEl.focus();
  }

  updateSearchClearVisibility();  
  if (lineBalanceMode === "MODEL") {
    currentModels = getVisibleModels();
    renderModelList(currentModels);
  } else {
    renderProjectList(currentProjects);
  }
});

projectSearchEl?.addEventListener("input", () => {
  projectSearchTerm = projectSearchEl.value || "";

  updateSearchClearVisibility(); 
  if (lineBalanceMode === "MODEL") {
    currentModels = getVisibleModels();
    renderModelList(currentModels);
  } else {
    renderProjectList(currentProjects);
  }
});

projectSortEl?.addEventListener("click", () => {
  if (!projectSortMenuEl) return;

  const willOpen = projectSortMenuEl.hidden;
  projectSortMenuEl.hidden = !willOpen;
  projectSortEl.setAttribute("aria-expanded", String(willOpen));
  projectSortEl.classList.toggle("active", willOpen);
});

projectSortMenuEl?.querySelectorAll("[data-sort]").forEach(button => {
  button.addEventListener("click", () => {
    projectSortMode = button.dataset.sort || "latest";
    projectSortMenuEl.hidden = true;
    projectSortEl?.setAttribute("aria-expanded", "false");
    projectSortEl?.classList.remove("active");

    if (lineBalanceMode === "MODEL") {
      currentModels = getVisibleModels();
      renderModelList(currentModels);
    } else {
      renderProjectList(currentProjects);
    }
  });
});

document.addEventListener("click", event => {
  if (
    !projectSortMenuEl ||
    !projectSortEl ||
    projectSortMenuEl.hidden ||
    event.target.closest(".filterSortWrap")
  ) {
    return;
  }

  projectSortMenuEl.hidden = true;
  projectSortEl.setAttribute("aria-expanded", "false");
  projectSortEl.classList.remove("active");
});

modeViewEl?.addEventListener("change", () => {
  lineBalanceMode = modeViewEl.value || "PROJECT";
  modelDateFrom = modelDateFromEl?.value || "";
  modelDateTo = modelDateToEl?.value || "";

  selectedProjectSerial = "";
  selectedModel = ""; // important

  document.querySelector(".sectionTitle").textContent =
    lineBalanceMode === "PROJECT" ? "All Projects" : "All Models";

  updateToolbarModeUi();

  renderPage().catch(console.error);
});

async function handleModelDateChange() {
  modelDateFrom = modelDateFromEl?.value || "";
  modelDateTo = modelDateToEl?.value || "";

  if (lineBalanceMode !== "MODEL") return;

  try {
    setModelDateControlsLoading(true);
    renderModelFilterLoading();

    currentModels = getVisibleModels();

    const stillExists = currentModels.find(
      m => String(m.model || "") === String(selectedModel || "")
    );

    const modelToShow = stillExists || currentModels[0];

    if (modelToShow) {
      await onModelClick(modelToShow);
    } else {
      selectedModel = "";
      renderModelList(currentModels);
      if (projectNameEl) projectNameEl.textContent = "-";
      if (chillerSerialEl) chillerSerialEl.textContent = "-";
      clearCharts();
    }
  } finally {
    setModelDateControlsLoading(false);
  }
}

modelDateFromEl?.addEventListener("change", () => {
  handleModelDateChange().catch(console.error);
});

modelDateToEl?.addEventListener("change", () => {
  handleModelDateChange().catch(console.error);
});

document.getElementById("exportStandardRawBtn")?.addEventListener("click", () => {
  exportLineBalanceStandardRawData(allSegmentsCache, {
    fromDate: STANDARD_BASELINE_FROM,
    toDate: STANDARD_BASELINE_TO,
    factor: STANDARD_FACTOR
  });
});

document.getElementById("exportCombinedRawBtn")?.addEventListener("click", () => {
    exportCombinedLineBalanceRawData(combinedLineBalanceDebugRows, {
        model: selectedModel || projectNameEl?.textContent || "Selected"
    });
});

updateToolbarModeUi();
updateSearchClearVisibility();
renderPage().catch(console.error);

