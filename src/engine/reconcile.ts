/**
 * Bank-Statement Reconciliation & Overlay engine.
 *
 * ETLAB is the ground truth (bank statement). The student's daily logs are
 * the receipt pile. This module merges the two into a coherent current state
 * and reconciles fresh ETLAB snapshots against local history.
 */

import type { Subject, PendingDL } from "./types.js";
import type {
  EtlabAnchor,
  EtlabSnapshot,
  DailyLog,
  DLRecord,
  DLStatus,
  OverlayResult,
  RetiredLog,
  MismatchInfo,
  ReconcileResult,
  Timetable,
  CalendarOverrides,
} from "./types2.js";
import { getScheduledPeriodsForDate } from "./calendar.js";

// ---------------------------------------------------------------------------
// Date comparison helper (string-only, no Date objects)
// ---------------------------------------------------------------------------

/** Returns true if a DL status represents an active, unreflected claim. */
function isActiveUnreflectedDL(status: DLStatus): boolean {
  return (
    status === "logged" ||
    status === "certificate_received" ||
    status === "applied"
  );
}

/** Returns true if `a` is strictly before `b` (both "YYYY-MM-DD"). */
function dateLT(a: string, b: string): boolean {
  return a < b; // ISO strings compare lexicographically
}

/** Returns true if `a` is on or before `b`. */
function dateLE(a: string, b: string): boolean {
  return a <= b;
}

// ---------------------------------------------------------------------------
// applyLocalOverlay
// ---------------------------------------------------------------------------

/**
 * Computes the current estimated attendance for each subject by layering
 * local daily logs (the "receipts") on top of the ETLAB anchors (the "bank statement").
 *
 * Only logs dated STRICTLY AFTER the subject's anchor.asOfDate are counted.
 * Cancelled periods add nothing to either attended or total.
 * DL periods add to total only (unapproved DL is counted as missed by ETLAB).
 *
 * @param anchors    - Last confirmed ETLAB snapshot per subject.
 * @param dailyLogs  - All local period-level attendance logs (may include retired ones).
 * @param dlRecords  - All DL records for all subjects.
 * @returns Effective Subject[] ready for Step 1 functions, plus PendingDL[] for projection.
 */
export function applyLocalOverlay(
  anchors: EtlabAnchor[],
  dailyLogs: DailyLog[],
  dlRecords: DLRecord[]
): OverlayResult {
  // Index anchors by subjectId
  const anchorMap = new Map(anchors.map((a) => [a.subjectId, a]));

  // Group logs by subjectId
  const logsBySubject = new Map<string, DailyLog[]>();
  for (const log of dailyLogs) {
    const bucket = logsBySubject.get(log.subjectId) ?? [];
    bucket.push(log);
    logsBySubject.set(log.subjectId, bucket);
  }

  const subjects: Subject[] = [];

  for (const anchor of anchors) {
    const logs = logsBySubject.get(anchor.subjectId) ?? [];
    let deltaAttended = 0;
    let deltaTotal = 0;

    for (const log of logs) {
      // Only count logs strictly AFTER the anchor date
      if (!dateLT(anchor.asOfDate, log.date)) continue;

      switch (log.event) {
        case "present":
          deltaAttended += log.hours;
          deltaTotal += log.hours;
          break;
        case "absent":
        case "dl":
          // Both add to total; DL adds to attended only once ETLAB reflects it
          deltaTotal += log.hours;
          break;
        case "cancelled":
          // No effect on either counter
          break;
      }
    }

    subjects.push({
      id: anchor.subjectId,
      code: anchor.subjectId,
      name: anchor.subjectId,
      kind: "theory",
      hoursPerSession: 1,
      attended: anchor.attended + deltaAttended,
      total: anchor.total + deltaTotal,
    });
  }

  // Collect pending DLs: DL records with active unreflected statuses ("logged",
  // "certificate_received", or "applied") that have not yet been reflected in ETLAB.
  const pendingDLs: PendingDL[] = dlRecords
    .filter((dl) => isActiveUnreflectedDL(dl.status))
    .filter((dl) => anchorMap.has(dl.subjectId))
    .map((dl) => ({
      subjectId: dl.subjectId,
      hours: dl.hours,
    }));

  return { subjects, pendingDLs };
}

