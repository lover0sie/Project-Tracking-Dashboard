import { loadRuns } from "./timeline.js";
import {
  buildSegmentsFromRuns,
  getActualEffectiveDurationMs,
  getStandardMinutesFromLabel,
  getProcessCode
} from "./helpers.js";

const projectNameEl = document.getElementById("lbProjectName");
const chillerSerialEl = document.getElementById("lbChillerSerial");
const projectListEl = document.getElementById("lbProjectList");
const projectCountEl = document.getElementById("lbProjectCount");
const qrKindViewEl = document.getElementById("lbQrKindView");
const chartsContainerEl = document.getElementById("lineBalanceCharts");

let selectedProjectSerial = "";
let currentProjects = [];
let allRunsCache = [];
let allSegmentsCache = [];
let lineBalanceCharts = [];

/* Change the station display name for Pneumatic */
function getStationDisplayName(station = "") {
  const map = {
    "Pneumatic": "Paint Booth and Testing"
  };

  return map[station] || station;
}

/* Get the process label for each segment and return string with no space */
function getSegmentProcessLabel(seg) {
  return String(seg.processLabel || seg.processName || "").trim() || "Unknown";
}

/* Replace all the chraracter symbol */
function escapeHtml(str = "") {
  return String(str)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

/* Get month of the date in year-month */
function getDefaultMonthValue() {
  const now = new Date();
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, "0");
  return `${y}-${m}`;
}


function getProcessSortKey(processName = "") {

  // Regex matching where d+ represents one or more digits as the major number, and the string A-Z as the suffix
  // i represents case insensitive
  const m = String(processName).match(/^(\d+)([A-Z]?)/i);

  // If not matched, assign a major number (e.g. process ABC returns 9999)
  if (!m) {
    return { major: 9999, suffix: "" };
  }

  return {
    major: Number(m[1]),
    suffix: (m[2] || "").toUpperCase()
  };
}


/* Compare the major number and sort */
function compareProcessSortKey(a, b) {
  if ((a?.major ?? 9999) !== (b?.major ?? 9999)) {
    return (a?.major ?? 9999) - (b?.major ?? 9999);
  }
  return (a?.suffix || "").localeCompare(b?.suffix || "");
}

/* Filter segments according the scope. In this case, the scope is the project */
function filterSegmentsByScope(segments, scope, target) {

  // If the scope is project, then return segments match to the project name 
  if (scope === "project") {
    return segments.filter(seg =>
      String(seg.chillerSerialNumber || "").trim() === String(target || "").trim()
    );
  }

  // If the scope is model, then return segments match to the model 
  if (scope === "model") {
    return segments.filter(seg =>
      String(seg.model || "").trim() === String(target || "").trim()
    );
  }

  return [];
}

/* Group segments under PV to vesselType */
function groupPvSegmentsByVesselType(segments) {
  const map = new Map();

  for (const seg of segments) {
    const vesselType = String(seg.vesselType || "").trim();
    if (!vesselType) continue;

    // Map if the segment has a vesselType
    if (!map.has(vesselType)) {
      map.set(vesselType, []);
    }

    // Push the vessel type of the segment into map
    map.get(vesselType).push(seg);
  }

  return map;
}

/* Get the project segments by filtering according to the chillerSerialNumber */
function getProjectSegments(segments, chillerSerialNumber) {
  return segments.filter(seg =>
    String(seg.chillerSerialNumber || "").trim() === String(chillerSerialNumber || "").trim()
  );
}

/* Build the Projects array that mapped of item based on qrKinds (PV, CHILLER) to get data, store in array, and sort */
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
        qrKinds: new Set()
      });
    }

    const row = map.get(serial);
    row.runCount += 1;

    if (run.qrKind) {
      row.qrKinds.add(String(run.qrKind).trim());
    }
  }

  return Array.from(map.values())
    .map(item => ({
      ...item,
      qrKinds: Array.from(item.qrKinds)
    }))
    .sort((a, b) =>
      String(a.projectName || "").localeCompare(String(b.projectName || ""))
    );
}

