const { entryId, candidateDetails, buildEmail } = require("./auto-stop-report.js");

// The scheduled check saves each hold and its audit entry together.
// A repeated check retains the original candidate list and successful results.
async function runAutoStop({ db, fieldValue, logger, scheduledMs, clock = Date.now }) {
  const { autoStopPlan, autoHoldFields, malaysiaDateKey } = await import("./auto-stop-policy.mjs");

  if (!Number.isFinite(scheduledMs)) {
    throw new Error("A valid scheduler time is required.");
  }

  // The scheduled time identifies the report, including any retries of that check.
  const dateKey = malaysiaDateKey(scheduledMs);
  const id = String(scheduledMs);
  const reportRef = db.collection("_autoStopReports").doc(id);
  const entriesRef = reportRef.collection("entries");

  await reportRef.set({ id, dateKey, scheduledMs, lastStartedMs: clock() }, { merge: true });

  let checked = 0;
  let scanError = "";

  try {
    const snapshot = await db.collectionGroup("runs").get();
    checked = snapshot.size;

    // The candidate list is saved before holds are applied so an interrupted
    // check can resume without losing records that have already been processed.
    for (const candidate of snapshot.docs) {
      const plan = autoStopPlan(candidate.data(), scheduledMs, dateKey);

      if (!plan) {
        continue;
      }

      const ref = entriesRef.doc(entryId(candidate.ref.path));
      await db.runTransaction(async transaction => {
        const existing = await transaction.get(ref);

        if (!existing.exists) {
          transaction.set(ref, {
            ...candidateDetails(candidate.ref.path, candidate.data(), plan),
            result: "pending"
          });
        }
      });
    }
  } catch (error) {
    scanError = String(error.code || "scan_failed");
    logger.error("Scheduled Auto Stop candidate scan failed", { reportId: id, code: scanError });
  }

  // Previously applied or skipped records do not receive another automatic hold.
  const candidates = await entriesRef.get();

  for (const candidate of candidates.docs) {
    const entry = candidate.data();

    if (entry.result === "applied" || entry.result === "skipped") {
      continue;
    }

    try {
      await db.runTransaction(async transaction => {
        const audit = await transaction.get(candidate.ref);

        if (["applied", "skipped"].includes(audit.data()?.result)) {
          return;
        }

        // The latest process status is checked again before any hold is saved.
        const current = await transaction.get(db.doc(entry.path));
        const plan = current.exists && autoStopPlan(current.data(), scheduledMs, dateKey);

        if (!plan || plan.cutoffMs !== entry.cutoffMs) {
          transaction.update(candidate.ref, {
            result: "skipped",
            reason: current.exists
              ? `Process changed before auto-stop (status: ${String(current.data().status || "unknown")}).`
              : "Process record was removed before auto-stop.",
            checkedMs: clock(),
            errorCode: ""
          });

          return;
        }

        // Both writes succeed together, preserving proof that the hold applied.
        const appliedMs = clock();
        const update = autoHoldFields(plan, appliedMs, {}, "scheduled_auto_stop");
        transaction.update(current.ref, { ...update.fields, holds: fieldValue.arrayUnion(update.hold) });
        transaction.update(candidate.ref, { result: "applied", appliedMs, reason: "", errorCode: "" });
      });
    } catch (error) {
      const code = String(error.code || "unknown");

      // A failed attempt cannot replace another attempt's successful result.
      await db.runTransaction(async transaction => {
        const latest = await transaction.get(candidate.ref);

        if (!["applied", "skipped"].includes(latest.data()?.result)) {
          transaction.update(candidate.ref, { result: "failed", errorCode: code, checkedMs: clock() });
        }
      });

      logger.error("Scheduled Auto Stop could not update a run", { path: entry.path, code, reportId: id });
    }
  }

  // The email is built from saved outcomes rather than the original running list.
  const finalEntries = (await entriesRef.get()).docs.map(doc => doc.data());
  const report = { id, dateKey, scheduledMs, checked, scanError, finishedMs: clock() };
  const email = buildEmail(report, finalEntries);

  // Matching results produce the same notification ID and avoid another email.
  // A changed result after recovery produces a new notification for review.
  const { createHash } = require("node:crypto");
  const fingerprint = createHash("sha256").update(JSON.stringify({
    scanError,
    entries: finalEntries
      .map(({ path, result, appliedMs = null, errorCode = "" }) => ({ path, result, appliedMs, errorCode }))
      .sort((a, b) => a.path.localeCompare(b.path))
  })).digest("hex");
  const notificationRef = db.collection("_autoStopNotifications").doc(`${id}_${fingerprint}`);

  // The notification waits in a separate collection for the email worker.
  await db.runTransaction(async transaction => {
    const notification = await transaction.get(notificationRef);

    if (!notification.exists) {
      transaction.set(notificationRef, {
        reportId: id,
        subject: email.subject,
        text: email.text,
        createdMs: report.finishedMs,
        status: "pending"
      });
    }
  });

  await reportRef.set({ ...report, ...email.summary, status: scanError || email.summary.failed || email.summary.pending ? "attention_required" : "completed" }, { merge: true });
  logger.info("Scheduled Auto Stop finished", { dateKey, checked, updated: email.summary.applied, failed: email.summary.failed, reportId: id, scanError });

  // An incomplete check requests a scheduler retry after saving its report.
  if (scanError || email.summary.failed || email.summary.pending) {
    throw new Error(`Scheduled Auto Stop needs retry; report ${id}.`);
  }

  return { report, entries: finalEntries, email };
}

module.exports = { runAutoStop };