// ---------------------------------------------------------------------------
// inferAsOfDateAndReconcile
// ---------------------------------------------------------------------------

/**
 * Reconciles a fresh ETLAB snapshot with local history, inferring the new
 * asOfDate by walking forward through scheduled classes until the total hours
 * consumed matches the delta.
 *
 * Steps:
 *  1. Compute deltaY = newEtlSnapshot.total - oldAnchor.total.
 *  2. Walk forward day-by-day from oldAnchor.asOfDate, summing hours for this
 *     subject from daily logs (if present) or the timetable.
 *  3. The day where cumulative hours reach deltaY is the new asOfDate.
 *  4. Retire all logs on or before the new asOfDate.
 *  5. Check for missed-hours conflicts.
 *  6. Auto-close or flag DL records.
 */
export function inferAsOfDateAndReconcile(
  oldAnchor: EtlabAnchor,
  newEtlSnapshot: EtlabSnapshot,
  dailyLogs: DailyLog[],
  timetable: Timetable,
  calendarOverrides: CalendarOverrides,
  dlRecords: DLRecord[],
  options?: { allowReset?: boolean; walkToDate?: string }
): ReconcileResult {
  const subjectId = oldAnchor.subjectId;
  const deltaY = newEtlSnapshot.total - oldAnchor.total;

  if (deltaY < 0 && !options?.allowReset) {
    throw new Error(
      `inferAsOfDateAndReconcile: ETLAB total decreased for subject "${subjectId}" ` +
      `(${oldAnchor.total} → ${newEtlSnapshot.total}). ` +
      `Pass allowReset: true if this is a manual reset.`
    );
  }

  // Index local logs for this subject, sorted by date
  const subjectLogs = dailyLogs
    .filter((l) => l.subjectId === subjectId)
    .sort((a, b) => a.date.localeCompare(b.date));

  // Build a map: date → total hours that occurred (from logs or timetable)
  // We walk forward from oldAnchor.asOfDate until we accumulate deltaY hours.
  let newAsOfDate = oldAnchor.asOfDate;
  let inferredExact = true;

  if (deltaY === 0) {
    // No new classes were processed by ETLAB; date stays the same
    newAsOfDate = oldAnchor.asOfDate;
  } else {
    // Walk forward day-by-day
    let cumulative = 0;
    let currentJDN = dateStrToJDN(oldAnchor.asOfDate) + 1;
    const maxJDN = options?.walkToDate
      ? dateStrToJDN(options.walkToDate)
      : dateStrToJDN(oldAnchor.asOfDate) + 365; // safety cap

    let landed = false;

    while (currentJDN <= maxJDN) {
      const dateStr = jdnToDateStrLocal(currentJDN);

      // Hours for this subject on this date: prefer local log, fall back to timetable
      const hoursOnDate = getHoursForSubjectOnDate(
        subjectId,
        dateStr,
        subjectLogs,
        timetable,
        calendarOverrides
      );

      if (hoursOnDate > 0) {
        cumulative += hoursOnDate;

        if (cumulative === deltaY) {
          newAsOfDate = dateStr;
          inferredExact = true;
          landed = true;
          break;
        }

        if (cumulative > deltaY) {
          // We overshot — the boundary fell mid-day (unusual but possible with multi-hour periods)
          // Pick the previous date where cumulative <= deltaY
          newAsOfDate = jdnToDateStrLocal(currentJDN - 1);
          inferredExact = false;
          landed = true;
          break;
        }
      }

      currentJDN++;
    }

    if (!landed) {
      // Could not reach deltaY within the walk window
      newAsOfDate = jdnToDateStrLocal(currentJDN - 1);
      inferredExact = false;
    }
  }

  // Retire logs on or before newAsOfDate
  const retiredLogs: RetiredLog[] = subjectLogs
    .filter((l) => dateLE(l.date, newAsOfDate))
    .map((l) => ({ ...l, retired: true as const }));

  // -------------------------------------------------------------------------
  // Conflict check: compare local missed count vs ETLAB's deltaMissed
  // -------------------------------------------------------------------------
  const deltaMissed = newEtlSnapshot.missed - oldAnchor.missed;
  let localMissedCount = 0;

  for (const log of subjectLogs) {
    if (!dateLT(oldAnchor.asOfDate, log.date)) continue; // must be AFTER old anchor
    if (!dateLE(log.date, newAsOfDate)) continue;        // must be BEFORE/ON new anchor
    if (log.event === "absent") {
      localMissedCount += log.hours;
    }
  }

  let mismatch: MismatchInfo | null = null;
  if (localMissedCount !== deltaMissed) {
    mismatch = {
      expectedMissed: localMissedCount,
      etlabMissed: deltaMissed,
    };
  }

  // -------------------------------------------------------------------------
  // DL auto-close / flag
  // -------------------------------------------------------------------------
  const deltaDL = newEtlSnapshot.dutyLeave - oldAnchor.dutyLeave;
  let dlBudget = deltaDL; // hours of DL we can "spend" to close pending records

  const updatedDLRecords: DLRecord[] = dlRecords.map((dl) => {
    if (dl.subjectId !== subjectId) return dl;

    if (isActiveUnreflectedDL(dl.status)) {
      if (dlBudget >= dl.hours) {
        // ETLAB's dutyLeave rose enough to cover this DL → auto-close
        dlBudget -= dl.hours;
        return { ...dl, status: "reflected" as DLStatus };
      } else if (dl.status === "applied" && deltaDL === 0) {
        // Student marked applied but ETLAB didn't move
        return { ...dl, status: "applied_not_reflected" as DLStatus };
      }
    }

    return dl;
  });

  const newAnchor: EtlabAnchor = {
    subjectId,
    attended: newEtlSnapshot.attended,
    total: newEtlSnapshot.total,
    missed: newEtlSnapshot.missed,
    dutyLeave: newEtlSnapshot.dutyLeave,
    asOfDate: newAsOfDate,
  };

  return {
    newAnchor,
    inferredExact,
    retiredLogs,
    updatedDLRecords,
    mismatch,
  };
}

