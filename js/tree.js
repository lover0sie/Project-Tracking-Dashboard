console.log("TREE RENDER CALLED");

import { loadRuns} from "./timeline.js";
import {formatDateTime} from "./gantt.js"
import { hasExplicitChillerVesselType } from "./helpers.js";

const el = id => document.getElementById(id);

const bodyEl = el("ganttBody");
const monthHeadEl = document.getElementById("ganttMonthHead");
const dayHeadEl = document.getElementById("ganttDayHead");
const ganttWrapEl = document.querySelector(".ganttWrap");
const ganttGridEl = document.querySelector(".ganttGrid");

const UNIT_ORDER = ["CHILLER","COMPRESSOR","EVAPORATOR","CONDENSER","OIL SEPARATOR","ECONOMIZER"];

function pvUnitSerialFromRun(run) {
  return (
    run.pvSerialNumber ||
    run.relatedPvSerialNumber ||
    run.serialNumber ||
    run.serial ||
    "-"
  );
}

function chillerUnitSerialFromRun(run) {
  return (
    run.chillerSerialNumber ||
    run.serialNumber ||
    run.serial ||
    "-"
  );
}

function tsOrMsToDate(ts, ms) {
  if (ts && typeof ts.toDate === "function") return ts.toDate();

  const n = (typeof ms === "number") ? ms
          : (typeof ms === "string" && ms.trim() !== "" && !isNaN(ms)) ? Number(ms)
          : null;

  if (typeof n === "number" && Number.isFinite(n)) return new Date(n);
  return null;
}

function normalizeHoldReason(reason){
  if (!reason) return "";

  const map = {
    rework: "Rework Required",
    item_missing: "Item Missing",
    item_shortage: "Material Shortage",
    resume_tomorrow: "Resume Next Shift / Tomorrow",
    others: "Others",
    browser_closed: "Auto Hold (Browser Closed / Tab Closed)"
  };

  const key = String(reason).toLowerCase().trim();
  if (map[key]) return map[key];

  return key
    .replaceAll("_"," ")
    .replace(/\b\w/g, c => c.toUpperCase());
}

// Build the tooltip for tree status
function buildTreeStatusTooltip(run){
  if (!run) return "";

  const status = String(run.status || "").toLowerCase().trim();

  // RUNNING
  if (status === "running") {
    return `
      <div class="tipTitle">RUNNING</div>
      <div class="tipRow"><span class="tipLabel">Station:</span> ${run.station || "-"}</div>
      <div class="tipRow"><span class="tipLabel">Started By:</span> ${run.startedByName || "-"} (${run.startedByNumber || "-"})</div>
      <div class="tipRow"><span class="tipLabel">Resumed By:</span> ${run.resumedByName || "-"} (${run.resumedByNumber || "-"})</div>
      <div class="tipRow"><span class="tipLabel">Manpower:</span> ${run.manpower ?? "-"}</div>
    `;
  }

  // COMPLETED
  if (status === "completed") {
    return `
      <div class="tipTitle">COMPLETED</div>
      <div class="tipRow"><span class="tipLabel">Station:</span> ${run.station || "-"}</div>
      <div class="tipRow"><span class="tipLabel">Started By:</span> ${run.startedByName || "-"} (${run.startedByNumber || "-"})</div>
      <div class="tipRow"><span class="tipLabel">Completed At:</span> ${formatDateTime(tsOrMsToDate(run.endAt, run.endEpochMs))}</div>
      <div class="tipRow"><span class="tipLabel">Manpower:</span> ${run.manpower ?? "-"}</div>
    `;
  }

  // ON HOLD
  if (status === "on_hold") {
    let holdReason = "";
    let remarks = "";
    let holdAt = null;

    // NEW array format
    if (Array.isArray(run.holds) && run.holds.length) {
      const latest = run.holds[run.holds.length - 1];
      holdReason = latest?.holdReason || "";
      remarks = latest?.remarks || "";
      holdAt = typeof latest?.holdAtEpochMs === "number"
        ? new Date(latest.holdAtEpochMs)
        : null;
    } else {
      // OLD single format
      holdReason = run.holdReason || "";
      remarks = run.remarks || "";
      holdAt = tsOrMsToDate(run.holdAt, run.holdEpochMs);
    }

    const displayReason =
      holdReason === "others" && remarks
        ? remarks
        : (normalizeHoldReason(holdReason) || "-");

    return `
      <div class="tipTitle">ON HOLD</div>
      <div class="tipRow"><span class="tipLabel">Process:</span> ${run.processName || "-"}</div>
      <div class="tipRow"><span class="tipLabel">Station:</span> ${run.station || "-"}</div>
      <div class="tipRow"><span class="tipLabel">Hold At:</span> ${formatDateTime(holdAt)}</div>
      <div class="tipRow"><span class="tipLabel">Reason:</span> ${displayReason}</div>
      <div class="tipRow"><span class="tipLabel">Remark:</span> ${remarks || "-"}</div>
    `;
  }

  return `
    <div class="tipTitle">STATUS</div>
    <div class="tipRow"><span class="tipLabel">Status:</span> ${status || "-"}</div>
  `;
}

