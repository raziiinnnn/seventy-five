/**
 * Core domain types for the attendance calculation engine.
 * All hours are whole numbers, matching ETLAB's display format.
 */

/** A single subject with attended and total contact hours. */
export interface Subject {
  id: string;
  code: string;
  name: string;
  kind: "theory" | "lab";
  attended: number;
  total: number;
  /** Hours counted per session. Defaults to 1 for theory; labs set this per subject. */
  hoursPerSession: number;
}

/** A pending Duty Leave (DL) entry that will add hours to a subject's attended count. */
export interface PendingDL {
  subjectId: string;
  hours: number;
}

/** An upcoming day: a map of subjectId → hours that would be missed if skipped. */
export interface UpcomingDay {
  label: string;
  /** Hours that would be missed per subject if this day is skipped. */
  missedHours: Record<string, number>;
}

/** Per-subject result returned from simulateLeave and related functions. */
export interface SubjectResult {
  subjectId: string;
  attended: number;
  total: number;
  /** Exact percentage, one decimal place, no rounding up. */
  percentage: string;
  safe: boolean;
  /** Hours that can still be missed while remaining safe (0 if already unsafe). */
  buffer: number;
  /** "safe" = fine, "careful" = safe but ≤ 2 hours buffer, "red" = unsafe. */
  status: "safe" | "careful" | "red";
}

/** Overall (aggregate) result. */
export interface OverallResult {
  attended: number;
  total: number;
  percentage: string;
  safe: boolean;
  buffer: number;
  status: "safe" | "careful" | "red";
}

/** Full result from simulateLeave. */
export interface LeaveSimResult {
  subjects: SubjectResult[];
  overall: OverallResult;
  /** True only when overall AND every subject are safe. */
  planOk: boolean;
}

/** Per-subject projection from projectWithDL. */
export interface DLProjection {
  subjectId: string;
  actual: { attended: number; total: number; percentage: string; safe: boolean };
  projected: { attended: number; total: number; percentage: string; safe: boolean };
}

/** Full result from projectWithDL. */
export interface DLProjectResult {
  subjects: DLProjection[];
  actual: { attended: number; total: number; percentage: string; safe: boolean };
  projected: { attended: number; total: number; percentage: string; safe: boolean };
}

/** Result from whatIfWeekly. */
export interface WeeklyResult {
  /** Number of full weeks the habit can continue before something becomes unsafe. */
  safeWeeks: number;
  /** The subject id that fails first, or "overall" if the aggregate fails first. */
  failsAt: string;
}

/** A ranked day from bestDaysToSkip. */
export interface RankedDay {
  day: UpcomingDay;
  totalHoursLost: number;
  tightestBufferAfter: number;
  reason: string;
}

