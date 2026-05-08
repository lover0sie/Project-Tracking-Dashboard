import {
  buildSegmentsFromRuns,
  getActualEffectiveDurationMs,
  getStandardMinutesFromLabel,
  getProcessCode
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

let lineBalanceView = {
  showStandard: true, // default on
  showActual: true,   // default on
  showTotal: false    // default off
};

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
}


function getTotalDurationMs(seg) {
  const startMs = seg?.start instanceof Date ? seg.start.getTime() : null;
  const endMs = seg?.end instanceof Date ? seg.end.getTime() : null;

  if (startMs == null || endMs == null) return 0;
  return Math.max(0, endMs - startMs);
}

function normalizeProjectHeaders(rows) {
  return (Array.isArray(rows) ? rows : [])
    .map(row => ({
      chillerSerialNumber: String(row.chillerSerialNumber || row.id || "").trim(),
      projectName: row.projectName || "-",
      materialNumber: row.materialNumber || "-",
      model: row.model || "-",
      runCount: Number(row.runCount || 0),
      qrKinds: Array.isArray(row.qrKinds) ? row.qrKinds : [],

      latestStart: Number(row.latestStart || 0),
      firstStart: Number(row.firstStart || 0)
    }))
    .filter(row => row.chillerSerialNumber);
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

function compareProcessSortKey(a, b) {
  if ((a?.major ?? 9999) !== (b?.major ?? 9999)) {
    return (a?.major ?? 9999) - (b?.major ?? 9999);
  }
  return (a?.suffix || "").localeCompare(b?.suffix || "");
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
    const standardMin = getStandardMinutesFromLabel(fullLabel) || 0;

    if (!processMap.has(processCode)) {
      processMap.set(processCode, {
        label: processCode,
        fullLabel,
        actualMin: 0,
        totalMin: 0,
        standardMin: 0,
        sortKey: getProcessSortKey(fullLabel)
      });
    }

    const row = processMap.get(processCode);
    row.actualMin += actualMin;
    row.totalMin += totalMin;
    row.standardMin += standardMin;
  }

  return Array.from(processMap.values())
    .sort((a, b) => compareProcessSortKey(a.sortKey, b.sortKey))
    .map(item => ({
      label: item.label,
      fullLabel: item.fullLabel,
      actual: Number(item.actualMin.toFixed(1)),
      total: Number(item.totalMin.toFixed(1)),
      standard: Number(item.standardMin.toFixed(1))
    }));
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

  function rerenderActiveProject() {
    const activeProject = currentProjects.find(
      p => String(p.chillerSerialNumber || "") === String(selectedProjectSerial || "")
    );
    if (activeProject) {
      renderSelectedProjectCharts(activeProject);
    }
  }

  standardToggle?.addEventListener("change", () => {
    lineBalanceView.showStandard = standardToggle.checked;
    rerenderActiveProject();
  });

  actualToggle?.addEventListener("change", () => {
    lineBalanceView.showActual = actualToggle.checked;
    rerenderActiveProject();
  });

  totalToggle?.addEventListener("change", () => {
    lineBalanceView.showTotal = totalToggle.checked;
    rerenderActiveProject();
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
          data-total="${Number(d.total || 0).toFixed(1)}">
        
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
        <div class="lbYAxisTitle">Duration (mins)</div>
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

      <div class="lbXAxisTitle">Process No.</div>
    </div>
  `;

  container.querySelectorAll(".lbCol").forEach(col => {
    col.addEventListener("mousemove", e => {
      const fullLabel = col.dataset.fullLabel || col.dataset.label || "-";
      const actual = col.dataset.actual || "0.0";
      const standard = col.dataset.standard || "0.0";
      const total = col.dataset.total || "0.0";

      let tooltipRows = `<div class="lbTooltipTitle">${escapeHtml(fullLabel)}</div>`;

      if (lineBalanceView.showStandard) {
        tooltipRows += `<div>Standard Time: ${escapeHtml(standard)} min</div>`;
      }

      if (lineBalanceView.showActual) {
        tooltipRows += `<div>Actual Time: ${escapeHtml(actual)} min</div>`;
      }

      if (lineBalanceView.showTotal) {
        tooltipRows += `<div>Total Duration: ${escapeHtml(total)} min</div>`;
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

  renderModelList(currentModels);

  const modelProjects = currentProjects.filter(project =>
    String(project.model || "").trim() === String(selectedModel || "").trim()
  );

  const runsNested = await Promise.all(
    modelProjects.map(project =>
      loadRunsForProject(project.chillerSerialNumber)
    )
  );

  const modelRuns = runsNested.flat();

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

    const data = buildProcessChartData(chillerSegs);
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
    const data = buildProcessChartData(segs);
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
  currentModels = buildModelsFromProjects(currentProjects);

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
    renderModelList(currentModels);

    const stillExists = currentModels.find(
      m => String(m.model || "") === String(selectedModel || "")
    );

    const modelToShow = stillExists || currentModels[0];

    if (modelToShow) {
      await onModelClick(modelToShow);
    }
  }

  console.log("currentProjects", currentProjects);
  console.log("currentModels", currentModels);
}



qrKindViewEl?.addEventListener("change", () => {
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
  renderProjectList(currentProjects);
});

projectSearchEl?.addEventListener("input", () => {
  projectSearchTerm = projectSearchEl.value || "";

  updateSearchClearVisibility(); 
  renderProjectList(currentProjects);
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
    renderProjectList(currentProjects);
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

  document.querySelector(".sectionTitle").textContent =
    lineBalanceMode === "PROJECT" ? "All Projects" : "All Models";

  updateToolbarModeUi();

  renderPage().catch(console.error);
});


updateToolbarModeUi();
updateSearchClearVisibility();
renderPage().catch(console.error);