// ---------------------------------------------------------------------------
// Private helpers
// ---------------------------------------------------------------------------

/** Returns hours for a subject on a given date from logs, or from timetable. */
function getHoursForSubjectOnDate(
  subjectId: string,
  dateStr: string,
  sortedSubjectLogs: DailyLog[],
  timetable: Timetable,
  calendarOverrides: CalendarOverrides
): number {
  // Check if there are local logs for this date/subject
  const logsOnDate = sortedSubjectLogs.filter(
    (l) => l.date === dateStr && l.event !== "cancelled"
  );

  if (logsOnDate.length > 0) {
    // Sum hours from logs (present + absent + dl all count as "occurred")
    return logsOnDate.reduce((s, l) => s + (l.event === "cancelled" ? 0 : l.hours), 0);
  }

  // Fall back to timetable
  const periods = getScheduledPeriodsForDate(dateStr, timetable, calendarOverrides);
  return periods
    .filter((p) => p.subjectId === subjectId)
    .reduce((s, p) => s + p.hours, 0);
}

// ---------------------------------------------------------------------------
// Minimal inline JDN helpers (avoids importing from calendar.ts internals)
// ---------------------------------------------------------------------------

function dateStrToJDN(dateStr: string): number {
  const year = parseInt(dateStr.slice(0, 4), 10);
  const month = parseInt(dateStr.slice(5, 7), 10);
  const day = parseInt(dateStr.slice(8, 10), 10);
  const a = Math.floor((14 - month) / 12);
  const y = year + 4800 - a;
  const m = month + 12 * a - 3;
  return day + Math.floor((153 * m + 2) / 5) + 365 * y +
    Math.floor(y / 4) - Math.floor(y / 100) + Math.floor(y / 400) - 32045;
}

function jdnToDateStrLocal(jdn: number): string {
  const a = jdn + 32044;
  const b = Math.floor((4 * a + 3) / 146097);
  const c = a - Math.floor((146097 * b) / 4);
  const d = Math.floor((4 * c + 3) / 1461);
  const e = c - Math.floor((1461 * d) / 4);
  const m = Math.floor((5 * e + 2) / 153);
  const day = e - Math.floor((153 * m + 2) / 5) + 1;
  const month = m + 3 - 12 * Math.floor(m / 10);
  const year = 100 * b + d - 4800 + Math.floor(m / 10);
  const p = (n: number) => (n < 10 ? `0${n}` : `${n}`);
  return `${year}-${p(month)}-${p(day)}`;
}

