import {
  buildSegmentsFromRuns,
  getActualEffectiveDurationMs,
  getProcessCode
} from "./helpers.js";

import { loadProjectHeadersFallbackFromRuns, loadRunsForProject } from "./timeline.js";

const dateFromEl = document.getElementById("cycleDateFrom");
const dateToEl = document.getElementById("cycleDateTo");
const refreshBtn = document.getElementById("cycleRefreshBtn");
const modelCountEl = document.getElementById("cycleModelCount");
const recordCountEl = document.getElementById("cycleRecordCount");
const summaryTableEl = document.getElementById("cycleSummaryTable");
const modelChartEl = document.getElementById("cycleModelChart");
const processModalEl = document.getElementById("cycleProcessModal");
const processModalTitleEl = document.getElementById("cycleProcessModalTitle");
const processModalSubEl = document.getElementById("cycleProcessModalSub");
const processModalBodyEl = document.getElementById("cycleProcessModalBody");
const modalCloseBtn = document.getElementById("cycleModalCloseBtn");

let modelRows = [];

const AIR_COOLED_MODELS = new Set(["UAASV3", "UAAST3", "UAM", "UAL"]);

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
    new Map(processes.map((process, index) => [normalizeProcessKey(process), index]))
  ])
);

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function normalizeProcessKey(value = "") {
  return String(value || "")
    .trim()
    .replace(/\s*,\s*/g, ",")
    .replace(/\s+/g, " ")
    .toUpperCase();
}

function normalizeChillerType(value = "") {
  return String(value || "").trim().toUpperCase();
}

function formatMinutes(value) {
  return Number(value || 0).toLocaleString(undefined, {
    minimumFractionDigits: 1,
    maximumFractionDigits: 1
  });
}

function formatHours(value) {
  return (Number(value || 0) / 60).toLocaleString(undefined, {
    minimumFractionDigits: 1,
    maximumFractionDigits: 1
  });
}

function formatDateInputValue(ms) {
  if (!Number.isFinite(ms) || ms <= 0) return "";

  const date = new Date(ms);
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");

  return `${year}-${month}-${day}`;
}

function parseDateStartMs(value) {
  if (!value) return null;

  const [year, month, day] = String(value).split("-").map(Number);
  if (!year || !month || !day) return null;

  return new Date(year, month - 1, day, 0, 0, 0, 0).getTime();
}

function parseDateEndMs(value) {
  if (!value) return null;

  const [year, month, day] = String(value).split("-").map(Number);
  if (!year || !month || !day) return null;

  return new Date(year, month - 1, day, 23, 59, 59, 999).getTime();
}

function isSegmentInDateRange(seg) {
  const startMs = seg?.start instanceof Date ? seg.start.getTime() : 0;
  const fromMs = parseDateStartMs(dateFromEl?.value);
  const toMs = parseDateEndMs(dateToEl?.value);

  if (fromMs != null && startMs < fromMs) return false;
  if (toMs != null && startMs > toMs) return false;
  return true;
}

function getSegmentManpower(seg) {
  const manpower = Number(seg?.manpower || seg?.run?.manpower || 1);
  return Number.isFinite(manpower) && manpower > 0 ? manpower : 1;
}

function getSegmentCoolingType(seg) {
  const model = normalizeChillerType(seg?.model);
  const coolingType = normalizeChillerType(seg?.coolingType);

  if (CHILLER_PROCESS_RANKS[coolingType]) return coolingType;
  if (AIR_COOLED_MODELS.has(model)) return "AIR-COOLED";
  return "WATER-COOLED";
}

function getKnownChillerProcessCode(processName = "", coolingType = "") {
  const label = normalizeProcessKey(processName);
  const type = normalizeChillerType(coolingType);
  const typeProcesses = CHILLER_PROCESS_ORDER[type] || [];
  const allProcesses = Array.from(
    new Set(Object.values(CHILLER_PROCESS_ORDER).flat())
  );
  const candidates = (typeProcesses.length ? typeProcesses : allProcesses)
    .map(normalizeProcessKey)
    .sort((a, b) => b.length - a.length);

  return candidates.find(code =>
    label === code ||
    label.startsWith(`${code} -`) ||
    label.startsWith(`${code} `)
  ) || "";
}

