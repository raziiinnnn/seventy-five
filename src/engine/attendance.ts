/**
 * Attendance calculation engine.
 *
 * Rules:
 *  - All hours are whole numbers (matching ETLAB).
 *  - Safe threshold: attended / total >= 75% — implemented as 4*attended >= 3*total (integer math).
 *  - 0/0 (no classes yet) is considered safe.
 *  - No floating-point comparisons. Percentage strings are for display only.
 */

import type {
  Subject,
  PendingDL,
  UpcomingDay,
  SubjectResult,
  OverallResult,
  LeaveSimResult,
  DLProjection,
  DLProjectResult,
  WeeklyResult,
  RankedDay,
} from "./types.js";

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/** Validates that attended and total are non-negative whole numbers and attended <= total. */
function validateHours(attended: number, total: number, context = ""): void {
  const tag = context ? ` (${context})` : "";
  if (!Number.isInteger(attended) || !Number.isInteger(total)) {
    throw new Error(`Hours must be whole numbers${tag}. Got attended=${attended}, total=${total}.`);
  }
  if (attended < 0 || total < 0) {
    throw new Error(`Hours cannot be negative${tag}. Got attended=${attended}, total=${total}.`);
  }
  if (attended > total) {
    throw new Error(
      `attended (${attended}) cannot exceed total (${total})${tag}.`
    );
  }
}

/** Returns a display percentage string with one decimal, truncated (no rounding up). */
function toPercentageString(attended: number, total: number): string {
  if (total === 0) return "0.0";
  // Multiply by 1000 to get one decimal via integer arithmetic, then truncate.
  const thousandths = Math.floor((attended * 1000) / total);
  const whole = Math.floor(thousandths / 10);
  const frac = thousandths % 10;
  return `${whole}.${frac}`;
}

/** Derives the status label from safe flag and buffer. */
function toStatus(safe: boolean, buffer: number): "safe" | "careful" | "red" {
  if (!safe) return "red";
  if (buffer <= 2) return "careful";
  return "safe";
}

/** Builds a SubjectResult from raw numbers. */
function buildSubjectResult(subjectId: string, attended: number, total: number): SubjectResult {
  const safe = isSafe(attended, total);
  const buffer = skipBuffer(attended, total);
  return {
    subjectId,
    attended,
    total,
    percentage: toPercentageString(attended, total),
    safe,
    buffer,
    status: toStatus(safe, buffer),
  };
}

/** Builds an OverallResult from raw numbers. */
function buildOverallResult(attended: number, total: number): OverallResult {
  const safe = isSafe(attended, total);
  const buffer = skipBuffer(attended, total);
  return {
    attended,
    total,
    percentage: toPercentageString(attended, total),
    safe,
    buffer,
    status: toStatus(safe, buffer),
  };
}

// ---------------------------------------------------------------------------
// Public functions
// ---------------------------------------------------------------------------

/**
 * Returns true if the attendance meets the 75% threshold.
 * Uses integer comparison: 4*attended >= 3*total.
 * 0/0 (no classes yet) is considered safe.
 */
export function isSafe(attended: number, total: number): boolean {
  validateHours(attended, total);
  if (total === 0) return true;
  return 4 * attended >= 3 * total;
}

/**
 * Returns the maximum hours that can be missed while remaining safe.
 * Formula: max(0, floor((4*attended - 3*total) / 3))
 * Returns 0 if already unsafe.
 */
export function skipBuffer(attended: number, total: number): number {
  validateHours(attended, total);
  const surplus = 4 * attended - 3 * total;
  if (surplus <= 0) return 0;
  return Math.floor(surplus / 3);
}

/**
 * Returns the fewest hours to attend consecutively to reach 75%.
 * Formula: max(0, 3*total - 4*attended)
 */
export function recoveryNeeded(attended: number, total: number): number {
  validateHours(attended, total);
  const deficit = 3 * total - 4 * attended;
  return Math.max(0, deficit);
}

/**
 * Converts a raw hour count to sessions, given hours per session.
 * Used to show lab buffers in sessions rather than hours.
 */
export function sessionsFromHours(hours: number, hoursPerSession: number): number {
  if (!Number.isInteger(hours) || !Number.isInteger(hoursPerSession)) {
    throw new Error("sessionsFromHours: both arguments must be whole numbers.");
  }
  if (hours < 0) throw new Error("sessionsFromHours: hours cannot be negative.");
  if (hoursPerSession <= 0) throw new Error("sessionsFromHours: hoursPerSession must be positive.");
  return Math.floor(hours / hoursPerSession);
}

