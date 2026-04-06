import { loadRunsForDay } from "./timeline.js";
import {
  buildSegmentsFromRuns,
  getStationOptionsFromSegments,
  getMYTodayKey,
  getProcessNo,
  getFullProcessLabelFromSegs,
  getActualEffectiveDurationMs,
  getStandardMinutesFromLabel
} from "./helpers.js";

const dayPicker = document.getElementById("lbDayPicker");
const stationPicker = document.getElementById("lbStationPicker");
const refreshBtn = document.getElementById("lbRefreshBtn");
const chartEl = document.getElementById("lineBalanceChart");

let lineBalanceChart = null;

function minutesBetween(start, end) {
  if (!(start instanceof Date) || !(end instanceof Date)) return 0;
  return Math.max(0, (end.getTime() - start.getTime()) / 60000);
}

function escapeHtml(str = "") {
  return String(str)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

/* Function to build the Line Balance Graph */

/* For future use 
function getCycleTimePlaceholderByStation(station) {
  const map = {
    "Pneumatic": 250,
    "Piping Shop": 300,
    "Fabrication": 400
  };
  return map[station] || 250;
}

function getTaktTimePlaceholderByStation(station) {
  const map = {
    "Pneumatic": 200,
    "Piping Shop": 220,
    "Fabrication": 300
  };
  return map[station] || 200;
} */



function buildStationLineBalanceData(selectedStation, segments) {
  const filtered = selectedStation
    ? segments.filter(s => String(s.station || "").trim() === selectedStation)
    : segments;

  const groups = new Map();

  for (const seg of filtered) {
    const processNo = getProcessNo(seg);

    if (!groups.has(processNo)) {
      groups.set(processNo, []);
    }
    groups.get(processNo).push(seg);
  }

  const sortedKeys = [...groups.keys()].sort((a, b) => Number(a) - Number(b));

  const labels = [];
  const fullLabels = [];
  const actual = [];
  const standard = [];
  const cycle = [];

for (const key of sortedKeys) {
    const segs = groups.get(key);

    const totalMs = segs.reduce(
        (sum, s) => sum + getActualEffectiveDurationMs(s),
        0
    );

    const totalMin = totalMs / 60000;
    const avgMin = segs.length ? totalMin / segs.length : 0;

    const fullLabel = getFullProcessLabelFromSegs(key, segs);
    const stdMin = getStandardMinutesFromLabel(fullLabel);

    labels.push(key);
    fullLabels.push(fullLabel);
    actual.push(Number(totalMin.toFixed(1)));
    standard.push(Number(stdMin.toFixed(1)));
    cycle.push(Number(avgMin.toFixed(1)));
}

  const maxCycle = Math.max(...cycle, 0);
  const takt = cycle.map(() => Number(maxCycle.toFixed(1)));

  return { labels, fullLabels, actual, standard, cycle, takt };
}

function buildLineBalanceData(segments) {
  const grouped = new Map();

  for (const s of segments) {
    const key = String(s.processLabel || "").trim() || "Unknown";
    const dur = getActualEffectiveDurationMs(s) / 60000;

    if (!grouped.has(key)) grouped.set(key, 0);
    grouped.set(key, grouped.get(key) + dur);
  }

  const labels = [...grouped.keys()];
  const data = labels.map(k => grouped.get(k));

  return { labels, data };
}

function renderLineBalanceChart(data) {
  if (lineBalanceChart) {
    lineBalanceChart.destroy();
    lineBalanceChart = null;
  }

  lineBalanceChart = new Chart(chartEl, {
    type: "bar",
    data: {
      labels: data.labels,
      datasets: [
        {
          type: "bar",
          label: "Actual Time",
          data: data.actual,
          backgroundColor: "#60a5fa",
          borderColor: "#60a5fa",
          borderWidth: 1,
          order: 3
        },
        {
          type: "bar",
          label: "Standard Time",
          data: data.standard,
          backgroundColor: "#ff8000",
          borderColor: "#ff8000",
          borderWidth: 1,
          order: 3
        },
        {
          type: "line",
          label: "Cycle Time",
          data: data.cycle,
          borderColor: "#000000",
          backgroundColor: "#000000",
          borderWidth: 2,
          tension: 0,
          pointRadius: 3,
          pointHoverRadius: 4,
          fill: false,
          order: 1
        },
        {
          type: "line",
          label: "Takt Time",
          data: data.takt,
          borderColor: "#ef4444",
          backgroundColor: "#ef4444",
          borderWidth: 2,
          borderDash: [6, 6],
          tension: 0,
          pointRadius: 0,
          fill: false,
          order: 2
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
          position: "top"
        },
        tooltip: {
          callbacks: {
            title(items) {
              const idx = items?.[0]?.dataIndex ?? 0;
              return data.fullLabels?.[idx] || items?.[0]?.label || "";
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
            text: "Process No."
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

/* function refreshStationLineBalancePanel(segments) {
  const section = el("lineBalanceSection");
  const picker = el("stationBalancePicker");

  if (!section || !picker) return;

  if (!segments.length) {
    section.classList.add("hidden");

    if (stationLineBalanceChart) {
      stationLineBalanceChart.destroy();
      stationLineBalanceChart = null;
    }

    lastStationLineBalanceSegments = [];
    return;
  }

  section.classList.remove("hidden");

  const selectedStation = picker.value;
  const data = buildStationLineBalanceData(selectedStation, segments);

  renderStationLineBalanceChart(data);
  lastStationLineBalanceSegments = segments;
} */

async function renderPage() {
  const todayKey = getMYTodayKey();
  if (!dayPicker.value) dayPicker.value = todayKey;

  const dayKey = dayPicker.value || todayKey;
  const runs = await loadRunsForDay(dayKey);
  const { segments } = buildSegmentsFromRuns(runs);

  const stations = getStationOptionsFromSegments(segments);
  const previousStation = stationPicker.value;

  stationPicker.innerHTML = stations.map(st => `
    <option value="${escapeHtml(st)}">${escapeHtml(st)}</option>
  `).join("");

  if (stations.includes(previousStation)) {
    stationPicker.value = previousStation;
  } else if (stations.length) {
    stationPicker.value = stations[0];
  }

  const selectedStation = stationPicker.value || "";
  const data = buildStationLineBalanceData(selectedStation, segments);

  renderLineBalanceChart(data);
}

refreshBtn?.addEventListener("click", renderPage);
dayPicker?.addEventListener("change", renderPage);
stationPicker?.addEventListener("change", renderPage);

renderPage().catch(console.error);