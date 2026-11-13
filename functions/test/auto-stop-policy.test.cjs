const { test } = require("node:test");
const assert = require("node:assert/strict");

const HOUR_MS = 3600000;
const startEpochMs = Date.parse("2026-11-05T09:00:00+08:00");
const cutoffMs = Date.parse("2026-11-06T12:00:00+08:00");
const nowMs = Date.parse("2026-11-07T15:00:00+08:00");

test("Running Cleanup preserves accumulated time and adds only the latest segment through the selected cutoff", async () => {
  const { runningCleanupPlan, autoHoldFields } = await import("../auto-stop-policy.mjs");
  const run = {
    status: "running", startEpochMs, durationMs: 3 * HOUR_MS,
    resumedEpochMs: startEpochMs + HOUR_MS,
    resumes: [
      { resumedAtEpochMs: startEpochMs + 2 * HOUR_MS },
      { resumedAtEpochMs: startEpochMs + HOUR_MS }
    ]
  };
  const plan = runningCleanupPlan(run, cutoffMs, nowMs);
  const update = autoHoldFields(run, plan, nowMs, { uid: "reviewer" }, "running_cleanup");
  assert.equal(update.fields.durationMs, 28 * HOUR_MS);
  assert.equal(update.fields.status, "on_hold");
  assert.equal(update.fields.holdEpochMs, cutoffMs);
  assert.equal(update.hold.holdAtEpochMs, cutoffMs);
  assert.equal(update.fields.autoStopAppliedAtEpochMs, nowMs);
  assert.equal(update.fields.autoStopSource, "running_cleanup");
  assert.throws(() => runningCleanupPlan({ ...run, ...update.fields }, cutoffMs, nowMs), /no longer eligible/);
});

test("Running Cleanup calculates the first segment when no duration has been saved", async () => {
  const { runningCleanupPlan, autoHoldFields } = await import("../auto-stop-policy.mjs");
  const run = { status: "running", startEpochMs };
  const plan = runningCleanupPlan(run, cutoffMs, nowMs);
  assert.equal(autoHoldFields(run, plan, nowMs).fields.durationMs, 27 * HOUR_MS);
});

test("Running Cleanup rejects cutoffs before the latest resume or after now", async () => {
  const { runningCleanupPlan } = await import("../auto-stop-policy.mjs");
  const run = { status: "running", startEpochMs, resumedEpochMs: startEpochMs + HOUR_MS };
  for (const invalidCutoff of [startEpochMs, run.resumedEpochMs, nowMs + 1]) {
    assert.throws(() => runningCleanupPlan(run, invalidCutoff, nowMs), /hold time must be after/);
  }
});
