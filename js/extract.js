import { db } from "./firebase.js";
import { assertLevel3Access } from "./access-control.js";
import {
  collectionGroup,
  doc,
  getDocs,
  orderBy,
  query,
  writeBatch,
  where
} from "https://www.gstatic.com/firebasejs/11.6.0/firebase-firestore.js";

const serialInput = document.getElementById("serialNumber");
const fromDateInput = document.getElementById("fromDate");
const toDateInput = document.getElementById("toDate");
const jsonFileInput = document.getElementById("jsonFile");
const projectNameFilterInput = document.getElementById("projectNameFilter");
const targetProjectIdInput = document.getElementById("targetProjectId");
const statusEl = document.getElementById("status");
const previewWrap = document.querySelector(".preview");
const previewEl = document.getElementById("preview");
const importStatusEl = document.getElementById("importStatus");
const importPreviewWrap = document.getElementById("importPreviewWrap");
const importPreviewEl = document.getElementById("importPreview");
const importConfirmEl = document.getElementById("importConfirm");
const importConfirmTextEl = document.getElementById("importConfirmText");
const importButton = document.getElementById("btnImportJson");
const buttons = Array.from(document.querySelectorAll(".extractShell button"));
let pendingImport = null;

document
  .getElementById("btnExportFiltered")
  .addEventListener("click", () => exportRuns({ useFilters: true }));

document
  .getElementById("btnExportAll")
  .addEventListener("click", () => exportRuns({ useFilters: false }));

document
  .getElementById("btnImportJson")
  .addEventListener("click", importMatchingJsonToProject);

document
  .getElementById("btnCountJson")
  .addEventListener("click", countMatchingJsonRecords);

document
  .getElementById("btnConfirmImport")
  .addEventListener("click", confirmPendingImport);

document
  .getElementById("btnCancelImport")
  .addEventListener("click", cancelPendingImport);

targetProjectIdInput.addEventListener("input", updateImportButtonLabel);
updateImportButtonLabel();

async function exportRuns({ useFilters }) {
  setBusy(true);
  setStatus("Reading Firestore...");

  try {
    await assertLevel3Access();
    const filters = useFilters ? getFilters() : {};
    const snapshot = await getDocs(buildRunsQuery(filters));
    const rows = [];

    snapshot.forEach(docSnap => {
      const row = {
        documentId: docSnap.id,
        documentPath: docSnap.ref.path,
        ...convertFirestoreValue(docSnap.data())
      };

      if (matchesSerialFilter(row, filters.serialNumber)) {
        rows.push(row);
      }
    });

    if (!rows.length) {
      setStatus("No records found for the selected filters.", "error");
      showPreview([]);
      return;
    }

    rows.sort((a, b) => {
      return Number(a.startEpochMs || 0) - Number(b.startEpochMs || 0);
    });

    const filename = buildFilename(filters);
    downloadJson(rows, filename);
    showPreview(rows.slice(0, 5));
    setStatus(`Exported ${rows.length} record(s) to ${filename}.`, "success");
  } catch (error) {
    console.error(error);
    setStatus(`Error: ${error.message}`, "error");
  } finally {
    setBusy(false);
  }
}

function buildRunsQuery(filters) {
  const constraints = [];
  const fromMs = dateToStartMs(filters.fromDate);
  const toMs = dateToEndMs(filters.toDate);

  if (fromMs !== null) {
    constraints.push(where("startEpochMs", ">=", fromMs));
  }

  if (toMs !== null) {
    constraints.push(where("startEpochMs", "<=", toMs));
  }

  if (constraints.length) {
    constraints.push(orderBy("startEpochMs", "asc"));
  }

  return constraints.length
    ? query(collectionGroup(db, "runs"), ...constraints)
    : query(collectionGroup(db, "runs"));
}

function getFilters() {
  return {
    serialNumber: serialInput.value.trim().toUpperCase(),
    fromDate: fromDateInput.value,
    toDate: toDateInput.value
  };
}

function matchesSerialFilter(row, serialNumber) {
  if (!serialNumber) return true;

  const values = [
    row.documentId,
    row.serial,
    row.serialNumber,
    row.chillerSerialNumber,
    row.pvSerialNumber
  ];

  return values.some(value => {
    return String(value || "").trim().toUpperCase().includes(serialNumber);
  });
}