function getCycleProcessCode(processName = "", coolingType = "") {
  return getKnownChillerProcessCode(processName, coolingType) || getProcessCode(processName);
}

function getProcessRank(processCode = "", coolingType = "") {
  const code = normalizeProcessKey(processCode);
  const type = normalizeChillerType(coolingType);
  const rankMap = CHILLER_PROCESS_RANKS[type];

  if (rankMap?.has(code)) return rankMap.get(code);

  const leadingCode = code.match(/^([A-Z]+\d*)\b/)?.[1] || "";
  if (leadingCode && rankMap?.has(leadingCode)) return rankMap.get(leadingCode);

  return 9999;
}

function buildCycleRows(segments) {
  const modelMap = new Map();

  for (const seg of segments || []) {
    if (String(seg.qrKind || "").trim().toUpperCase() !== "CHILLER") continue;
    if (seg.phase === "waiting" || String(seg.status || "").trim().toLowerCase() === "waiting") continue;
    if (!isSegmentInDateRange(seg)) continue;

    const model = String(seg.model || "").trim();
    if (!model) continue;

    const effectiveMin = getActualEffectiveDurationMs(seg) / 60000;
    if (!Number.isFinite(effectiveMin) || effectiveMin <= 0) continue;

    const manpower = getSegmentManpower(seg);
    const coolingType = getSegmentCoolingType(seg);
    const fullLabel = String(seg.processLabel || seg.processName || "").trim();
    const processCode = getCycleProcessCode(fullLabel, coolingType);
    if (!processCode) continue;

    if (!modelMap.has(model)) {
      modelMap.set(model, {
        model,
        records: 0,
        unitSerials: new Set(),
        coolingTypes: new Set(),
        processes: new Map()
      });
    }

    const modelRow = modelMap.get(model);
    modelRow.records++;
    if (seg.chillerSerialNumber) {
      modelRow.unitSerials.add(String(seg.chillerSerialNumber).trim());
    }
    if (coolingType) modelRow.coolingTypes.add(coolingType);

    const processKey = normalizeProcessKey(processCode);
    if (!modelRow.processes.has(processKey)) {
      modelRow.processes.set(processKey, {
        processCode: normalizeProcessKey(processCode),
        fullLabel,
        coolingType,
        records: 0,
        effectiveSum: 0,
        manpowerSum: 0
      });
    }

    const processRow = modelRow.processes.get(processKey);
    processRow.records++;
    processRow.effectiveSum += effectiveMin;
    processRow.manpowerSum += manpower;
  }

  return Array.from(modelMap.values()).map(modelRow => {
    const processes = Array.from(modelRow.processes.values())
      .map(process => ({
        ...process,
        avgEffectiveMin: process.effectiveSum / process.records,
        avgManpower: process.manpowerSum / process.records,
        avgCycleMin: (process.effectiveSum / process.records) * (process.manpowerSum / process.records)
      }))
      .sort((a, b) =>
        getProcessRank(a.processCode, a.coolingType) - getProcessRank(b.processCode, b.coolingType) ||
        a.processCode.localeCompare(b.processCode, undefined, { numeric: true })
      );

    const totalCycleMin = processes.reduce(
      (sum, process) => sum + Number(process.avgCycleMin || 0),
      0
    );
    return {
      model: modelRow.model,
      records: modelRow.records,
      unitCount: modelRow.unitSerials.size,
      coolingTypes: Array.from(modelRow.coolingTypes).sort().join(", "),
      processCount: processes.length,
      totalCycleMin,
      processes
    };
  }).sort((a, b) =>
    Number(b.totalCycleMin || 0) - Number(a.totalCycleMin || 0) ||
    a.model.localeCompare(b.model)
  );
}