/* Build the ProcessChartData array that mapped based on its process code that consist of label, full label, standard and actual time */
function buildProcessChartData(segments) {
  const processMap = new Map();

  for (const seg of segments) {
    if (seg.phase === "waiting" || seg.status === "waiting") continue;

    const fullLabel = getSegmentProcessLabel(seg);
    const processCode = getProcessCode(fullLabel);
    const actualMin = getActualEffectiveDurationMs(seg) / 60000;
    const standardMin = getStandardMinutesFromLabel(fullLabel) || 0;

    if (!processMap.has(processCode)) {
      processMap.set(processCode, {
        label: processCode,
        fullLabel,
        actualMin: 0,
        standardMin: 0,
        sortKey: getProcessSortKey(fullLabel)
      });
    }

    const row = processMap.get(processCode);
    row.actualMin += actualMin;
    row.standardMin += standardMin;
  }

  return Array.from(processMap.values())
    .sort((a, b) => compareProcessSortKey(a.sortKey, b.sortKey))
    .map(item => ({
      label: item.label,
      fullLabel: item.fullLabel,
      actual: Number(item.actualMin.toFixed(1)),
      standard: Number(item.standardMin.toFixed(1)),
      takt: 450
    }));
}


function buildProjectsForMonth(runs) {
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
        runCount: 0
      });
    }

    const row = map.get(serial);
    row.runCount += 1;
  }

  return Array.from(map.values()).sort((a, b) =>
    String(a.projectName || "").localeCompare(String(b.projectName || ""))
  );
}

function buildModelsForMonth(runs) {
  const map = new Map();

  for (const run of runs) {
    const model = String(run.model || "").trim();
    if (!model) continue;

    if (!map.has(model)) {
      map.set(model, {
        model,
        projectCountSet: new Set(),
        runCount: 0
      });
    }

    const row = map.get(model);
    row.runCount += 1;

    const serial = String(run.chillerSerialNumber || "").trim();
    if (serial) row.projectCountSet.add(serial);
  }

  return Array.from(map.values())
    .map(item => ({
      model: item.model,
      projectCount: item.projectCountSet.size,
      runCount: item.runCount
    }))
    .sort((a, b) => String(a.model).localeCompare(String(b.model)));
}

function buildLineBalanceByLine(segments, scope, target) {
  const filtered = filterSegmentsByScope(segments, scope, target).filter(seg =>
    seg.phase !== "waiting" &&
    seg.status !== "waiting"
  );

  const stationMap = new Map();

  for (const seg of filtered) {
    const rawStation = String(seg.station || "Unknown").trim();
    const stationLabel = getStationDisplayName(rawStation);
    const processLabel = getSegmentProcessLabel(seg);

    const actualMin = getActualEffectiveDurationMs(seg) / 60000;
    const totalMin = getTotalDurationMs(seg) / 60000;
    const standardMin = getStandardMinutesFromLabel(processLabel) || 0;

    if (!stationMap.has(rawStation)) {
      stationMap.set(rawStation, {
        label: stationLabel,
        actualMin: 0,
        totalMin: 0,
        standardMin: 0,
        sortKey: getProcessSortKey(processLabel)
      });
    }

    const row = stationMap.get(rawStation);
    row.actualMin += actualMin;
    row.totalMin += totalMin;
    row.standardMin += standardMin;

    const currentSort = getProcessSortKey(processLabel);
    if (compareProcessSortKey(currentSort, row.sortKey) < 0) {
      row.sortKey = currentSort;
    }
  }

  return Array.from(stationMap.values())
    .sort((a, b) => compareProcessSortKey(a.sortKey, b.sortKey))
    .map(item => ({
      label: item.label,
      actual: Number(item.actualMin.toFixed(1)),
      total: Number(item.totalMin.toFixed(1)),
      standard: Number(item.standardMin.toFixed(1))
    }));
}

