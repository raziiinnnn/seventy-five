/**
 * useAttendanceStore — reactive Dexie-backed state for the whole app.
 *
 * Uses Dexie's built-in `useLiveQuery` hook so components automatically
 * re-render whenever IndexedDB data changes (even from background writes).
 *
 * Pattern: one hook per data domain, all composable.
 */

import { useLiveQuery } from "dexie-react-hooks";
import { db } from "@/db/database";
import type { SubjectRow, TimetableRow, DailyLogRow, DLRecordRow, ProfileRow } from "@/db/database";
import { getCatchUpQueue } from "@/engine/calendar";
import type { Timetable, CalendarOverrides, CatchUpEntry, ScheduledPeriod } from "@/engine/types2";
import { overallOf } from "@/engine/attendance";
import type { Subject } from "@/engine/types";

/** Subject enriched with ETLAB anchor metadata and local log overlay breakdown. */
export interface EffectiveSubject extends Subject {
  slotLetter?: string;
  creditWise?: string;
  asOfDate: string;
  anchorAttended: number;
  anchorTotal: number;
  overlayAttended: number;
  overlayTotal: number;
  missed: number;
  dutyLeave: number;
  isExamSubject: boolean;
}

// ---------------------------------------------------------------------------
// Profile
// ---------------------------------------------------------------------------

/** Returns the student's profile row, or undefined while loading. */
export function useProfile(): ProfileRow | undefined {
  return useLiveQuery(() => db.profile.get("current"), []);
}

// ---------------------------------------------------------------------------
// Subjects
// ---------------------------------------------------------------------------

/** Returns all subjects ordered by sortOrder. */
export function useSubjects(): SubjectRow[] | undefined {
  return useLiveQuery(() => db.subjects.orderBy("sortOrder").toArray(), []);
}

/**
 * Maps SubjectRow[] to the Step 1 Subject[] shape (attended, total from anchor only;
 * local overlay is applied separately in the full state calculation).
 */
export function subjectRowsToEngineSubjects(rows: SubjectRow[]): Subject[] {
  return rows.map((r) => ({
    id: r.id,
    code: r.code,
    name: r.name,
    kind: r.kind,
    attended: r.attended,
    total: r.total,
    hoursPerSession: r.hoursPerSession,
  }));
}

/** Returns the aggregate attended/total using Step 1's overallOf on effective subjects (with local logs). */
export function useOverallAttendance() {
  const subjects = useEffectiveSubjects();
  if (!subjects) return undefined;
  return overallOf(subjects);
}

// ---------------------------------------------------------------------------
// Timetable
// ---------------------------------------------------------------------------

/** Returns the timetable as a Dexie array. */
export function useTimetableRows(): TimetableRow[] | undefined {
  return useLiveQuery(() => db.timetable.toArray(), []);
}

/** Converts flat TimetableRow[] to the engine's Timetable map. */
export function timetableRowsToEngineFormat(rows: TimetableRow[]): Timetable {
  const tt: Timetable = {};
  for (const row of rows) {
    const key = row.weekday as keyof Timetable;
    tt[key] = row.periods as ScheduledPeriod[];
  }
  return tt;
}

/** Returns the timetable converted to the engine's Timetable map. */
export function useTimetable(): Timetable | undefined {
  const rows = useTimetableRows();
  if (!rows) return undefined;
  return timetableRowsToEngineFormat(rows);
}

// ---------------------------------------------------------------------------
// Calendar Overrides
// ---------------------------------------------------------------------------

/** Returns all calendar overrides as the engine's CalendarOverrides map. */
export function useCalendarOverrides(): CalendarOverrides | undefined {
  return useLiveQuery(async () => {
    const rows = await db.calendarOverrides.toArray();
    const map: CalendarOverrides = {};
    for (const row of rows) {
      map[row.date] = row.override;
    }
    return map;
  }, []);
}

// ---------------------------------------------------------------------------
// Catch-Up Queue
// ---------------------------------------------------------------------------

/**
 * Returns dates since `lastCheckedDate` that have scheduled classes
 * but no logged attendance yet. Used to prompt the student to fill in
 * past attendance from memory or ETLAB.
 */
export function useCatchUpQueue(lastCheckedDate: string, todayDate: string): CatchUpEntry[] | undefined {
  const timetableRows = useTimetableRows();
  const overrides = useCalendarOverrides();
  const dailyLogs = useDailyLogs();

  return useLiveQuery(async () => {
    if (!timetableRows || !overrides || !dailyLogs) return undefined;

    const timetable = timetableRowsToEngineFormat(timetableRows);
    const loggedDates = new Set(dailyLogs.map((l) => l.date));

    return getCatchUpQueue(lastCheckedDate, todayDate, timetable, overrides, loggedDates);
  }, [timetableRows, overrides, dailyLogs, lastCheckedDate, todayDate]);
}

