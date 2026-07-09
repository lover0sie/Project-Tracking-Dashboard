const el = (id) => document.getElementById(id);
// Use a short DOM helper so repeated element lookups stay readable.

/* ===== MASTER PROCESS LIST ===== */
// Keep this map as the single source for station -> ordered process steps.
// Vessel -> processes
const PROCESS_BY_PV = {
  "EVAPORATOR": [
    "6A - Hole bevelling",
    "6B - Fitting flange and piping",
    "7 - Connector welding",
    "8A - Internal plate assembly",
    "8B - Fitting internal plate",
    "8C - GMAW C&B",
    "9A - Distribution box assembly",
    "9B - Fitting and welding distribution box",
    "10 - Tube support, bush fitting, and tube sheet fitting",
    "11 - Tubesheet welding",
    "12 - Bracket and attachment welding, copper tube brazing",
    "13 - Unit side plate and base welding",
    "14A - Tube slotting",
    "14B - Tube expansion",
    "14C - Shell body slotting",
    "15 - Primer painting",
    "16 - Pneumatic testing",
    "17 - Hydrostatic testing",
    "18, 19 - Primer painting (weld seam) and top coat painting"
  ],

  "CONDENSER": [
    "6A - Hole bevelling",
    "6B - Fitting flange and piping",
    "7 - Connector welding",
    "8A - Internal plate assembly",
    "8B - Fitting internal plate",
    "8C - GMAW C&B",
    "10 - Tube support, bush fitting, and tube sheet fitting",
    "11 - Tubesheet welding",
    "12 - Bracket and attachment welding, copper tube brazing",
    "13 - Unit side plate and base welding",
    "14A - Tube slotting",
    "14B - Tube expansion",
    "14C - Shell body slotting",
    "15 - Primer painting",
    "16 - Pneumatic testing",
    "17 - Hydrostatic testing",
    "18, 19 - Primer painting (weld seam) and top coat painting"
  ],

  "OIL SEPARATOR": [
    "6, 7 - Hole bevelling and connector welding",
    "8, 9, 10, 11 - Internal plate, distribution box, tube support and bush fitting and welding",
    "12 - Bracket and attachment fitting and welding",
    "15 - Primer painting",
    "16 - Pneumatic testing",
    "19 - Top coat painting"
  ],

  "ECONOMIZER": [
    "6, 7 - Hole bevelling and connector welding",
    "8, 9, 10, 11 - Internal plate, distribution box, tube support and bush fitting and welding",
    "12 - Bracket and attachment fitting and welding",
    "15 - Primer painting",
    "16 - Pneumatic testing",
    "19 - Top coat painting"
  ]
}

// CHILLER -> processes
export const PROCESS_BY_CHILLER = {
   "AIR-COOLED": [
    "Piping shop",
    "A1 - Coil assembly (Fan assembly)",
    "A2 - Coil assembly (Fan wiring)",
    "B1 - High-side assembly (Compressor assembly)",
    "B2 - High-side assembly (Evaporator assembly)",
    "B3 - High-side assembly (Piping assembly)",
    "B4 - High-side assembly (Wiring base)",
    "C1 - Brazing assembly (Brazing base)",
    "C2 - Brazing assembly (Brazing coil)",
    "D1 - Final assembly (Hoist coil onto base)",
    "D2 - Final assembly (Final brazing)",
    "D3 - Final assembly (Accessories assembly)",
    "D4 - Final assembly (Wiring control box)",
    "D5 - Final assembly (Panel installation)",
    "D6 - Final assembly (Pipe insulation)",
    "H1 - Wipe, sanding, polish, paste tape and plastic, and spray paint",
    "H2 - Remove tape and plastic, attach acrylic, organize wires, attach cap, and paste unit stickers",
    "H3 - Wrap the unit"
  ],
  
  "WATER-COOLED": [
    "Piping shop",
    "Steel pipe sub-assembly",
    "A - Insulation compressor",
    "B - Insulation evaporator, piping, and economizer/oil separator",
    "C - Major components assembly",
    "D - Steel pipe welding",
    "E - Copper pipe brazing",
    "F - Control box and wiring",
    "G - Piping insulation",
    "H1 - Wipe, sanding, polish, paste tape and plastic, and spray paint",
    "H2 - Remove tape and plastic, attach acrylic, organize wires, attach cap, and paste unit stickers",
    "H3 - Wrap the unit"
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

function splitProcessLabel(label) {
  const text = String(label || "").trim();
  const match = text.match(/^(.+?)\s+-\s+(.+)$/);

  if (!match) {
    return { code: "", name: text };
  }

  return {
    code: match[1].trim(),
    name: match[2].trim()
  };
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
        ${list.map(p => {
          const { code, name } = splitProcessLabel(p);

          return `
            <li>
              ${code ? `<span class="procNoBadge">${escapeHtml(code)}</span>` : ""}
              <span class="procStepText">${escapeHtml(name)}</span>
            </li>
          `;
        }).join("")}
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