function renderSummary() {
  if (modelCountEl) modelCountEl.textContent = String(modelRows.length);
  if (recordCountEl) {
    recordCountEl.textContent = String(modelRows.reduce((sum, row) => sum + row.unitCount, 0));
  }

  if (!summaryTableEl) return;

  if (!modelRows.length) {
    summaryTableEl.innerHTML = `<div class="emptyState">No completed chiller process records found.</div>`;
    renderModelFrequencyChart();
    return;
  }

  summaryTableEl.innerHTML = `
    <table class="cycleTable">
      <thead>
        <tr>
          <th>Model</th>
          <th>Cooling Type</th>
          <th class="num">Processes</th>
          <th class="num">No. of Units</th>
          <th class="num">Total Cycle Time (mins)</th>
          <th class="num">Total Cycle Time (hours)</th>
        </tr>
      </thead>
      <tbody>
        ${modelRows.map(row => `
          <tr class="cycleModelRow" data-model="${escapeHtml(row.model)}" tabindex="0" title="Open process cycle time details">
            <td>${escapeHtml(row.model)}</td>
            <td>${escapeHtml(row.coolingTypes || "-")}</td>
            <td class="num">${escapeHtml(row.processCount)}</td>
            <td class="num">${escapeHtml(row.unitCount)}</td>
            <td class="num">${escapeHtml(formatMinutes(row.totalCycleMin))}</td>
            <td class="num">${escapeHtml(formatHours(row.totalCycleMin))}</td>
          </tr>
        `).join("")}
      </tbody>
    </table>
  `;

  summaryTableEl.querySelectorAll(".cycleModelRow").forEach(rowEl => {
    rowEl.addEventListener("click", () => {
      const model = rowEl.dataset.model || "";
      const modelRow = modelRows.find(row => row.model === model);
      if (modelRow) openProcessModal(modelRow);
    });

    rowEl.addEventListener("keydown", event => {
      if (event.key !== "Enter" && event.key !== " ") return;
      event.preventDefault();
      const model = rowEl.dataset.model || "";
      const modelRow = modelRows.find(row => row.model === model);
      if (modelRow) openProcessModal(modelRow);
    });
  });

  renderModelFrequencyChart();
}

function renderModelFrequencyChart() {
  if (!modelChartEl) return;

  if (!modelRows.length) {
    modelChartEl.innerHTML = `<div class="emptyState">No model frequency found.</div>`;
    return;
  }

  const chartRows = [...modelRows].sort((a, b) =>
    Number(b.unitCount || 0) - Number(a.unitCount || 0) ||
    a.model.localeCompare(b.model)
  );
  const maxUnits = Math.max(1, ...chartRows.map(row => Number(row.unitCount || 0)));
  const chartMax = Math.max(5, Math.ceil(maxUnits / 5) * 5);
  const tickCount = 5;
  const colors = ["#2563eb", "#f59e0b", "#10b981", "#e11d48", "#8b5cf6", "#06b6d4", "#f97316", "#64748b", "#84cc16", "#ec4899", "#14b8a6", "#7c3aed"];

  const gridHtml = Array.from({ length: tickCount + 1 }, (_, index) => {
    const topPct = (index / tickCount) * 100;
    return `<div class="cycleGridLine" style="top:${topPct}%"></div>`;
  }).join("");

  const yTicksHtml = Array.from({ length: tickCount + 1 }, (_, index) => {
    const value = Math.round((chartMax / tickCount) * (tickCount - index));
    const topPct = (index / tickCount) * 100;
    return `<div class="cycleYTick" style="top:${topPct}%">${escapeHtml(value)}</div>`;
  }).join("");

  modelChartEl.innerHTML = `
    <div class="cycleBarChart" style="--cycleModelCount:${chartRows.length}">
      <div class="cycleAxisLabel cycleYAxisLabel">Number of Units</div>
      <div class="cycleYAxis">${yTicksHtml}</div>
      <div class="cyclePlot">
        <div class="cycleGridLines">${gridHtml}</div>
        ${chartRows.map((row, index) => {
          const units = Number(row.unitCount || 0);
          const heightPct = (units / chartMax) * 100;
          const color = colors[index % colors.length];
          return `
            <div class="cycleBarSlot" title="${escapeHtml(row.model)}: ${escapeHtml(units)} unit(s)">
              <div class="cycleBar" style="height:${heightPct}%; background:${escapeHtml(color)}">
                <span class="cycleBarValue">${escapeHtml(units)}</span>
              </div>
            </div>
          `;
        }).join("")}
      </div>
      <div class="cycleXAxis">
        ${chartRows.map(row => `<div class="cycleXLabel">${escapeHtml(row.model)}</div>`).join("")}
      </div>
      <div class="cycleAxisLabel cycleXAxisLabel">Model</div>
    </div>
  `;
}

