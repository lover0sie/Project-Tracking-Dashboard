/* Helpers shared across different js */

/* Helpers for time */

const TZ = "Asia/Kuala_Lumpur";
const START_HOUR = 8;
const END_HOUR = 21;

// Update to accept epoch long int
export function tsOrMsToDate(ts, ms) {
  if (ts && typeof ts.toDate === "function") return ts.toDate();

  const n = (typeof ms === "number") ? ms
          : (typeof ms === "string" && ms.trim() !== "" && !isNaN(ms)) ? Number(ms)
          : null;

  if (typeof n === "number" && Number.isFinite(n)) return new Date(n);
  return null;
}

export function getMYTodayKey() {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: TZ,
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).formatToParts(new Date());

  const year = parts.find(p => p.type === "year")?.value;
  const month = parts.find(p => p.type === "month")?.value;
  const day = parts.find(p => p.type === "day")?.value;

  return `${year}-${month}-${day}`;
}

/* =========================
   HOLD WINDOWS BUILDER
   supports:
   - old data version (single hold/resume fields)
   - new data version (holds[] / resumes[])
   - active on_hold without resume yet
========================= */
export function buildHoldWindowsFromRun(r, segEnd = new Date()) {
  const windows = [];
  const status = String(r?.status || "").toLowerCase().trim();
  const effectiveEnd = segEnd instanceof Date ? segEnd : new Date(segEnd);

  const toDateSafe = (v) => {
    if (!v) return null;
    if (v instanceof Date) return isNaN(v.getTime()) ? null : v;
    if (typeof v === "number") {
      const d = new Date(v);
      return isNaN(d.getTime()) ? null : d;
    }
    if (typeof v?.toDate === "function") {
      const d = v.toDate();
      return d instanceof Date && !isNaN(d.getTime()) ? d : null;
    }
    return null;
  };

  // =========================
  // NEW SYSTEM: holds[] / resumes[]
  // =========================
  const holdsArr = Array.isArray(r?.holds) ? r.holds : [];
  const resumesArr = Array.isArray(r?.resumes) ? r.resumes : [];

  if (holdsArr.length > 0) {
    const holds = holdsArr
      .map((h) => ({
        holdAt:
          toDateSafe(h?.holdAtEpochMs) ||
          toDateSafe(h?.holdEpochMs) ||
          toDateSafe(h?.holdAt),
        holdReason: h?.holdReason || "",
        remarks: h?.remarks || ""
      }))
      .filter((h) => h.holdAt)
      .sort((a, b) => a.holdAt - b.holdAt);

    const resumes = resumesArr
      .map((x) => ({
        resumedAt:
          toDateSafe(x?.resumedAtEpochMs) ||
          toDateSafe(x?.resumeEpochMs) ||
          toDateSafe(x?.resumedAt) ||
          toDateSafe(x?.resumeAt)
      }))
      .filter((x) => x.resumedAt)
      .sort((a, b) => a.resumedAt - b.resumedAt);

    let resumeIdx = 0;

    for (const h of holds) {
      while (
        resumeIdx < resumes.length &&
        resumes[resumeIdx].resumedAt <= h.holdAt
      ) {
        resumeIdx++;
      }

      const matchedResume =
        resumeIdx < resumes.length ? resumes[resumeIdx] : null;

      const holdEnd =
        matchedResume?.resumedAt ||
        (status === "on_hold" ? effectiveEnd : null);

      if (!holdEnd || holdEnd <= h.holdAt) continue;

      windows.push({
        start: h.holdAt,
        end: holdEnd,
        holdReason: h.holdReason,
        remarks: h.remarks,
        isOpen: !matchedResume && status === "on_hold"
      });

      if (matchedResume) resumeIdx++;
    }

    return windows;
  }

  // =========================
  // OLD SYSTEM: single hold/resume fields
  // =========================
  const holdAt =
    toDateSafe(r?.holdEpochMs) ||
    toDateSafe(r?.holdAt);

  const resumedAt =
    toDateSafe(r?.resumedEpochMs) ||
    toDateSafe(r?.resumeEpochMs) ||
    toDateSafe(r?.resumedAt) ||
    toDateSafe(r?.resumeAt);

  if (holdAt) {
    const end =
      resumedAt ||
      (status === "on_hold" ? effectiveEnd : null);

    if (end && end > holdAt) {
      windows.push({
        start: holdAt,
        end,
        holdReason: r?.holdReason || "",
        remarks: r?.remarks || "",
        isOpen: !resumedAt && status === "on_hold"
      });
    }
  }

  return windows;
}


export function buildSegmentsFromRuns(runs) {
  const segments = [];
  const issues = [];

  for (const r of runs) {
    const serial = r.serialNumber || "";
    const station = r.station || "";

    const start = tsOrMsToDate(r.startAt, r.startEpochMs);
    const resumed = tsOrMsToDate(r.resumedAt, r.resumedEpochMs);

    const statusRaw = String(r.status || "").toLowerCase().trim(); // running / completed / on_hold
    const status =
      (statusRaw === "completed" || statusRaw === "running" || statusRaw === "on_hold")
        ? statusRaw
        : "running";

    // Pick end time based on status:
    const endCompleted = tsOrMsToDate(r.endAt, r.endEpochMs);
    const holdTime = tsOrMsToDate(r.holdAt, r.holdEpochMs);

    let end = null;
    if (status === "completed") end = endCompleted;
    else if (status === "on_hold") end = holdTime || new Date();
    else end = new Date(); // running

    if (!serial || !station || !start) {
      issues.push({ type: "missing_fields", id: r.id, serial, station });
      continue;
    }

    if (end && end.getTime() < start.getTime()) end = new Date(start.getTime());

    const durationMs =
      typeof r.durationMs === "number"
        ? r.durationMs
        : (start && end ? (end.getTime() - start.getTime()) : 0);

    const holdWindows = buildHoldWindowsFromRun(r, end);

    segments.push({
      serial,
      projectName: r.projectName || "(No Project)",
      materialNumber: r.materialNumber || "",
      description: r.description || "",
      station,
      phase: "process",
      processLabel: r.processName || "-",
      manpower: Number(r.manpower ?? 0) || 0,
      employeeName: r.startedByName || "",
      employeeNumber: r.startedByNumber || "",
      resumedByName: r.resumedByName || "",
      resumedByNumber: r.resumedByNumber || "",
      start,
      end,
      status,
      holdReason: r.holdReason || "",
      remarks: r.remarks || "",

      holdAt: holdTime || null,
      resumedAt: resumed || null,
      holdEpochMs: r.holdEpochMs ?? null,
      resumedEpochMs: r.resumedEpochMs ?? null,
      holds: Array.isArray(r.holds) ? r.holds : [],
      resumes: Array.isArray(r.resumes) ? r.resumes : [],

      qrKind: r.qrKind || "",
      chillerSerialNumber: r.chillerSerialNumber || "",
      pvSerialNumber: r.pvSerialNumber || "",
      vesselType: r.vesselType || "",
      coolingType: r.coolingType || "",

      ongoing: (status === "running" || status === "on_hold"),
      durationMs: Math.max(0, durationMs),
      holdWindows
    });
  }

  return { segments, issues };
}

export function getStationOptionsFromSegments(segments) {
  return Array.from(
    new Set(
      segments.map(seg => String(seg?.station || "UNKNOWN").trim() || "UNKNOWN")
    )
  ).sort((a, b) => a.localeCompare(b));
}