/**
 * Returns the aggregate attended and total across all subjects.
 */
export function overallOf(subjects: Subject[]): { attended: number; total: number } {
  let attended = 0;
  let total = 0;
  for (const s of subjects) {
    validateHours(s.attended, s.total, s.id);
    attended += s.attended;
    total += s.total;
  }
  return { attended, total };
}

/**
 * Simulates taking leave by adding missed hours to total (but not attended) for
 * each affected subject. Returns per-subject and overall results, plus a planOk
 * flag that is true only when overall AND every subject are safe.
 *
 * @param missedHoursBySubject - map of subjectId → hours to miss
 */
export function simulateLeave(
  subjects: Subject[],
  missedHoursBySubject: Record<string, number>
): LeaveSimResult {
  // Validate miss counts
  for (const [id, hrs] of Object.entries(missedHoursBySubject)) {
    if (!Number.isInteger(hrs) || hrs < 0) {
      throw new Error(`simulateLeave: missed hours for subject "${id}" must be a non-negative integer.`);
    }
  }

  const subjectResults: SubjectResult[] = subjects.map((s) => {
    validateHours(s.attended, s.total, s.id);
    const missed = missedHoursBySubject[s.id] ?? 0;
    const newAttended = s.attended;        // attendance does not change
    const newTotal = s.total + missed;     // total grows by missed hours
    return buildSubjectResult(s.id, newAttended, newTotal);
  });

  // Overall: sum after simulation
  let totalAttended = 0;
  let totalHours = 0;
  for (const r of subjectResults) {
    totalAttended += r.attended;
    totalHours += r.total;
  }
  const overall = buildOverallResult(totalAttended, totalHours);

  const planOk = overall.safe && subjectResults.every((r) => r.safe);

  return { subjects: subjectResults, overall, planOk };
}

/**
 * Projects attendance after pending Duty Leave (DL) hours are granted.
 * DL hours are added to attended only; total does not change.
 */
export function projectWithDL(
  subjects: Subject[],
  pendingDLs: PendingDL[]
): DLProjectResult {
  // Build a map of extra attended hours per subject
  const dlMap: Record<string, number> = {};
  for (const dl of pendingDLs) {
    if (!Number.isInteger(dl.hours) || dl.hours < 0) {
      throw new Error(`projectWithDL: DL hours for subject "${dl.subjectId}" must be a non-negative integer.`);
    }
    dlMap[dl.subjectId] = (dlMap[dl.subjectId] ?? 0) + dl.hours;
  }

  let actualAtt = 0, actualTot = 0;
  let projAtt = 0, projTot = 0;

  const subjectProjections: DLProjection[] = subjects.map((s) => {
    validateHours(s.attended, s.total, s.id);
    const extra = dlMap[s.id] ?? 0;
    const projAttended = s.attended + extra;
    // After DL, projAttended could exceed total — that's not physically
    // possible; guard against it.
    if (projAttended > s.total) {
      throw new Error(
        `projectWithDL: DL hours would push attended (${projAttended}) above total (${s.total}) for subject "${s.id}".`
      );
    }

    actualAtt += s.attended;
    actualTot += s.total;
    projAtt += projAttended;
    projTot += s.total;

    return {
      subjectId: s.id,
      actual: {
        attended: s.attended,
        total: s.total,
        percentage: toPercentageString(s.attended, s.total),
        safe: isSafe(s.attended, s.total),
      },
      projected: {
        attended: projAttended,
        total: s.total,
        percentage: toPercentageString(projAttended, s.total),
        safe: isSafe(projAttended, s.total),
      },
    };
  });

  return {
    subjects: subjectProjections,
    actual: {
      attended: actualAtt,
      total: actualTot,
      percentage: toPercentageString(actualAtt, actualTot),
      safe: isSafe(actualAtt, actualTot),
    },
    projected: {
      attended: projAtt,
      total: projTot,
      percentage: toPercentageString(projAtt, projTot),
      safe: isSafe(projAtt, projTot),
    },
  };
}