function openProcessModal(modelRow) {
  if (!processModalEl || !processModalBodyEl) return;

  if (processModalTitleEl) {
    processModalTitleEl.textContent = `${modelRow.model} Process Cycle Time`;
  }

  if (processModalSubEl) {
    processModalSubEl.textContent = `${modelRow.coolingTypes || "-"} | ${modelRow.unitCount} unit(s) | ${modelRow.processCount} process(es)`;
  }

  renderProcessModalTable(modelRow);
  processModalEl.classList.remove("hidden");
}

function renderProcessModalTable(modelRow) {
  if (!processModalBodyEl) return;

  processModalBodyEl.innerHTML = `
    <table class="cycleTable">
      <thead>
        <tr>
          <th>Process</th>
          <th class="num">Records</th>
          <th class="num">Average Effective Duration (min)</th>
          <th class="num">Sum Manpower</th>
          <th class="num">Average Manpower</th>
          <th class="num">Average Cycle Time (min)</th>
        </tr>
      </thead>
      <tbody>
        ${modelRow.processes.map(process => `
          <tr>
            <td>${escapeHtml(process.fullLabel || process.processCode)}</td>
            <td class="num">${escapeHtml(process.records)}</td>
            <td class="num">${escapeHtml(formatMinutes(process.avgEffectiveMin))}</td>
            <td class="num">${escapeHtml(formatMinutes(process.manpowerSum))}</td>
            <td class="num">${escapeHtml(formatMinutes(process.avgManpower))}</td>
            <td class="num">${escapeHtml(formatMinutes(process.avgCycleMin))}</td>
          </tr>
        `).join("")}
        <tr class="cycleTotalRow">
          <td colspan="5">Total Average Cycle Time (Min)</td>
          <td class="num">${escapeHtml(formatMinutes(modelRow.totalCycleMin))}</td>
        </tr>
      </tbody>
    </table>
  `;
}

function closeProcessModal() {
  processModalEl?.classList.add("hidden");
}

async function loadCycleTime() {
  if (summaryTableEl) {
    summaryTableEl.innerHTML = `<div class="emptyState">Loading chiller cycle time...</div>`;
  }
  if (modelChartEl) {
    modelChartEl.innerHTML = `<div class="emptyState">Loading model frequency...</div>`;
  }
  if (refreshBtn) refreshBtn.disabled = true;

  try {
    const projects = await loadProjectHeadersFallbackFromRuns();
    initializeDateFilters(projects);
    const runsNested = await Promise.all(
      projects.map(project => loadRunsForProject(project.chillerSerialNumber))
    );
    const result = buildSegmentsFromRuns(runsNested.flat());
    const segments = Array.isArray(result) ? result : result.segments || [];

    modelRows = buildCycleRows(segments);
    renderSummary();
  } catch (err) {
    console.error("Failed to load chiller cycle time:", err);
    if (summaryTableEl) {
      summaryTableEl.innerHTML = `<div class="emptyState">Failed to load chiller cycle time.</div>`;
    }
    if (modelChartEl) {
      modelChartEl.innerHTML = `<div class="emptyState">Failed to load model frequency.</div>`;
    }
  } finally {
    if (refreshBtn) refreshBtn.disabled = false;
  }
}

function initializeDateFilters(projects) {
  if (dateFromEl?.value || dateToEl?.value) return;

  const starts = (projects || [])
    .map(project => Number(project.firstStart || 0))
    .filter(ms => Number.isFinite(ms) && ms > 0);
  const latest = (projects || [])
    .map(project => Number(project.latestStart || 0))
    .filter(ms => Number.isFinite(ms) && ms > 0);

  if (dateFromEl && starts.length) dateFromEl.value = formatDateInputValue(Math.min(...starts));
  if (dateToEl && latest.length) dateToEl.value = formatDateInputValue(Math.max(...latest));
}

refreshBtn?.addEventListener("click", loadCycleTime);
dateFromEl?.addEventListener("change", loadCycleTime);
dateToEl?.addEventListener("change", loadCycleTime);
modalCloseBtn?.addEventListener("click", closeProcessModal);
processModalEl?.addEventListener("click", event => {
  if (event.target === processModalEl) closeProcessModal();
});
document.addEventListener("keydown", event => {
  if (event.key === "Escape") closeProcessModal();
});

loadCycleTime();
