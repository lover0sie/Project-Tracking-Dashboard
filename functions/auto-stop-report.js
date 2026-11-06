const { createHash } = require("node:crypto");

// Report times use Malaysia time regardless of the server's location.
function localTime(ms) {
  return new Date(ms).toLocaleString("en-GB", {
    timeZone: "Asia/Kuala_Lumpur",
    hour12: true
  });
}

// Each process record receives a consistent audit ID when a check is retried.
function entryId(path) {
  return createHash("sha256").update(path).digest("hex");
}

// The audit stores the project and process details needed for the email report.
function candidateDetails(path, run, plan) {
  return {
    path,
    project: String(run.projectName || ""),
    serial: String(run.chillerSerialNumber || run.serialNumber || ""),
    itemSerial: String(run.serialNumber || ""),
    pvSerial: String(run.pvSerialNumber || ""),
    process: String(run.processName || ""),
    cutoffMs: plan.cutoffMs
  };
}

// The report counts each candidate under its saved auto-stop result.
function summarize(entries) {
  const summary = {
    candidates: entries.length,
    applied: 0,
    skipped: 0,
    failed: 0,
    pending: 0
  };

  for (const entry of entries) {
    if (Object.hasOwn(summary, entry.result) && entry.result !== "candidates") {
      summary[entry.result]++;
    }
  }

  return summary;
}

// These descriptions explain the saved results in the notification email.
const resultLabels = {
  applied: "Applied - placed on hold",
  skipped: "Skipped - no longer eligible",
  failed: "Failed - retry needed",
  pending: "Pending - not confirmed"
};

// The email contains the check summary followed by the result for each process.
function buildEmail(report, entries) {
  const summary = summarize(entries);
  const status = report.scanError ? "CHECK REQUIRED"
    : summary.failed || summary.pending ? "ATTENTION REQUIRED" : "COMPLETED";
  const subject = `Auto-stop ${status} | ${localTime(report.scheduledMs)} MYT`;

  // A failed scan requires attention even when no candidates were collected.
  const lines = [
    "AUTO-STOP REPORT",
    `Scheduled check: ${localTime(report.scheduledMs)} (Malaysia time)`,
    `Report prepared: ${localTime(report.finishedMs)} (Malaysia time)`,
    `Report ID: ${report.id}`,
    `Result: ${status}`,
    `Records checked: ${report.checked}`,
    `Candidates: ${summary.candidates} | Applied: ${summary.applied} | Skipped: ${summary.skipped} | Failed: ${summary.failed} | Pending: ${summary.pending}`,
    ""
  ];
  if (report.scanError) {
    lines.push("The record scan failed. This report cannot confirm that all eligible processes were checked.", "");
  }

  if (!entries.length && !report.scanError) {
    lines.push("No eligible processes required auto-stop for this check.", "");
  }

  // Candidates are listed by serial number and process name for easier review.
  for (const [index, entry] of [...entries].sort((a, b) => `${a.serial} ${a.process}`.localeCompare(`${b.serial} ${b.process}`)).entries()) {
    lines.push(
      `${index + 1}. ${entry.serial || "Unknown serial"} - ${entry.process || "Unknown process"}`,
      `   Project: ${entry.project || "Not recorded"}`,
      `   Item serial: ${entry.itemSerial || "Not recorded"} | PV serial: ${entry.pvSerial || "Not recorded"}`,
      `   Intended hold: ${localTime(entry.cutoffMs)} MYT`,
      `   Auto-stop result: ${resultLabels[entry.result] || "Unknown"}`
    );
    if (entry.appliedMs) {
      lines.push(`   Hold saved: ${localTime(entry.appliedMs)} MYT`);
    }

    if (entry.reason) {
      lines.push(`   Detail: ${entry.reason}`);
    }

    if (entry.errorCode) {
      lines.push(`   Error reference: ${entry.errorCode}`);
    }

    lines.push("");
  }
  // The closing notes distinguish a saved automatic hold from later job changes.
  lines.push(
    "Applied means the central system successfully saved the automatic hold. It does not mean the process was completed.",
    "This is a record of the scheduled check. A later resume or completion can change the process status afterwards.",
    "Painting exclusions and the existing shift rules still apply. Excluded processes are not listed as candidates.",
    "If an attempt fails, a later retry can produce an updated report for the same scheduled check."
  );

  return { subject, text: lines.join("\n"), summary };
}

module.exports = { entryId, candidateDetails, summarize, buildEmail };
