const TIME_ZONE = "Asia/Kuala_Lumpur";
const HOUR_MS = 60 * 60 * 1000;

export function timestampMs(value) {
  if (value === null || value === undefined || value === "") return null;
  if (typeof value === "boolean") return null;
  const parsed = typeof value.toMillis === "function" ? value.toMillis()
    : typeof value.toDate === "function" ? value.toDate().getTime() : Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

export function malaysiaDateKey(epochMs = Date.now()) {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: TIME_ZONE, year: "numeric", month: "2-digit", day: "2-digit"
  }).formatToParts(new Date(epochMs));
  const read = type => parts.find(part => part.type === type).value;
  return `${read("year")}-${read("month")}-${read("day")}`;
}

// Add here to adjust for processes that should not be auto-stopped even if they are running past the shift cutoff.
// After change, redeploy: firebase deploy --only "functions:employee-login:autoStopDayShift,functions:employee-login:autoStopEveningShift" --project qrcodetesting-4f86e
export function isAutoStopExcluded(run) {
  const process = String(run.processName || "").replace(/\s+/g, " ").trim().toLowerCase();
  return process.startsWith("15 - primer painting")
    || process.startsWith("18, 19 - primer painting (weld seam) and top coat painting")
    || process.startsWith("19 - top coat painting");
}

export function activeStartMs(run) {
  const start = timestampMs(run.startEpochMs) ?? timestampMs(run.startAt);
  if (start === null) return null;
  const times = [start];
  const legacyResume = timestampMs(run.resumedEpochMs) ?? timestampMs(run.resumedAt);
  if (legacyResume !== null) times.push(legacyResume);
  for (const resume of Array.isArray(run.resumes) ? run.resumes : []) {
    const resumed = timestampMs(resume.resumedAtEpochMs) ?? timestampMs(resume.resumedAt);
    if (resumed !== null) times.push(resumed);
  }
  return Math.max(...times);
}

export function isOverdueRunning(run, nowMs = Date.now()) {
  const start = activeStartMs(run);
  return String(run.status || "").trim().toLowerCase() === "running"
    && start !== null && nowMs - start > 24 * HOUR_MS;
}

export function shiftCutoff(run) {
  const start = activeStartMs(run);
  if (start === null) return null;
  const dateKey = malaysiaDateKey(start);
  const dayEnd = Date.parse(`${dateKey}T17:30:00+08:00`);
  const nightEnd = Date.parse(`${dateKey}T21:30:00+08:00`);
  if (start < dayEnd) return { cutoffMs: dayEnd, type: "shift_end", dateKey };
  if (start < nightEnd) return { cutoffMs: nightEnd, type: "night_shift_end", dateKey };
  return null;
}

export function autoStopPlan(run, nowMs = Date.now(), dateKey = malaysiaDateKey(nowMs)) {
  if (String(run.status || "").trim().toLowerCase() !== "running" || isAutoStopExcluded(run)) return null;
  const cutoff = shiftCutoff(run);
  if (!cutoff || cutoff.dateKey !== dateKey || cutoff.cutoffMs > nowMs) return null;
  if (run.autoStopType === cutoff.type && timestampMs(run.autoStopAtEpochMs) === cutoff.cutoffMs) return null;
  return cutoff;
}

export function runningCleanupPlan(run, cutoffMs, nowMs = Date.now()) {
  if (!isOverdueRunning(run, nowMs)) {
    throw new Error("This process is no longer eligible for Running Cleanup.");
  }
  const start = activeStartMs(run);
  if (!Number.isFinite(cutoffMs) || cutoffMs <= start || cutoffMs > nowMs) {
    throw new Error("The hold time must be after the latest start/resume and no later than now.");
  }
  const suggested = shiftCutoff(run);
  return {
    cutoffMs,
    type: suggested?.cutoffMs === cutoffMs ? suggested.type : "running_cleanup",
    dateKey: malaysiaDateKey(cutoffMs)
  };
}

export function autoHoldFields(plan, appliedAtMs, actor = {}, source = "auto_stop") {
  const appliedAt = new Date(appliedAtMs).toLocaleString("en-MY", { timeZone: TIME_ZONE });
  const cutoffAt = new Date(plan.cutoffMs).toLocaleString("en-MY", { timeZone: TIME_ZONE });
  const remarks = `Auto hold at shift cutoff ${cutoffAt}; applied at ${appliedAt}`;
  return {
    hold: {
      holdAtEpochMs: plan.cutoffMs,
      holdReason: "end_of_shift",
      remarks,
      byName: actor.name || "SYSTEM",
      byNumber: actor.employeeId || "SYSTEM"
    },
    fields: {
      status: "on_hold",
      holdReason: "end_of_shift",
      holdEpochMs: plan.cutoffMs,
      autoStopped: true,
      autoStopType: plan.type,
      autoStopAtEpochMs: plan.cutoffMs,
      autoStopAppliedAtEpochMs: appliedAtMs,
      autoStopSource: source,
      autoStopByUid: actor.uid || "SYSTEM"
    }
  };
}
