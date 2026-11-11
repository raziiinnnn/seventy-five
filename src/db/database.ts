/**
 * Dexie (IndexedDB) database definition.
 *
 * Schema version 1 — all tables declared with their primary keys and indexes.
 * Dexie handles migrations automatically; bump the version + add `stores()` call
 * for each schema change in future steps.
 */

import Dexie, { type EntityTable } from "dexie";
import type { CalendarOverride, ScheduledPeriod } from "@/engine/types2";

// ---------------------------------------------------------------------------
// Row types (what actually lives in IndexedDB)
// ---------------------------------------------------------------------------

/** Student profile — only one row ever exists, keyed "current". */
export interface ProfileRow {
  id: "current";
  name: string;
  department: string;
  branch: string;
  semester: number;
  createdAt: string; // ISO 8601
}

/**
 * Subject row — mirrors the ETLAB anchor plus the display metadata.
 * Acts as the single source of truth for each subject's last-confirmed state.
 */
export interface SubjectRow {
  /** Stable UUID (nanoid or crypto.randomUUID) assigned at creation. */
  id: string;
  code: string;
  name: string;
  kind: "theory" | "lab";
  /** Hours per session (1 for theory; variable for labs). */
  hoursPerSession: number;
  /** ETLAB anchor fields — last confirmed by OCR sync. */
  attended: number;
  total: number;
  missed: number;
  dutyLeave: number;
  /**
   * The last date ETLAB data is confirmed accurate for this subject.
   * Local daily logs AFTER this date form the overlay.
   */
  asOfDate: string; // "YYYY-MM-DD"
  /**
   * True for subjects that only appear in the exam — no regular classes
   * (e.g. Environmental Science internal). These are tracked but excluded
   * from the daily timetable.
   */
  isExamSubject: boolean;
  sortOrder: number;
}

/** One weekday's worth of timetable slots. Keyed by weekday string. */
export interface TimetableRow {
  /** "mon" | "tue" | "wed" | "thu" | "fri" | "sat" */
  weekday: string;
  periods: ScheduledPeriod[];
}

/** A per-date calendar override (holiday, follow-weekday, custom periods). */
export interface CalendarOverrideRow {
  /** "YYYY-MM-DD" */
  date: string;
  override: CalendarOverride;
}

/**
 * A daily attendance log entry. One row per (date × subjectId × period).
 * The `status` field is the PeriodEvent from Step 2.
 */
export interface DailyLogRow {
  /** Auto-incremented primary key. */
  id?: number;
  date: string;        // "YYYY-MM-DD"
  subjectId: string;
  period: number;
  status: "present" | "absent" | "dl" | "cancelled";
  hours: number;
  /** Set to true after reconciliation — kept for history but excluded from live math. */
  retired: boolean;
}

/** Duty Leave record — tracks the full lifecycle of one DL claim. */
export interface DLRecordRow {
  /** UUID */
  id: string;
  eventName: string;   // e.g. "IEEE Hackathon"
  subjectId: string;
  hours: number;
  /** Dates of the missed periods covered by this DL. */
  logDates: string[];
  status: "logged" | "certificate_received" | "applied" | "reflected" | "applied_not_reflected";
  createdAt: string;   // ISO 8601
}

// ---------------------------------------------------------------------------
// Dexie database class
// ---------------------------------------------------------------------------

export class AttendanceDB extends Dexie {
  profile!: EntityTable<ProfileRow, "id">;
  subjects!: EntityTable<SubjectRow, "id">;
  timetable!: EntityTable<TimetableRow, "weekday">;
  calendarOverrides!: EntityTable<CalendarOverrideRow, "date">;
  dailyLogs!: EntityTable<DailyLogRow, "id">;
  dlRecords!: EntityTable<DLRecordRow, "id">;

  constructor() {
    super("AttendanceDB");
    this.version(1).stores({
      // Primary key first, then indexed fields
      profile: "id",
      subjects: "id, code, kind, asOfDate, sortOrder",
      timetable: "weekday",
      calendarOverrides: "date",
      dailyLogs: "++id, date, subjectId, [date+subjectId], retired",
      dlRecords: "id, subjectId, status, createdAt",
    });
  }
}

/** Singleton database instance — import this everywhere. */
export const db = new AttendanceDB();

