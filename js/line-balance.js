import {
  buildSegmentsFromRuns,
  getActualEffectiveDurationMs,
  getStandardMinutes,
  getProcessCode,
} from "./helpers.js";

import { loadProjectHeadersFallbackFromRuns, loadRunsForProject } from "./timeline.js";

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

let lineBalanceView = {
  showStandard: true, // default on
  showActual: true,   // default on
  showTotal: false    // default off
};

let lineBalanceMetric = "DURATION"; 
// DURATION = minutes
// MANHOUR = man-minutes

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

// convert minutes to man-minutes using the aggregate manpower value
function convertByMetric(minutes, manpower = 1) {
  if (lineBalanceMetric === "MANHOUR") {
    return minutes * manpower;
  }

  return minutes;
}

function getMetricUnitLabel() {
  return lineBalanceMetric === "MANHOUR" ? "Man-minutes" : "Duration (mins)";
}

function getMetricToggleLabel() {
  return lineBalanceMetric === "MANHOUR" ? "View: Man-minutes" : "View: Duration";
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

function getSegmentProcessLabel(seg) {
  return String(seg.processLabel || seg.processName || "").trim() || "Unknown";
}

function getProcessSortKey(processName = "") {
  const code = getProcessCode(processName);
  const first = String(code || "").split(",")[0].trim();
  const m = first.match(/^(\d+)([A-Z]?)/i);

  if (!m) {
    return { major: 9999, suffix: "" };
  }

  return {
    major: Number(m[1]),
    suffix: (m[2] || "").toUpperCase()
  };
}

function getProcessDisplayName(processName = "") {
  const label = String(processName || "").trim();
  return label.replace(/^.+?\s*-\s*/, "").trim() || label;
}

function compareProcessSortKey(a, b) {
  if ((a?.major ?? 9999) !== (b?.major ?? 9999)) {
    return (a?.major ?? 9999) - (b?.major ?? 9999);
  }
  return (a?.suffix || "").localeCompare(b?.suffix || "");
}

function buildAverageProcessChartData(segments, denominator = null) {
  const processMap = new Map();

  for (const seg of segments) {
    if (seg.phase === "waiting" || seg.status === "waiting") continue;

    const fullLabel = getSegmentProcessLabel(seg);
    const processCode = getProcessCode(fullLabel);

    const actualMin = getActualEffectiveDurationMs(seg) / 60000;
    const totalMin = getTotalDurationMs(seg) / 60000;
    const standardMin = getStandardMinutes({
      processLabel: seg.processLabel,
      model: seg.model,
      qrKind: seg.qrKind,
      vesselType: seg.vesselType || "ALL"
    });

    if (!processMap.has(processCode)) {
      processMap.set(processCode, {
        label: processCode,
        fullLabel,
        actualSum: 0,
        totalSum: 0,
        standardSum: 0,
        manpowerSum: 0,
        count: 0,
        sortKey: getProcessSortKey(fullLabel)
      });
    }

    const row = processMap.get(processCode);
    const manpower = getSegmentManpower(seg);

    row.actualSum += actualMin;
    row.totalSum += totalMin;
    row.standardSum += standardMin;
    row.manpowerSum += manpower;
    row.count++;
  }
  return Array.from(processMap.values())
    .sort((a, b) => compareProcessSortKey(a.sortKey, b.sortKey))
    .map(row => {
      const divisor = Number(denominator || row.count || 1);
      const avgManpower = roundManpower(row.manpowerSum / row.count);
      const actual = row.actualSum / divisor;
      const total = row.totalSum / divisor;
      const standard = row.standardSum / divisor;

      return {
        label: getProcessDisplayName(row.fullLabel),
        fullLabel: row.fullLabel,
        actual: Number(convertByMetric(actual, avgManpower).toFixed(1)),
        total: Number(convertByMetric(total, avgManpower).toFixed(1)),
        standard: Number(convertByMetric(standard, avgManpower).toFixed(1)),
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

  for (const seg of segments) {
    if (seg.phase === "waiting" || seg.status === "waiting") continue;

    const fullLabel = getSegmentProcessLabel(seg);
    const processCode = getProcessCode(fullLabel);

    const actualMin = getActualEffectiveDurationMs(seg) / 60000;
    const totalMin = getTotalDurationMs(seg) / 60000;
    const standardMin = getStandardMinutes({
      processLabel: seg.processLabel,
      model: seg.model,
      qrKind: seg.qrKind,
      vesselType: seg.vesselType || "ALL"
    });

    if (!processMap.has(processCode)) {
      processMap.set(processCode, {
        label: processCode,
        fullLabel,
        actualMin: 0,
        totalMin: 0,
        standardMin: 0,
        manpowerSum: 0,
        segmentCount: 0,
        sortKey: getProcessSortKey(fullLabel)
      });
    }

    const row = processMap.get(processCode);

    const manpower = getSegmentManpower(seg);

    row.actualMin += actualMin;
    row.totalMin += totalMin;
    row.standardMin += standardMin;

    row.manpowerSum += manpower;
    row.segmentCount++;
  }

  return Array.from(processMap.values())
    .sort((a, b) => compareProcessSortKey(a.sortKey, b.sortKey))
    .map(item => {
      const avgManpower = roundManpower(item.manpowerSum / item.segmentCount);

      return {
        label: getProcessDisplayName(item.fullLabel || item.label),
        fullLabel: item.fullLabel,
        actual: Number(convertByMetric(item.actualMin, avgManpower).toFixed(1)),
        total: Number(convertByMetric(item.totalMin, avgManpower).toFixed(1)),
        standard: Number(convertByMetric(item.standardMin, avgManpower).toFixed(1)),
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
  if (chartsContainerEl) {
    chartsContainerEl.innerHTML = "";
    chartsContainerEl.scrollTop = 0;
  }
}

function createChartCard(titleText) {
  const vesselTitle = ["CHILLER", "EVAPORATOR", "CONDENSER", "OIL SEPARATOR", "ECONOMIZER"]
    .find(type => String(titleText || "").includes(type));
  const displayTitle = vesselTitle || titleText;

  const wrap = document.createElement("div");
  wrap.className = "chartCard";

  wrap.innerHTML = `
    <div class="lbChartTitle">${escapeHtml(displayTitle)}</div>

    <div class="lbLegend">
      <label class="lbLegendItem">
        <input type="checkbox" class="lbToggleStandard" ${lineBalanceView.showStandard ? "checked" : ""}>
        <span class="lbLegendSwatch standard"></span>
        Standard Time
      </label>

      <label class="lbLegendItem">
        <input type="checkbox" class="lbToggleActual" ${lineBalanceView.showActual ? "checked" : ""}>
        <span class="lbLegendSwatch actual"></span>
        Actual Time
      </label>

      <label class="lbLegendItem">
        <input type="checkbox" class="lbToggleTotal" ${lineBalanceView.showTotal ? "checked" : ""}>
        <span class="lbLegendSwatch total"></span>
        Total Duration
      </label>

      <label class="lbLegendItem">
        <input type="checkbox" class="lbToggleMetric" ${lineBalanceMetric === "MANHOUR" ? "checked" : ""}>
        <span>${getMetricToggleLabel()}</span>
      </label>

      <span class="lbLegendItem">
        <span class="lbLegendLine"></span>
        Takt Time (450 min)
      </span>
    </div>

    <div class="lbChartMount"></div>
  `;

  const standardToggle = wrap.querySelector(".lbToggleStandard");
  const actualToggle = wrap.querySelector(".lbToggleActual");
  const totalToggle = wrap.querySelector(".lbToggleTotal");
  const metricToggle = wrap.querySelector(".lbToggleMetric");

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

  metricToggle?.addEventListener("change", () => {
    lineBalanceMetric = metricToggle.checked ? "MANHOUR" : "DURATION";
    rerenderActiveChart();
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

  const visibleSeries = [];
  if (lineBalanceView.showStandard) visibleSeries.push("standard");
  if (lineBalanceView.showActual) visibleSeries.push("actual");
  if (lineBalanceView.showTotal) visibleSeries.push("total");

  const rawMax = Math.max(
    takt,
    ...data.flatMap(d => [
      lineBalanceView.showStandard ? Number(d.standard || 0) : 0,
      lineBalanceView.showActual ? Number(d.actual || 0) : 0,
      lineBalanceView.showTotal ? Number(d.total || 0) : 0
    ])
  );

  const chartMax = Math.max(500, Math.ceil(rawMax / 50) * 50);
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

  const colsHtml = data.map((d, idx) => {
    const standardPct = (Number(d.standard || 0) / chartMax) * 100;
    const actualPct = (Number(d.actual || 0) / chartMax) * 100;
    const totalPct = (Number(d.total || 0) / chartMax) * 100;

    const standardValueClass = standardPct > 94 ? " inside" : "";
    const actualValueClass = actualPct > 94 ? " inside" : "";
    const totalValueClass = totalPct > 94 ? " inside" : "";

    let barsHtml = "";

    if (lineBalanceView.showStandard) {
      barsHtml += `
        <div class="lbBar standard" style="height:${standardPct}%">
          <span class="lbBarValue${standardValueClass}">${Number(d.standard || 0).toFixed(0)}</span>
        </div>
      `;
    }

    if (lineBalanceView.showActual) {
      barsHtml += `
        <div class="lbBar actual" style="height:${actualPct}%">
          <span class="lbBarValue${actualValueClass}">${Number(d.actual || 0).toFixed(0)}</span>
        </div>
      `;
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
    <div class="lbCustomChart">
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
              <span class="lbTaktLabel">450 min</span>
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
      const manpower = col.dataset.manpower || "1";

      let tooltipRows = `
        <div class="lbTooltipTitle">${escapeHtml(fullLabel)}</div>
      `;

      tooltipRows += `<div>Manpower: ${escapeHtml(manpower)}</div>`;

      if (lineBalanceView.showStandard) {
        tooltipRows += `<div>Standard: ${escapeHtml(standard)} ${lineBalanceMetric === "MANHOUR" ? "man-min" : "min"}</div>`;
      }

      if (lineBalanceView.showActual) {
        tooltipRows += `<div>Actual: ${escapeHtml(actual)} ${lineBalanceMetric === "MANHOUR" ? "man-min" : "min"}</div>`;
      }

      if (lineBalanceView.showTotal) {
        tooltipRows += `<div>Total Duration: ${escapeHtml(total)} ${lineBalanceMetric === "MANHOUR" ? "man-min" : "min"}</div>`;
      }


      showTooltip(tooltipRows, e.clientX, e.clientY);
    });

    col.addEventListener("mouseleave", hideTooltip);
  });
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
    const mount = createChartCard(
      `${project.projectName || project.chillerSerialNumber} — ${vesselType}`
    );
    renderCustomLineBalanceChart(mount, data, { taktTime: 450 });
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

function renderModelCharts(modelRow) {
  clearCharts();

  const qrKindView = qrKindViewEl?.value || "PV";

  if (qrKindView === "CHILLER") {
    const chillerSegs = selectedProjectSegments.filter(seg =>
      String(seg.qrKind || "").trim() === "CHILLER"
    );

    const data = buildAverageProcessChartData(chillerSegs, modelRow.projectCount);
    const mount = createChartCard(`${modelRow.model} — CHILLER`);

    renderCustomLineBalanceChart(mount, data, { taktTime: 450 });
    return;
  }

  const pvSegs = selectedProjectSegments.filter(seg =>
    String(seg.qrKind || "").trim() === "PV"
  );

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
   const data = buildAverageProcessChartData(segs, modelRow.projectCount);
    const mount = createChartCard(`${modelRow.model} — ${vesselType}`);

    renderCustomLineBalanceChart(mount, data, { taktTime: 450 });
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

updateToolbarModeUi();
updateSearchClearVisibility();
renderPage().catch(console.error);

