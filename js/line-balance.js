import { loadRunsForDay } from "./timeline.js";
import {
  buildSegmentsFromRuns,
  getStationOptionsFromSegments,
  getMYTodayKey
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

function buildLineBalanceData(segments) {
  const grouped = new Map();

  for (const s of segments) {
    const key = String(s.processLabel || "").trim() || "Unknown";
    const dur = minutesBetween(s.start, s.end);

    if (!grouped.has(key)) grouped.set(key, 0);
    grouped.set(key, grouped.get(key) + dur);
  }

  const labels = [...grouped.keys()];
  const data = labels.map(k => grouped.get(k));

  return { labels, data };
}

function renderLineBalanceChart(segments) {
  const { labels, data } = buildLineBalanceData(segments);

  if (lineBalanceChart) {
    lineBalanceChart.destroy();
    lineBalanceChart = null;
  }

  lineBalanceChart = new Chart(chartEl, {
    type: "bar",
    data: {
      labels,
      datasets: [
        {
          label: "Duration (min)",
          data
        }
      ]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false
    }
  });
}

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
  const filteredSegs = selectedStation
    ? segments.filter(s => String(s.station || "").trim() === selectedStation)
    : segments;

  renderLineBalanceChart(filteredSegs);
}

refreshBtn?.addEventListener("click", renderPage);
dayPicker?.addEventListener("change", renderPage);
stationPicker?.addEventListener("change", renderPage);

renderPage().catch(console.error);