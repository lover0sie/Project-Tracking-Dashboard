import { initializeApp } from "https://www.gstatic.com/firebasejs/9.23.0/firebase-app.js";
import { getFirestore, collection, getDocs } from "https://www.gstatic.com/firebasejs/9.23.0/firebase-firestore.js";

/* Firebase config */
const firebaseConfig = {
  apiKey: "AIzaSyBePrEYgwU4tD9h82n9PbjfxtTyQMXm6Kk",
  authDomain: "qrcodetesting-4f86e.firebaseapp.com",
  projectId: "qrcodetesting-4f86e",
  storageBucket: "qrcodetesting-4f86e.firebasestorage.app",
  messagingSenderId: "746921254909",
  appId: "1:746921254909:web:7acce026b9d96c97880394"
};

const app = initializeApp(firebaseConfig);
const db = getFirestore(app);

const el = (id) => document.getElementById(id);

function escapeHtml(s) {
  return String(s ?? "")
    .replaceAll("&","&amp;")
    .replaceAll("<","&lt;")
    .replaceAll(">","&gt;")
    .replaceAll('"',"&quot;")
    .replaceAll("'","&#039;");
}

function normStation(s){
  return String(s || "").trim().toUpperCase().replace(/\s+/g," ");
}

async function loadRuns(){
  const snap = await getDocs(collection(db, "processRuns"));
  const runs = [];
  snap.forEach(d => runs.push(d.data()));
  return runs;
}

function getStations(runs){
  const set = new Set();
  for (const r of runs) {
    const st = normStation(r.station);
    if (st) set.add(st);
  }
  return [...set].sort((a,b) => a.localeCompare(b));
}

function getProcessesForStation(runs, station){
  const set = new Set();
  for (const r of runs) {
    if (normStation(r.station) !== station) continue;
    const name = String(r.processName || "").trim();
    if (name) set.add(name);
  }
  return [...set].sort((a,b) => a.localeCompare(b));
}

function renderStationOptions(stations, preferred){
  const sel = el("stationPick");
  sel.innerHTML = stations.map(s => {
    const selected = (s === preferred) ? "selected" : "";
    return `<option value="${escapeHtml(s)}" ${selected}>${escapeHtml(s)}</option>`;
  }).join("");
}

function renderProcessList(station, processes){
  const container = el("processList");

  if (!processes.length) {
    container.innerHTML = `<div class="hint">No processes found for ${escapeHtml(station)}.</div>`;
    return;
  }

  container.innerHTML = `
    <div class="procBlock">
      <div class="procTitle">${escapeHtml(station)} Processes</div>
      <ol class="procOl">
        ${processes.map(p => `<li>${escapeHtml(p)}</li>`).join("")}
      </ol>
    </div>
  `;
}

async function main(){
  const runs = await loadRuns();

  const stations = getStations(runs);
  if (!stations.length) {
    el("processList").innerHTML = `<div class="hint">No station data found in processRuns.</div>`;
    return;
  }

  // default: PV 1 if exists, otherwise first station
  const defaultStation = stations.includes("PV 1") ? "PV 1" : stations[0];

  renderStationOptions(stations, defaultStation);
  renderProcessList(defaultStation, getProcessesForStation(runs, defaultStation));

  el("stationPick").addEventListener("change", (e) => {
    const station = e.target.value;
    const processes = getProcessesForStation(runs, station);
    renderProcessList(station, processes);
  });
}

main().catch(console.error);