function buildLineBalanceByProcess(segments, scope, target) {
  const filtered = filterSegmentsByScope(segments, scope, target).filter(seg =>
    seg.phase !== "waiting" &&
    seg.status !== "waiting"
  );

  const processMap = new Map();

  for (const seg of filtered) {
    const fullLabel = getSegmentProcessLabel(seg);
    const processCode = getProcessCode(fullLabel);
    const actualMin = getActualEffectiveDurationMs(seg) / 60000;
    const totalMin = getTotalDurationMs(seg) / 60000;
    const standardMin = getStandardMinutesFromLabel(fullLabel) || 0;

    if (!processMap.has(processCode)) {
      processMap.set(processCode, {
        code: processCode,
        fullLabel: fullLabel || processCode,
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
      label: item.code,
      fullLabel: item.fullLabel,
      actual: Number(item.actualMin.toFixed(1)),
      total: Number(item.totalMin.toFixed(1)),
      standard: Number(item.standardMin.toFixed(1))
    }));
}


function renderLineBalanceChartByMode(data, item, mode, scope) {
  if (!chartEl) return;

  if (lineBalanceChart) {
    lineBalanceChart.destroy();
    lineBalanceChart = null;
  }

  if (!Array.isArray(data) || !data.length) {
    return;
  }

  const modeTitleMap = {
  process: "By Process",
  line: "By Line"
};

const scopeTitle =
  scope === "model"
    ? (item.model || "-")
    : (item.projectName || item.chillerSerialNumber || "-");

  lineBalanceChart = new Chart(chartEl, {
    type: "bar",
    data: {
      labels: data.map(d => d.label),
      datasets: [
        {
          label: "Standard Time",
          data: data.map(d => d.standard),
          backgroundColor: "#56493c",
          borderColor: "#56493c",
          borderWidth: 1
        },
        {
          label: "Actual Time",
          data: data.map(d => d.actual),
          backgroundColor: "#60a5fa",
          borderColor: "#60a5fa",
          borderWidth: 1
        },
        {
          label: "Total Duration",
          data: data.map(d => d.total),
          backgroundColor: "#9ca3af",
          borderColor: "#9ca3af",
          borderWidth: 1,
          hidden: true
        },
        {
          type: "line",
          label: "Takt Time",
          data: new Array(data.length).fill(450),  // flat line
          borderColor: "rgba(239, 68, 68, 0.7)",
          backgroundColor: "#ef4444",
          borderWidth: 2,
          borderDash: [6, 6],
          pointRadius: 0,          
          pointHoverRadius: 0,
          fill: false,
          tension: 0,              
          spanGaps: true,
          order: 1
        }
      ]
    },
    options: {
      responsive: true,
      maintainAspectRatio: true,
      aspectRatio: 3,   // width : height,
      interaction: {
        mode: "index",
        intersect: false
      },
      layout: {
        padding: {
          top: 5,
          bottom: 5,
          left: 5,
          right: 5
        }
      },
      plugins: {
        title: {
          display: true,
          text: `Line Balance ${modeTitleMap[mode] || ""} - ${scopeTitle}`
        },
        legend: {
          display: true,
          position: "top",
          boxWidth: 10,
          font: {
          size: 10
          },
          onClick(e, legendItem, legend) {
            const chart = legend.chart;
            const index = legendItem.datasetIndex;

            chart.setDatasetVisibility(index, !chart.isDatasetVisible(index));
            chart.update();
          }
          
        },
        tooltip: {
          callbacks: {
            title(items) {
              const idx = items?.[0]?.dataIndex ?? 0;
              return data[idx]?.fullLabel || data[idx]?.label || items?.[0]?.label || "";
            },
            label(ctx) {
              return `${ctx.dataset.label}: ${Number(ctx.parsed.y).toFixed(1)} min`;
            }
          }
        }
      },
      scales: {
        x: {
          title: {
            display: true,
            text: "Process",
            size: 10
          }
        },
        y: {
          beginAtZero: true,
          title: {
            display: true,
            text: "Duration (minutes)",
            size: 10
          }
        }
      }
    }
  });
}

function renderProcessChart(canvasEl, data, titleText) {
  if (!canvasEl || !Array.isArray(data) || !data.length) return null;

  return new Chart(canvasEl, {
    data: {
      labels: data.map(d => d.label),
      datasets: [
        {
          type: "bar",
          label: "Standard Time",
          data: data.map(d => d.standard),
          backgroundColor: "#a19d99",
          borderColor: "#a19d99",
          borderWidth: 1,
          order: 2
        },
        {
          type: "bar",
          label: "Actual Time",
          data: data.map(d => d.actual),
          backgroundColor: "#60a5fa",
          borderColor: "#60a5fa",
          borderWidth: 1,
          order: 2
        },
        {
          type: "line",
          label: "Takt Time",
          data: data.map(d => d.takt),
          borderColor: "#ef4444",
          backgroundColor: "#ef4444",
          borderWidth: 2,
          borderDash: [6, 6],
          pointRadius: 0,
          fill: false,
          tension: 0,
          order: 1
        }
      ]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      interaction: {
        mode: "index",
        intersect: false
      },
      plugins: {
        title: {
          display: true,
          text: titleText
        },
        legend: {
          display: true,
          position: "top"
        },
        tooltip: {
          callbacks: {
            title(items) {
              const idx = items?.[0]?.dataIndex ?? 0;
              return data[idx]?.fullLabel || items?.[0]?.label || "";
            },
            label(ctx) {
              return `${ctx.dataset.label}: ${Number(ctx.parsed.y).toFixed(1)} min`;
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
            text: "Duration (minutes)"
          }
        }
      }
    }
  });
}


function buildChartDataByMode(segments, scope, target, mode) {
  if (mode === "process") {
    return buildLineBalanceByProcess(segments, scope, target);
  }

  if (mode === "line") {
    return buildLineBalanceByLine(segments, scope, target);
  }

  return [];
}

function createChartCard(titleText) {
  const wrap = document.createElement("div");
  wrap.className = "chartCard";

  const heading = document.createElement("div");
  heading.className = "sectionTitle";
  heading.textContent = titleText;

  const canvas = document.createElement("canvas");

  wrap.appendChild(heading);
  wrap.appendChild(canvas);
  chartsContainerEl.appendChild(wrap);

  return canvas;
}

function renderProjectList(projects) {
  if (!projectListEl) return;

  if (projectCountEl) {
    projectCountEl.textContent = String(projects.length);
  }

  if (!projects.length) {
    projectListEl.innerHTML = `<div class="emptyState">No projects found.</div>`;
    return;
  }

  projectListEl.innerHTML = projects.map(project => {
    const activeClass =
      String(project.chillerSerialNumber || "") === String(selectedProjectSerial || "")
        ? " active"
        : "";

    return `
      <div class="projectListItem${activeClass}" data-serial="${escapeHtml(project.chillerSerialNumber)}">
        <div class="projectListTitle">${escapeHtml(project.projectName || "-")}</div>
        <div class="projectListMeta">
          ${escapeHtml(project.chillerSerialNumber || "-")} | ${escapeHtml(project.materialNumber || "-")}
        </div>
        <div class="projectListMeta">
          ${escapeHtml(project.model || "-")} • ${escapeHtml(project.qrKinds.join(", "))} • ${escapeHtml(String(project.runCount || 0))} run(s)
        </div>
      </div>
    `;
  }).join("");

  projectListEl.querySelectorAll(".projectListItem").forEach(itemEl => {
    itemEl.addEventListener("click", () => {
      const serial = itemEl.dataset.serial || "";
      const chosen = projects.find(p =>
        String(p.chillerSerialNumber || "") === String(serial)
      );

      if (chosen) onProjectClick(chosen);
    });
  });
}


function clearCharts() {
  lineBalanceCharts.forEach(chart => chart?.destroy?.());
  lineBalanceCharts = [];

  if (chartsContainerEl) {
    chartsContainerEl.innerHTML = "";
  }
}

function onProjectClick(project) {
  selectedProjectSerial = project.chillerSerialNumber || "";

  if (projectNameEl) {
    projectNameEl.textContent = project.projectName || "-";
  }

  if (chillerSerialEl) {
    chillerSerialEl.textContent = project.chillerSerialNumber || "-";
  }

  renderProjectList(currentProjects);
  renderSelectedProjectCharts(project);
}

async function onTargetClick(item) {
  const monthValue = monthPicker?.value || getDefaultMonthValue();
  const monthRuns = await loadRunsForMonth(monthValue);

  const result = buildSegmentsFromRuns(monthRuns);
  const segments = Array.isArray(result) ? result : result.segments || [];

  const scope = scopeModeEl?.value || "project";
  const mode = viewModeEl?.value || "line";

  const target = scope === "project"
    ? item.chillerSerialNumber
    : item.model;

  const chartData = buildChartDataByMode(
    segments,
    scope,
    target,
    mode
  );

  selectedTarget = target || "";

  if (projectNameEl) {
    projectNameEl.textContent =
      scope === "project"
        ? (item.projectName || "-")
        : (item.model || "-");
  }

  if (chillerSerialEl) {
    chillerSerialEl.textContent =
      scope === "project"
        ? (item.chillerSerialNumber || "-")
        : `${item.projectCount || 0} project(s)`;
  }

  renderTargetList(
    scope === "project"
      ? buildProjectsForMonth(monthRuns)
      : buildModelsForMonth(monthRuns)
  );

  renderLineBalanceChartByMode(chartData, item, mode, scope);
}



function renderTargetList(items) {
  if (!projectListEl) return;

  if (projectCountEl) {
    projectCountEl.textContent = String(items.length);
  }

  if (!items.length) {
    projectListEl.innerHTML = `<div class="emptyState">No items found for the selected month.</div>`;
    return;
  }

  const scope = scopeModeEl?.value || "project";

  projectListEl.innerHTML = items.map(item => {
    const targetValue =
      scope === "project"
        ? String(item.chillerSerialNumber || "")
        : String(item.model || "");

    const activeClass =
      targetValue === String(selectedTarget || "")
        ? " active"
        : "";

    if (scope === "project") {
      return `
        <div class="projectListItem${activeClass}" data-target="${escapeHtml(item.chillerSerialNumber)}">
          <div class="projectListTitle">${escapeHtml(item.projectName || "-")}</div>
          <div class="projectListMeta">
            ${escapeHtml(item.chillerSerialNumber || "-")} | ${escapeHtml(item.materialNumber || "-")}
          </div>
          <div class="projectListMeta">
            ${escapeHtml(item.model || "-")} • ${escapeHtml(String(item.runCount || 0))} run(s)
          </div>
        </div>
      `;
    }

    return `
      <div class="projectListItem${activeClass}" data-target="${escapeHtml(item.model)}">
        <div class="projectListTitle">${escapeHtml(item.model || "-")}</div>
        <div class="projectListMeta">
          ${escapeHtml(String(item.projectCount || 0))} project(s)
        </div>
        <div class="projectListMeta">
          ${escapeHtml(String(item.runCount || 0))} run(s)
        </div>
      </div>
    `;
  }).join("");

  projectListEl.querySelectorAll(".projectListItem").forEach(itemEl => {
    itemEl.addEventListener("click", () => {
      const target = itemEl.dataset.target || "";
      const chosen = items.find(item =>
        (scope === "project"
          ? String(item.chillerSerialNumber || "")
          : String(item.model || "")
        ) === String(target)
      );

      if (chosen) onTargetClick(chosen).catch(console.error);
    });
  });
}

function renderSelectedProjectCharts(project) {
  clearCharts();

  const projectSegments = getProjectSegments(allSegmentsCache, project.chillerSerialNumber);
  const qrKindView = qrKindViewEl?.value || "CHILLER";

  if (qrKindView === "CHILLER") {
    const chillerSegs = projectSegments.filter(seg =>
      String(seg.qrKind || "").trim() === "CHILLER"
    );

    const data = buildProcessChartData(chillerSegs);
    const canvas = createChartCard("CHILLER");

    const chart = renderProcessChart(
      canvas,
      data,
      `Line Balance - ${project.projectName || project.chillerSerialNumber} (CHILLER)`
    );

    if (chart) lineBalanceCharts.push(chart);
    return;
  }

  const pvSegs = projectSegments.filter(seg =>
    String(seg.qrKind || "").trim() === "PV"
  );

  const vesselMap = groupPvSegmentsByVesselType(pvSegs);

  for (const [vesselType, segs] of vesselMap.entries()) {
    const data = buildProcessChartData(segs);
    const canvas = createChartCard(vesselType);

    const chart = renderProcessChart(
      canvas,
      data,
      `Line Balance - ${project.projectName || project.chillerSerialNumber} (${vesselType})`
    );

    if (chart) lineBalanceCharts.push(chart);
  }
}

async function renderPage() {
  allRunsCache = await loadRuns();

  const result = buildSegmentsFromRuns(allRunsCache);
  allSegmentsCache = Array.isArray(result) ? result : result.segments || [];

  currentProjects = buildProjects(allRunsCache);
  renderProjectList(currentProjects);

  if (!currentProjects.length) {
    if (projectNameEl) projectNameEl.textContent = "-";
    if (chillerSerialEl) chillerSerialEl.textContent = "-";
    clearCharts();
    return;
  }

  const stillExists = currentProjects.find(
    p => String(p.chillerSerialNumber || "") === String(selectedProjectSerial || "")
  );

  const projectToShow = stillExists || currentProjects[0];
  onProjectClick(projectToShow);
}

qrKindViewEl?.addEventListener("change", () => {
  const activeProject = currentProjects.find(
    p => String(p.chillerSerialNumber || "") === String(selectedProjectSerial || "")
  );

  if (activeProject) {
    renderSelectedProjectCharts(activeProject);
  }
});

renderPage().catch(console.error);
