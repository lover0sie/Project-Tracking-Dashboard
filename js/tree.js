console.log("TREE RENDER CALLED");

import { loadRuns, loadRunsForDay } from "./timeline.js";

const el = id => document.getElementById(id);

const bodyEl = el("ganttBody");
const monthHeadEl = document.getElementById("ganttMonthHead");
const dayHeadEl = document.getElementById("ganttDayHead");

const UNIT_ORDER = ["EVAPORATOR","CONDENSER","OIL SEPARATOR","ECONOMIZER","CHILLER"];


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
  return picker?.value || ""; // YYYT-MM
}

function filterRunsByMonth(runs, monthKey){
  if (!monthKey) return runs;
  return (runs || []).filter(r => String(r.runDate || "").startsWith(monthKey));

}

function statusUi(status){
  const s = String(status || "").toLowerCase().trim();
  if (s === "completed") return { text: "Completed", cls: "completed" };
  if (s === "on_hold") return { text: "On Hold", cls: "onhold" };
  return { text: "Running", cls: "running" };
}

function unitSort(a,b){
  return UNIT_ORDER.indexOf(a.unitType) - UNIT_ORDER.indexOf(b.unitType);
}

function latestRun(runs){
  return runs.slice().sort((a,b)=>
    (b.endEpochMs || b.startEpochMs || 0) -
    (a.endEpochMs || a.startEpochMs || 0)
  )[0];
}

function buildTree(runs){
  const map = new Map();

  for(const r of runs){
    const material = r.materialNumber || "No Material";

    if(!map.has(material)){
      map.set(material,{
        projectName: r.projectName,
        material,
        chillerSerialNumber: r.chillerSerialNumber,
        units: new Map()
      });
    }

    const proj = map.get(material);

    const unitType = r.qrKind === "PV"
      ? r.vesselType
      : "CHILLER";

    const unitSerial = r.qrKind === "PV"
      ? r.pvSerialNumber
      : r.chillerSerialNumber;

    const key = unitType + unitSerial;

    if(!proj.units.has(key)){
      proj.units.set(key,{
        unitType,
        unitSerial,
        runs:[]
      });
    }

    proj.units.get(key).runs.push(r);
  }

  return map;
}

export async function renderTree() {

  const mode = el("dateMode")?.value || "daily"

  let runs = [];

  if (mode === "daily") {
    const dayKey = getSelectedDayKey() || getMYTodayKey();
    runs = await loadRunsForDay(dayKey);
  } else {
    const monthKey = getSelectedMonthKey();
    const allRuns = await loadRuns();
    runs = filterRunsByMonth(allRuns, monthKey);
  }

  console.log("Tree filtered runs:", runs);

  // Clear gantt parts
  monthHeadEl.innerHTML = "";
  dayHeadEl.innerHTML = "";
  document.getElementById("legendStations").innerHTML = "";

  const tree = buildTree(runs);
  const projects = Array.from(tree.values());

  bodyEl.innerHTML = projects.map(p => {

    const units = Array.from(p.units.values()).sort(unitSort);

    return `
      <div class="treeCard">

        <div class="treeCardHeader">
          <div class="treeProject">
            ${escapeHtml(p.projectName || "-")}
          </div>
          <div class="treeMaterial">
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
                  <div class="unitSerial">
                    ${escapeHtml(u.unitSerial || "-")}
                  </div>
                </div>

               <div class="unitRight">
                    <div class="unitProgress">
                        ${escapeHtml(proc)}
                    </div>
                    <span class="statusPill ${st.cls}">
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