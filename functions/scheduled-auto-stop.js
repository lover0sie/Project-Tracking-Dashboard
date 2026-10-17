const { getFirestore, FieldValue } = require("firebase-admin/firestore");
const { onSchedule } = require("firebase-functions/v2/scheduler");
const logger = require("firebase-functions/logger");

async function applyScheduledAutoStop(event) {
  const { autoStopPlan, autoHoldFields, malaysiaDateKey } = await import("./auto-stop-policy.mjs");
  const db = getFirestore();
  const scheduledMs = Date.parse(event.scheduleTime);
  if (!Number.isFinite(scheduledMs)) throw new Error("A valid scheduler time is required.");
  const dateKey = malaysiaDateKey(scheduledMs);
  const snapshot = await db.collectionGroup("runs").get();
  let updated = 0;
  let failed = 0;
  for (const candidate of snapshot.docs) {
    if (!autoStopPlan(candidate.data(), scheduledMs, dateKey)) continue;
    try {
      const changed = await db.runTransaction(async transaction => {
        const current = await transaction.get(candidate.ref);
        if (!current.exists) return false;
        const plan = autoStopPlan(current.data(), scheduledMs, dateKey);
        if (!plan) return false;
        const update = autoHoldFields(plan, Date.now(), {}, "scheduled_auto_stop");
        transaction.update(candidate.ref, { ...update.fields, holds: FieldValue.arrayUnion(update.hold) });
        return true;
      });
      if (changed) updated++;
    } catch (error) {
      failed++;
      logger.error("Scheduled Auto Stop could not update a run", { path: candidate.ref.path, code: String(error.code || "unknown") });
    }
  }
  logger.info("Scheduled Auto Stop finished", { dateKey, checked: snapshot.size, updated, failed });
  if (failed) throw new Error(`Scheduled Auto Stop could not update ${failed} runs; retry required.`);
}

const options = {
  region: "asia-southeast1",
  timeZone: "Asia/Kuala_Lumpur",
  timeoutSeconds: 540,
  maxInstances: 1,
  retryCount: 3,
  minBackoffSeconds: 60,
  maxBackoffSeconds: 300
};

exports.autoStopDayShift = onSchedule({ ...options, schedule: "30 17 * * *" }, applyScheduledAutoStop);
exports.autoStopEveningShift = onSchedule({ ...options, schedule: "30 21 * * *" }, applyScheduledAutoStop);
