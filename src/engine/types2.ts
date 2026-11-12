/**
 * Step 2 domain types — Semester Calendar, Timetable, Reconciliation, OCR.
 * All types that extend or accompany Step 1's types.ts live here.
 */

// ---------------------------------------------------------------------------
// Calendar & Timetable
// ---------------------------------------------------------------------------

/** Day-of-week keys used in the timetable map. */
export type Weekday = "mon" | "tue" | "wed" | "thu" | "fri" | "sat";

/** One period on a timetable row. */
export interface ScheduledPeriod {
  period: number;
  subjectId: string;
  hours: number;
}

/** A timetable maps each working weekday to its ordered periods. */
export type Timetable = Partial<Record<Weekday, ScheduledPeriod[]>>;

/** A single entry in the per-date calendar overrides map. */
export type CalendarOverride =
  | { kind: "holiday"; reason?: string }
  | { kind: "follow_weekday"; weekday: Weekday }
  | { kind: "custom_periods"; periods: ScheduledPeriod[] };

/** Overrides keyed by ISO date string "YYYY-MM-DD". */
export type CalendarOverrides = Record<string, CalendarOverride>;

/** A date with its scheduled periods, returned by getCatchUpQueue. */
export interface CatchUpEntry {
  date: string;
  periods: ScheduledPeriod[];
}

/** Total remaining hours per subject from projectRemainingClasses. */
export type RemainingHours = Record<string, number>;

// ---------------------------------------------------------------------------
// Daily Logs (the "receipt pile")
// ---------------------------------------------------------------------------

export type PeriodEvent = "present" | "absent" | "dl" | "cancelled";

/** One attendance log entry for a specific period on a specific date. */
export interface DailyLog {
  date: string;        // "YYYY-MM-DD"
  subjectId: string;
  period: number;
  event: PeriodEvent;
  hours: number;
}

// ---------------------------------------------------------------------------
// ETLAB Anchor ("bank statement")
// ---------------------------------------------------------------------------

/** The last known-good ETLAB snapshot for a subject. */
export interface EtlabAnchor {
  subjectId: string;
  attended: number;
  total: number;
  missed: number;
  dutyLeave: number;
  asOfDate: string;    // "YYYY-MM-DD" — all ETLAB data is correct up to this date
}

/** A fresh ETLAB snapshot brought in via sync (no date yet). */
export interface EtlabSnapshot {
  attended: number;
  total: number;
  missed: number;
  dutyLeave: number;
}

// ---------------------------------------------------------------------------
// DL Records
// ---------------------------------------------------------------------------

export type DLStatus =
  | "logged"                // student logged a DL period; certificate/application pending
  | "certificate_received"  // student received proof/certificate; not yet applied on ETLAB
  | "applied"               // student believes it has been submitted
  | "reflected"             // ETLAB dutyLeave rose to match; auto-closed
  | "applied_not_reflected"; // student marked applied but ETLAB dutyLeave didn't rise

/** A tracked Duty Leave record linked to one or more logged periods. */
export interface DLRecord {
  id: string;
  subjectId: string;
  hours: number;
  status: DLStatus;
  logDates: string[];  // dates of the DL periods
}

// ---------------------------------------------------------------------------
// Reconciliation results
// ---------------------------------------------------------------------------

/** Result of applyLocalOverlay for one subject. */
export interface OverlayResult {
  subjects: import("./types.js").Subject[];
  pendingDLs: import("./types.js").PendingDL[];
}

/** A daily log marked retired after reconciliation (kept for history). */
export interface RetiredLog extends DailyLog {
  retired: true;
}

/** Mismatch between local logs and ETLAB during reconciliation. */
export interface MismatchInfo {
  expectedMissed: number;  // what local logs counted
  etlabMissed: number;     // what ETLAB reported
}

/** Full result from inferAsOfDateAndReconcile. */
export interface ReconcileResult {
  newAnchor: EtlabAnchor;
  inferredExact: boolean;
  retiredLogs: RetiredLog[];
  updatedDLRecords: DLRecord[];
  mismatch: MismatchInfo | null;
}

// ---------------------------------------------------------------------------
// OCR / Checksum
// ---------------------------------------------------------------------------

/** One subject card as extracted by OCR. */
export interface EtlabCard {
  subjectId: string;
  attended: number;
  total: number;
  missed: number;
  leave: number;
  dutyLeave: number;
  displayedPercent: number;
}

/** The overall header row extracted by OCR. */
export interface EtlabOverallHeader {
  attended: number;
  total: number;
}

/** Result from validateEtlExtract. */
export interface ChecksumResult {
  valid: boolean;
  cardErrors: Array<{
    subjectId: string;
    issue: "arithmetic" | "percent_mismatch";
    detail: string;
  }>;
  headerMismatch: {
    missingAttended: number;
    missingTotal: number;
  } | null;
}

