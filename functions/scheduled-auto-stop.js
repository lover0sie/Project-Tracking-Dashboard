const { getFirestore, FieldValue } = require("firebase-admin/firestore");
const { onSchedule } = require("firebase-functions/v2/scheduler");
const logger = require("firebase-functions/logger");
const { runAutoStop } = require("./auto-stop-runner.js");

// Each scheduled event passes its original check time to the auto-stop runner.
// Retries use that same time so the correct shift and audit report are retained.
async function applyScheduledAutoStop(event) {
  return runAutoStop({
    db: getFirestore(),
    fieldValue: FieldValue,
    logger,
    scheduledMs: Date.parse(event.scheduleTime)
  });
}

// Both shifts use Malaysia time and the same timeout and retry settings.
const options = {
  region: "asia-southeast1",
  timeZone: "Asia/Kuala_Lumpur",
  timeoutSeconds: 540,
  maxInstances: 1,
  retryCount: 3,
  minBackoffSeconds: 60,
  maxBackoffSeconds: 300
};

// The day-shift check runs at 5:30 PM each day.
exports.autoStopDayShift = onSchedule({ ...options, schedule: "30 17 * * *" }, applyScheduledAutoStop);

// The evening-shift check runs at 9:30 PM each day.
exports.autoStopEveningShift = onSchedule({ ...options, schedule: "30 21 * * *" }, applyScheduledAutoStop);