function dateToStartMs(dateValue) {
  if (!dateValue) return null;
  return new Date(`${dateValue}T00:00:00`).getTime();
}

function dateToEndMs(dateValue) {
  if (!dateValue) return null;
  return new Date(`${dateValue}T23:59:59.999`).getTime();
}

function buildFilename(filters = {}) {
  const parts = ["firebase_runs"];

  if (filters.serialNumber) {
    parts.push(filters.serialNumber);
  }

  if (filters.fromDate || filters.toDate) {
    parts.push(`${filters.fromDate || "start"}_to_${filters.toDate || "end"}`);
  }

  parts.push(new Date().toISOString().slice(0, 10));

  return `${parts.join("_")}.json`;
}

function downloadJson(data, filename) {
  const blob = new Blob([JSON.stringify(data, null, 2)], {
    type: "application/json"
  });

  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");

  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

async function importMatchingJsonToProject() {
  const file = jsonFileInput.files[0];
  const projectName = projectNameFilterInput.value.trim();
  const targetProjectId = targetProjectIdInput.value.trim().toUpperCase();

  if (!file) {
    setImportStatus("Please select the extracted JSON file first.", "error");
    return;
  }

  if (!projectName) {
    setImportStatus("Please enter the project name to move.", "error");
    return;
  }

  if (!targetProjectId) {
    setImportStatus("Please enter the target processRuns document.", "error");
    return;
  }

  clearPendingImport();
  setBusy(true);
  setImportStatus("Reading JSON file...");

  try {
    const rows = await readJsonFile(file);
    const matchingRows = getMatchingProjectRows(rows, projectName)
      .map(row => prepareRunForProject(row, targetProjectId));

    if (!matchingRows.length) {
      setImportStatus(`No JSON records found for projectName "${projectName}".`, "error");
      showImportPreview([]);
      return;
    }

    pendingImport = {
      rows: matchingRows,
      targetProjectId,
      projectName
    };

    showImportPreview(matchingRows.slice(0, 5));
    showImportConfirm(
      `Import ${matchingRows.length} record(s) into processRuns/${targetProjectId}/runs? Existing documents with the same IDs will be overwritten.`
    );
    setImportStatus(`Found ${matchingRows.length} matching record(s). Confirm below to write to Firestore.`, "success");
  } catch (error) {
    console.error(error);
    setImportStatus(`Error: ${error.message}`, "error");
  } finally {
    setBusy(false);
  }
}

async function countMatchingJsonRecords() {
  const file = jsonFileInput.files[0];
  const projectName = projectNameFilterInput.value.trim();

  if (!file) {
    setImportStatus("Please select the extracted JSON file first.", "error");
    return;
  }

  if (!projectName) {
    setImportStatus("Please enter the project name to count.", "error");
    return;
  }

  clearPendingImport();
  setBusy(true);
  setImportStatus("Counting matching JSON records...");

  try {
    const rows = await readJsonFile(file);
    const matchingRows = getMatchingProjectRows(rows, projectName);
    const projectCounts = countProjectNames(rows);

    showImportPreview({
      matchingCount: matchingRows.length,
      projectName,
      matchingPreview: matchingRows.slice(0, 5),
      allProjectNames: projectCounts
    });

    setImportStatus(
      `Found ${matchingRows.length} record(s) matching "${projectName}" in the JSON file.`,
      matchingRows.length ? "success" : "error"
    );
  } catch (error) {
    console.error(error);
    setImportStatus(`Error: ${error.message}`, "error");
  } finally {
    setBusy(false);
  }
}

function getMatchingProjectRows(rows, projectName) {
  const targetName = normalizeProjectName(projectName);

  return rows.filter(row => {
    return normalizeProjectName(row.projectName) === targetName;
  });
}

function normalizeProjectName(value) {
  return String(value || "")
    .normalize("NFKC")
    .replace(/\s+/g, " ")
    .trim()
    .toUpperCase();
}

function countProjectNames(rows) {
  const counts = {};

  rows.forEach(row => {
    const projectName = String(row.projectName || "(blank)").trim() || "(blank)";
    counts[projectName] = (counts[projectName] || 0) + 1;
  });

  return counts;
}

function readJsonFile(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();

    reader.onload = () => {
      try {
        const parsed = JSON.parse(reader.result);

        if (!Array.isArray(parsed)) {
          reject(new Error("JSON file must contain an array of records."));
          return;
        }

        resolve(parsed);
      } catch (error) {
        reject(error);
      }
    };

    reader.onerror = () => reject(reader.error);
    reader.readAsText(file);
  });
}