/**
 * Given a weekly habit of missing hours in certain subjects, calculates how many
 * full weeks the habit can continue before overall or any subject becomes unsafe.
 *
 * Uses integer arithmetic:
 *   weeks = floor((4*attended - 3*total) / (3 * weeklyMissed))
 * for each subject and for the overall; returns the minimum and identifies which
 * one fails first.
 *
 * @param weeklyMissedHoursBySubject - map of subjectId → hours missed each week
 */
export function whatIfWeekly(
  subjects: Subject[],
  weeklyMissedHoursBySubject: Record<string, number>
): WeeklyResult {
  for (const [id, hrs] of Object.entries(weeklyMissedHoursBySubject)) {
    if (!Number.isInteger(hrs) || hrs < 0) {
      throw new Error(`whatIfWeekly: weekly missed hours for subject "${id}" must be a non-negative integer.`);
    }
  }

  let minWeeks = Infinity;
  let failsAt = "overall";

  // Per-subject check
  for (const s of subjects) {
    validateHours(s.attended, s.total, s.id);
    const weeklyMissed = weeklyMissedHoursBySubject[s.id] ?? 0;
    if (weeklyMissed === 0) continue;

    const surplus = 4 * s.attended - 3 * s.total;
    // If already unsafe, 0 weeks safe.
    const weeks = surplus <= 0 ? 0 : Math.floor(surplus / (3 * weeklyMissed));
    if (weeks < minWeeks) {
      minWeeks = weeks;
      failsAt = s.id;
    }
  }

  // Overall check
  const agg = overallOf(subjects);
  const totalWeeklyMissed = Object.values(weeklyMissedHoursBySubject).reduce(
    (sum, h) => sum + h,
    0
  );
  if (totalWeeklyMissed > 0) {
    const surplus = 4 * agg.attended - 3 * agg.total;
    const weeks = surplus <= 0 ? 0 : Math.floor(surplus / (3 * totalWeeklyMissed));
    if (weeks < minWeeks) {
      minWeeks = weeks;
      failsAt = "overall";
    }
  }

  return {
    safeWeeks: minWeeks === Infinity ? Infinity : minWeeks,
    failsAt,
  };
}

/**
 * Ranks upcoming days by how "skippable" they are.
 * Days that would make overall or any subject unsafe are excluded entirely.
 * Remaining days are ranked by:
 *   (a) fewest total hours lost,
 *   (b) largest remaining buffer in the tightest subject after skipping,
 *   (c) earliest day (index in the input array).
 *
 * @param topN - number of results to return (default 3)
 */
export function bestDaysToSkip(
  subjects: Subject[],
  upcomingDays: UpcomingDay[],
  topN = 3
): RankedDay[] {
  const ranked: RankedDay[] = [];

  for (const day of upcomingDays) {
    // Build the missed-hours map for this day
    const missed = day.missedHours;

    // Simulate skipping this day
    const sim = simulateLeave(subjects, missed);

    // Reject if overall or any subject would become unsafe
    if (!sim.planOk) continue;

    const totalHoursLost = Object.values(missed).reduce((s, h) => s + h, 0);
    const tightestBufferAfter = Math.min(...sim.subjects.map((r) => r.buffer));

    ranked.push({
      day,
      totalHoursLost,
      tightestBufferAfter,
      reason: buildSkipReason(totalHoursLost, tightestBufferAfter, sim.overall.buffer),
    });
  }

  // Sort: (a) fewest hours lost ASC, (b) largest tightest buffer DESC, (c) earlier days first (already in order)
  ranked.sort((a, b) => {
    if (a.totalHoursLost !== b.totalHoursLost) return a.totalHoursLost - b.totalHoursLost;
    if (a.tightestBufferAfter !== b.tightestBufferAfter) return b.tightestBufferAfter - a.tightestBufferAfter;
    return 0; // preserves original day order (stable sort)
  });

  return ranked.slice(0, topN);
}

/** Builds a human-readable reason string for a ranked skip day. */
function buildSkipReason(
  totalHoursLost: number,
  tightestBufferAfter: number,
  overallBufferAfter: number
): string {
  const parts: string[] = [];
  parts.push(`Loses ${totalHoursLost}h total.`);
  parts.push(`Tightest subject buffer after skip: ${tightestBufferAfter}h.`);
  parts.push(`Overall buffer after skip: ${overallBufferAfter}h.`);
  return parts.join(" ");
}