function startOfWorkDay(d){
  const x = new Date(d);
  x.setHours(7, 0, 0, 0);
  return x;
}

function endOfWorkDay(d){
  const x = new Date(d);
  x.setHours(22, 0, 0, 0);
  return x;
}

function startOfDay(d){
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
}

function endOfDay(d){
  const x = new Date(d);
  x.setHours(23, 59, 59, 999);
  return x;
}

function parseDayKeyToDate(dayKey){
  const [y,m,d] = dayKey.split("-").map(Number);
  return new Date(y, m-1, d);
}

function getRunWindow(r){
  const start = tsOrMsToDate(r.startAt, r.startEpochMs);
  const endCompleted = tsOrMsToDate(r.endAt, r.endEpochMs);
  const holdTime = tsOrMsToDate(r.holdAt, r.holdEpochMs);

  const status = String(r.status || "").toLowerCase().trim();

  const end =
    status === "completed" ? endCompleted :
    status === "on_hold" ? (holdTime || new Date()) :
    new Date();

  if (!start || !end) return null;
  return { start, end };
}

function filterRunsByRange(runs, rangeMin, rangeMax){
  return (runs || []).filter(r => {
    const w = getRunWindow(r);
    if (!w) return false;

    return w.end.getTime() > rangeMin.getTime() &&
           w.start.getTime() < rangeMax.getTime();
  });
}

function getMYTodayKey(){
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Kuala_Lumpur"
  }).format(new Date());
}

function escapeHtml(s){
  return String(s ?? "")
    .replaceAll("&","&amp;")
    .replaceAll("<","&lt;")
    .replaceAll(">","&gt;")
    .replaceAll('"',"&quot;")
    .replaceAll("'","&#039;");
}

function getSelectedDayKey() {
  const picker = el("dayPicker");
  return picker?.value || "";
}

function getSelectedMonthKey() {
  const picker = el("monthPicker");
  return picker?.value || "";
}

function setTreeViewClasses(mode) {
  ganttWrapEl?.classList.remove("dailyMode", "monthMode", "stationMode");
  ganttGridEl?.classList.remove("dailyMode", "monthMode", "stationMode");

  ganttWrapEl?.classList.add("treeMode");
  ganttGridEl?.classList.add("treeMode");
  ganttWrapEl?.classList.toggle("treeMonthMode", mode === "month");
  ganttGridEl?.classList.toggle("treeMonthMode", mode === "month");
}

function statusUi(status){
  const s = String(status || "").toLowerCase().trim();
  if (s === "completed") return { text: "Completed", cls: "completed" };
  if (s === "on_hold") return { text: "On Hold", cls: "onhold" };
  return { text: "Running", cls: "running" };
}

function unitSort(a,b){
  return UNIT_ORDER.indexOf(String(a.unitType || "").toUpperCase()) -
         UNIT_ORDER.indexOf(String(b.unitType || "").toUpperCase());
}

function latestRun(runs){
  return runs.slice().sort((a,b)=>
    (b.endEpochMs || b.startEpochMs || 0) -
    (a.endEpochMs || a.startEpochMs || 0)
  )[0];
}

