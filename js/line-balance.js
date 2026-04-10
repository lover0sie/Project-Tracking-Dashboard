import { loadRunsForMonth } from "./timeline.js";
import {
  buildSegmentsFromRuns,
  getActualEffectiveDurationMs,
  getStandardMinutesFromLabel,
  getProcessCode,
  getTotalDurationMs
} from "./helpers.js";


const monthPicker = document.getElementById("lbMonthPicker");
const projectNameEl = document.getElementById("lbProjectName");
const chillerSerialEl = document.getElementById("lbChillerSerial");
const chartEl = document.getElementById("lineBalanceChart");

const projectListEl = document.getElementById("lbProjectList");
const projectCountEl = document.getElementById("lbProjectCount");
const viewModeEl = document.getElementById("lbViewMode");

let lineBalanceChart = null;
let selectedProjectSerial = "";

let currentProjects = [];

function getStationDisplayName(station = "") {
  const map = {
    "Pneumatic": "Paint Booth and Testing"
  };

  return map[station] || station;
}

function getSegmentProcessLabel(seg) {
  return String(seg.processLabel || seg.processName || "").trim() || "Unknown";
}

function escapeHtml(str = "") {
  return String(str)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function getDefaultMonthValue() {
  const now = new Date();
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, "0");
  return `${y}-${m}`;
}

function getMonthDateRange(monthValue) {
  const [year, month] = String(monthValue).split("-").map(Number);
  if (!year || !month) return null;

  const start = new Date(year, month - 1, 1, 0, 0, 0, 0);
  const end = new Date(year, month, 1, 0, 0, 0, 0);

  return { start, end };
}

function getProcessSortKey(processName = "") {
  const m = String(processName).match(/^(\d+)([A-Z]?)/i);

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

function filterRunsByMonth(runs, monthValue) {
  const range = getMonthDateRange(monthValue);
  if (!range) return [];

  return runs.filter(run => {
    const ms = Number(run.startEpochMs || 0);
    if (!ms) return false;
    return ms >= range.start.getTime() && ms < range.end.getTime();
  });
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

function buildLineBalanceByStationForProject(segments, selectedChillerSerial) {
  const filtered = segments.filter(seg =>
    String(seg.chillerSerialNumber || "").trim() === String(selectedChillerSerial || "").trim() &&
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

function buildLineBalanceByProcessForProject(segments, selectedChillerSerial) {
  const filtered = segments.filter(seg =>
    String(seg.chillerSerialNumber || "").trim() === String(selectedChillerSerial || "").trim() &&
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


function renderLineBalanceChartByMode(data, project, mode) {
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

  lineBalanceChart = new Chart(chartEl, {
    type: "bar",
    data: {
      labels: data.map(d => d.label),
      datasets: [
        {
          label: "Standard Time",
          data: data.map(d => d.standard),
          backgroundColor: "#ff8000",
          borderColor: "#ff8000",
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
        legend: {
          display: true,
          position: "top",
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
            text: mode === "process" ? "Process" : "Line"
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

function buildChartDataByMode(segments, selectedChillerSerial, mode) {
  if (mode === "process") {
    return buildLineBalanceByProcessForProject(segments, selectedChillerSerial);
  }

  if (mode === "line") {
    return buildLineBalanceByStationForProject(segments, selectedChillerSerial);
  }

  /* buildLineBalanceByLineForProject(segments, selectedChillerSerial); */
}

function clearChart() {
  if (lineBalanceChart) {
    lineBalanceChart.destroy();
    lineBalanceChart = null;
  }
}

async function onProjectClick(project) {
  const monthValue = monthPicker?.value || getDefaultMonthValue();
  const monthRuns = await loadRunsForMonth(monthValue);

  const result = buildSegmentsFromRuns(monthRuns);
  const segments = Array.isArray(result) ? result : result.segments || [];

  const mode = viewModeEl?.value || "station";

  const chartData = buildChartDataByMode(
    segments,
    project.chillerSerialNumber,
    mode
  );

  selectedProjectSerial = project.chillerSerialNumber || "";

  if (projectNameEl) {
    projectNameEl.textContent = project.projectName || "-";
  }

  if (chillerSerialEl) {
    chillerSerialEl.textContent = project.chillerSerialNumber || "-";
  }

  renderProjectList(buildProjectsForMonth(monthRuns));
  renderLineBalanceChartByMode(chartData, project, mode);
}

function renderProjectList(projects) {
  if (!projectListEl) return;

  if (projectCountEl) {
    projectCountEl.textContent = String(projects.length);
  }

  if (!projects.length) {
    projectListEl.innerHTML = `<div class="emptyState">No projects found for the selected month.</div>`;
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
          ${escapeHtml(project.model || "-")} • ${escapeHtml(String(project.runCount || 0))} run(s)
        </div>
      </div>
    `;
  }).join("");

  projectListEl.querySelectorAll(".projectListItem").forEach(item => {
    item.addEventListener("click", () => {
      const serial = item.dataset.serial || "";
      const project = projects.find(p => String(p.chillerSerialNumber) === String(serial));
      if (project) onProjectClick(project).catch(console.error);
    });
  });
}

async function renderPage() {
  if (!monthPicker) return;

  if (!monthPicker.value) {
    monthPicker.value = getDefaultMonthValue();
  }

  const monthRuns = await loadRunsForMonth(monthPicker.value);
  const projects = buildProjectsForMonth(monthRuns);

  renderProjectList(projects);

    currentProjects = projects;


  if (!projects.length) {
    if (projectNameEl) projectNameEl.textContent = "-";
    if (chillerSerialEl) chillerSerialEl.textContent = "-";
    clearChart();
    return;
  }

  const stillExists = projects.find(
    p => String(p.chillerSerialNumber) === String(selectedProjectSerial)
  );

  const projectToShow = stillExists || projects[0];
  await onProjectClick(projectToShow);
}

monthPicker?.addEventListener("change", () => {
  selectedProjectSerial = "";
  renderPage().catch(console.error);
});

viewModeEl?.addEventListener("change", () => {
  const activeProject = currentProjects.find(
    p => String(p.chillerSerialNumber) === String(selectedProjectSerial)
  );

  if (activeProject) {
    onProjectClick(activeProject).catch(console.error);
  }
});

renderPage().catch(console.error);