const el = (id) => document.getElementById(id);

/* ===== MASTER PROCESS LIST ===== */
const PROCESS_BY_STATION = {
  "PV 1": [
    "6 - Hole bevelling", 
    "7 - Connector welding",
    "8 - Fitting internal plate and GMAW C&B",
    "9 - Fitting and welding distribution box", 
    "10 - Tube support and bush fitting, tube sheet fitting",
    "11 - Tubesheet welding",
    "12 - Bracket and attachment welding",
    "13 - Unit side plate and base welding",
    "14 - Tube slotting and expansion",
  ],

  "PV 2": [
    "6 - Hole bevelling", 
    "7 - Connector welding",
    "8 - Fitting internal plate and GMAW C&B",
    "9 - Fitting and welding distribution box", 
    "10 - Tube support and bush fitting, tube sheet fitting",
    "11 - Tubesheet welding",
    "12 - Bracket and attachment welding",
    "13 - Unit side plate and base welding",
    "14 - Tube slotting and expansion",
  ]
};

/* ===== escape helper ===== */
function escapeHtml(s){
  return String(s ?? "")
    .replaceAll("&","&amp;")
    .replaceAll("<","&lt;")
    .replaceAll(">","&gt;")
    .replaceAll('"',"&quot;")
    .replaceAll("'","&#039;");
}

/* ===== dropdown stations ===== */
function renderStationOptions(){
  const stations = Object.keys(PROCESS_BY_STATION);
  const sel = el("stationPick");

  sel.innerHTML = stations.map(s =>
    `<option value="${s}">${escapeHtml(s)}</option>`
  ).join("");
}

/* ===== show process list ===== */
function renderProcessList(station){
  const container = el("processList");
  const list = PROCESS_BY_STATION[station] || [];

  if (!list.length){
    container.innerHTML = `<div class="hint">No process defined.</div>`;
    return;
  }

  container.innerHTML = `
    <div class="procBlock">
      <div class="procTitle">${escapeHtml(station)} Processes</div>

      <ul class="procUl">
        ${list.map(p => `<li>${escapeHtml(p)}</li>`).join("")}
      </ul>
    </div>
  `;
}

/* ===== INIT ===== */
function init(){
  renderStationOptions();

  const first = Object.keys(PROCESS_BY_STATION)[0];
  renderProcessList(first);

  el("stationPick").addEventListener("change", e=>{
    renderProcessList(e.target.value);
  });
}

init();
