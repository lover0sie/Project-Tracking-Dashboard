import { PROCESS_BY_PV, PROCESS_BY_CHILLER } from "./pv-combined-list.js";

const el = (id) => document.getElementById(id);
// Use a short DOM helper so repeated element lookups stay readable.


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