function buildTree(runs){
  const map = new Map();

  for (const r of runs) {
    const projectName = r.projectName || "-";
    const material = r.materialNumber || "-";
    const chillerSerial = r.chillerSerialNumber || "";

    // Use chiller serial if available, otherwise fall back to project+material
    const groupKey = chillerSerial
      ? `CH::${chillerSerial}`
      : `PM::${projectName}||${material}`;

    if (!map.has(groupKey)) {
      map.set(groupKey, {
        projectName,
        material,
        chillerSerialNumber: chillerSerial || "-",
        units: new Map()
      });
    }

    const proj = map.get(groupKey);

    const qrKind = String(r.qrKind || "").toUpperCase().trim();
    const relatedQrKind = String(r.relatedQrKind || "").toUpperCase().trim();
    const insulationItemType = String(r.insulationItemType || "").toUpperCase().trim();

    let unitType = "CHILLER";
    let unitSerial = chillerUnitSerialFromRun(r);

    // Insulation scanned with CHILLER QR, but belongs to PV item
    if (
      qrKind === "CHILLER" &&
      (
        hasExplicitChillerVesselType(r) ||
        (relatedQrKind === "PV" && insulationItemType)
      )
    ) {
      unitType = r.vesselType || insulationItemType;
      unitSerial = pvUnitSerialFromRun(r);
    }

    // Normal PV
    else if (qrKind === "PV") {
      unitType = r.vesselType || "PV";
      unitSerial = pvUnitSerialFromRun(r);
    }

    // Normal CHILLER
    else {
      unitType = "CHILLER";
      unitSerial = chillerUnitSerialFromRun(r);
    }

    const unitKey = `${unitType}||${unitSerial}`;

    if (!proj.units.has(unitKey)) {
      proj.units.set(unitKey, {
        unitType,
        unitSerial,
        runs: []
      });
    }

    proj.units.get(unitKey).runs.push(r);
  }

  return map;
}

export async function renderTree() {
  const mode = el("dateMode")?.value || "daily";
  setTreeViewClasses(mode);

  let allRuns = await loadRuns();
  let runs = [];

  if (mode === "daily") {
    const dayKey = getSelectedDayKey() || getMYTodayKey();
    const dayDate = parseDayKeyToDate(dayKey);

    const rangeMin = startOfWorkDay(dayDate);
    const rangeMax = endOfWorkDay(dayDate);

    runs = filterRunsByRange(allRuns, rangeMin, rangeMax);

  } else {
    const monthPicker = el("monthPicker");
    const todayKey = getMYTodayKey();
    const defaultMonthKey = todayKey.slice(0, 7);
    const monthKey = getSelectedMonthKey() || defaultMonthKey;

    if (monthPicker && !monthPicker.value) monthPicker.value = monthKey;

    if (!monthKey) {
      runs = [];
    } else {
      const [yy, mm] = monthKey.split("-").map(Number);
      const rangeMin = startOfDay(new Date(yy, mm - 1, 1));
      const rangeMax = endOfDay(new Date(yy, mm, 0));

      runs = filterRunsByRange(allRuns, rangeMin, rangeMax);
    }
  }

  /* console.log("Tree filtered runs:", runs); */

  monthHeadEl.innerHTML = "";
  dayHeadEl.innerHTML = "";

  const tree = buildTree(runs);
  const projects = Array.from(tree.values()).sort((a, b) =>
    (a.projectName || "").localeCompare(b.projectName || "") ||
    (a.chillerSerialNumber || "").localeCompare(b.chillerSerialNumber || "")
  );

  bodyEl.innerHTML = projects.map(p => {
    const units = Array.from(p.units.values()).sort(unitSort);

    return `
      <div class="treeCard">
        <div class="treeCardHeader">
          <div class="treeProject">
            ${escapeHtml(p.projectName || "-")}
          </div>
          <div class="treeMaterial">
            Chiller Serial: <b>${escapeHtml(p.chillerSerialNumber || "-")}</b>
          </div>
          <div class="treeChiller">
            Material No: <b>${escapeHtml(p.material || "-")}</b>
          </div>
        </div>

        <div class="treeUnits">
          ${units.map(u => {
            const last = latestRun(u.runs);
            const st = statusUi(last?.status);
            const proc = last?.processName || "-";

            return `
              <div class="treeUnitCard">
                <div class="unitLeft">
                  <div class="unitType">${escapeHtml(u.unitType)}</div>
                  <div class="unitSerial">${escapeHtml(u.unitSerial || "-")}</div>
                </div>

                <div class="unitRight">
                  <div class="unitProgress">${escapeHtml(proc)}</div>
                  <span
                    class="statusPill ${st.cls}"
                    data-tip="${escapeHtml(buildTreeStatusTooltip(last))}"
                    >
                    ${escapeHtml(st.text)}
                  </span>
                </div>
              </div>
            `;
          }).join("")}
        </div>
      </div>
    `;
  }).join("");
}