/**
 * Computes the catch-up queue using the minimum `asOfDate` across `db.subjects`
 * as `lastCheckedDate` (falling back to `todayDate` when no subjects exist).
 */
export function useAppCatchUpQueue(todayDate: string): CatchUpEntry[] | undefined {
  const subjects = useSubjects();
  const timetableRows = useTimetableRows();
  const overrides = useCalendarOverrides();
  const dailyLogs = useDailyLogs();

  if (!subjects || !timetableRows || !overrides || !dailyLogs) return undefined;

  const validAsOfDates = subjects
    .map((s) => s.asOfDate)
    .filter((d) => /^\d{4}-\d{2}-\d{2}$/.test(d));

  const lastCheckedDate =
    validAsOfDates.length > 0
      ? validAsOfDates.reduce((min, d) => (d < min ? d : min), validAsOfDates[0]!)
      : todayDate;

  const timetable = timetableRowsToEngineFormat(timetableRows);
  const loggedDates = new Set(dailyLogs.map((l) => l.date));

  return getCatchUpQueue(lastCheckedDate, todayDate, timetable, overrides, loggedDates);
}

// ---------------------------------------------------------------------------
// Daily Logs
// ---------------------------------------------------------------------------

/** Returns all non-retired daily logs. */
export function useDailyLogs(): DailyLogRow[] | undefined {
  return useLiveQuery(
    () => db.dailyLogs.filter((l) => !l.retired).toArray(),
    []
  );
}

/** Returns all logs for a specific date. */
export function useLogsForDate(date: string): DailyLogRow[] | undefined {
  return useLiveQuery(
    () =>
      db.dailyLogs
        .where("date")
        .equals(date)
        .filter((l) => !l.retired)
        .toArray(),
    [date]
  );
}

// ---------------------------------------------------------------------------
// DL Records
// ---------------------------------------------------------------------------

/** Returns all DL records ordered by creation date descending. */
export function useDLRecords(): DLRecordRow[] | undefined {
  return useLiveQuery(
    () => db.dlRecords.orderBy("createdAt").reverse().toArray(),
    []
  );
}

/** Returns only pending/applied DL records (not yet reflected in ETLAB). */
export function usePendingDLs(): DLRecordRow[] | undefined {
  return useLiveQuery(
    () => db.dlRecords.where("status").anyOf(["logged", "certificate_received", "applied"]).toArray(),
    []
  );
}

// ---------------------------------------------------------------------------
// Composite: full attendance state with local overlay applied
// ---------------------------------------------------------------------------

/**
 * Computes effective attendance for every subject by layering local daily logs
 * on top of the ETLAB anchors. This is the state the app's main screen should
 * use for all Step 1 calculations (isSafe, skipBuffer, etc.).
 */
export function useEffectiveSubjects(): EffectiveSubject[] | undefined {
  const subjects = useSubjects();
  const logs = useDailyLogs();

  if (!subjects || !logs) return undefined;

  return subjects.map((anchor) => {
    const subjectLogs = logs.filter(
      (l) => l.subjectId === anchor.id && l.date > anchor.asOfDate
    );

    let deltaAttended = 0;
    let deltaTotal = 0;

    for (const log of subjectLogs) {
      switch (log.status) {
        case "present":
          deltaAttended += log.hours;
          deltaTotal += log.hours;
          break;
        case "absent":
        case "dl":
          deltaTotal += log.hours;
          break;
        case "cancelled":
          break;
      }
    }

    return {
      id: anchor.id,
      code: anchor.code,
      name: anchor.name,
      kind: anchor.kind,
      hoursPerSession: anchor.hoursPerSession,
      attended: anchor.attended + deltaAttended,
      total: anchor.total + deltaTotal,
      ...(anchor.slotLetter !== undefined ? { slotLetter: anchor.slotLetter } : {}),
      ...(anchor.creditWise !== undefined ? { creditWise: anchor.creditWise } : {}),
      asOfDate: anchor.asOfDate,
      anchorAttended: anchor.attended,
      anchorTotal: anchor.total,
      overlayAttended: deltaAttended,
      overlayTotal: deltaTotal,
      missed: anchor.missed,
      dutyLeave: anchor.dutyLeave,
      isExamSubject: anchor.isExamSubject,
    };
  });
}