function prepareRunForProject(row, targetProjectId) {
  const {
    documentId,
    documentPath,
    ...data
  } = row;

  if (!documentId) {
    throw new Error("A matching JSON record is missing documentId.");
  }

  return {
    documentId,
    ...data,
    chillerSerialNumber: targetProjectId
  };
}

async function writeRowsToProject(rows, targetProjectId, projectName) {
  await assertLevel3Access();
  const maxBatchSize = 450;

  for (let i = 0; i < rows.length; i += maxBatchSize) {
    const batch = writeBatch(db);
    const chunk = rows.slice(i, i + maxBatchSize);

    if (i === 0) {
      batch.set(
        doc(db, "processRuns", targetProjectId),
        {
          chillerSerialNumber: targetProjectId,
          projectName
        },
        { merge: true }
      );
    }

    chunk.forEach(row => {
      const {
        documentId,
        ...data
      } = row;

      const targetRef = doc(
        db,
        "processRuns",
        targetProjectId,
        "runs",
        documentId
      );

      batch.set(targetRef, data, { merge: true });
    });

    await batch.commit();
  }
}

function convertFirestoreValue(value) {
  if (value === null || value === undefined) return value;

  if (typeof value === "object" && typeof value.toDate === "function") {
    return value.toDate().toISOString();
  }

  if (Array.isArray(value)) {
    return value.map(item => convertFirestoreValue(item));
  }

  if (typeof value === "object") {
    const result = {};

    for (const [key, item] of Object.entries(value)) {
      result[key] = convertFirestoreValue(item);
    }

    return result;
  }

  return value;
}

function showPreview(rows) {
  previewWrap.hidden = false;
  previewEl.textContent = JSON.stringify(rows, null, 2);
}

function showImportPreview(rows) {
  importPreviewWrap.hidden = false;
  importPreviewEl.textContent = JSON.stringify(rows, null, 2);
}

function setStatus(message, tone = "") {
  statusEl.textContent = message;
  statusEl.className = tone;
}

function setImportStatus(message, tone = "") {
  importStatusEl.textContent = message;
  importStatusEl.className = `statusLine ${tone}`.trim();
}

function showImportConfirm(message) {
  importConfirmTextEl.textContent = message;
  importConfirmEl.hidden = false;
}

function hideImportConfirm() {
  importConfirmTextEl.textContent = "";
  importConfirmEl.hidden = true;
}

function clearPendingImport() {
  pendingImport = null;
  hideImportConfirm();
}

async function confirmPendingImport() {
  if (!pendingImport) {
    setImportStatus("No pending import to confirm.", "error");
    return;
  }

  setBusy(true);
  hideImportConfirm();
  setImportStatus(`Writing ${pendingImport.rows.length} record(s) to Firestore...`);

  try {
    await writeRowsToProject(
      pendingImport.rows,
      pendingImport.targetProjectId,
      pendingImport.projectName
    );

    showImportPreview(pendingImport.rows.slice(0, 5));
    setImportStatus(
      `Imported ${pendingImport.rows.length} record(s) into processRuns/${pendingImport.targetProjectId}/runs.`,
      "success"
    );
    pendingImport = null;
  } catch (error) {
    console.error(error);
    setImportStatus(`Error: ${error.message}`, "error");
  } finally {
    setBusy(false);
  }
}

function cancelPendingImport() {
  clearPendingImport();
  setImportStatus("Import cancelled.");
}

function updateImportButtonLabel() {
  const targetProjectId = targetProjectIdInput.value.trim().toUpperCase();
  importButton.textContent = targetProjectId
    ? `Import Matching JSON To ${targetProjectId}`
    : "Import Matching JSON";
}

function setBusy(isBusy) {
  buttons.forEach(button => {
    button.disabled = isBusy;
  });
}
