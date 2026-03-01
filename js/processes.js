const el = (id) => document.getElementById(id);
// Use a short DOM helper so repeated element lookups stay readable.

/* ===== MASTER PROCESS LIST ===== */
// Keep this map as the single source for station -> ordered process steps.
// Vessel -> processes
const PROCESS_BY_PV = {
  "EVAPORATOR": [
    "6, 7, 8 - Hole bevelling, connector welding, fitting internal plate and GMAW C&B",
    "9, 10, 11 - Distribution box, tube support and bush, tubesheet fitting and welding",
    "12, 13 - Bracket, attachment, side plate, and base fitting and welding and copper tube brazing",
    "14 - Tube slotting and expansion",
    "15 - Primer painting",
    "16 - Pneumatic testing",
    "17 - Hydrostatic testing",
    "18, 19 - Primer (weld seam) and top painting"
  ],

   "CONDENSER": [
    "6, 7, 8 - Hole bevelling, connector welding, fitting internal plate and GMAW C&B",
    "9, 10, 11 - Distribution box, tube support and bush, tubesheet fitting and welding",
    "12, 13 - Bracket, attachment, side plate, and base fitting and welding and copper tube brazing",
    "14 - Tube slotting and expansion",
    "15 - Primer painting",
    "16 - Pneumatic testing",
    "17 - Hydrostatic testing",
    "18, 19 - Primer (weld seam) and top coat painting"
  ],

  "OIL SEPARATOR":[
    "6, 7 - Hole bevelling and connector welding",
    "8, 9, 10, 11 - Internal plate, distribution box, tube support and bush fitting and welding",
    "12 - Bracket and attachment fitting and welding",
    "15 - Primer painting",
    "16 - Pneumatic testing",
    "19 - Top coat painting"
  ],

  "ECONOMIZER":[
    "6, 7 - Hole bevelling and connector welding",
    "8, 9, 10, 11 - Internal plate, distribution box, tube support and bush fitting and welding",
    "12 - Bracket and attachment fitting and welding",
    "15 - Primer painting",
    "16 - Pneumatic testing",
    "19 - Top coat painting"
  ]
}

// CHILLER -> processes
const PROCESS_BY_CHILLER = {
  "AIR-COOLED": [
    "Piping shop",
    "Steel pipe cutting"
  ],
  "WATER-COOLED": [
    "Piping shop",
    "Steel pipe cutting"
  ]
};

/* ===== escape helper ===== */
// Escape strings before injecting into HTML to avoid broken markup.
function escapeHtml(s){
  return String(s ?? "")
    .replaceAll("&","&amp;")
    .replaceAll("<","&lt;")
    .replaceAll(">","&gt;")
    .replaceAll('"',"&quot;")
    .replaceAll("'","&#039;");
}

/* ===== dropdown stations ===== */
function renderCategoryOptions(){
  const sel = el("stationPick");

  const pvKeys = Object.keys(PROCESS_BY_PV);
  const chillerKeys = Object.keys(PROCESS_BY_CHILLER);

  sel.innerHTML = `
    <optgroup label="PV Units">
      ${pvKeys.map(k => `<option value="PV||${k}">${escapeHtml(k)}</option>`).join("")}
    </optgroup>
    <optgroup label="Chiller">
      ${chillerKeys.map(k => `<option value="CHILLER||${k}">${escapeHtml(k)}</option>`).join("")}
    </optgroup>
  `;
}

/* ===== show process list ===== */
function renderProcessList(value){
  const container = el("processList");

  const [kind, key] = value.split("||");

  let list = [];
  if (kind === "PV") {
    list = PROCESS_BY_PV[key] || [];
  } else if (kind === "CHILLER") {
    list = PROCESS_BY_CHILLER[key] || [];
  }

  if (!list.length){
    container.innerHTML = `<div class="hint">No process defined.</div>`;
    return;
  }

  container.innerHTML = `
    <div class="procBlock">
      <div class="procTitle">${escapeHtml(key)} Processes</div>
      <ul class="procUl">
        ${list.map(p => `<li>${escapeHtml(p)}</li>`).join("")}
      </ul>
    </div>
  `;
}

/* ===== INIT ===== */
function init(){
  renderCategoryOptions();

  const sel = el("stationPick");
  renderProcessList(sel.value);

  sel.addEventListener("change", e=>{
    renderProcessList(e.target.value);
  });
}

init();
