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

/** Returns the aggregate attended/total using Step 1's overallOf. */
export function useOverallAttendance() {
  const subjects = useSubjects();
  if (!subjects) return undefined;
  return overallOf(subjectRowsToEngineSubjects(subjects));
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

// ---------------------------------------------------------------------------
// Daily Logs
// ---------------------------------------------------------------------------

/** Returns all non-retired daily logs. */
export function useDailyLogs(): DailyLogRow[] | undefined {
  return useLiveQuery(
    () => db.dailyLogs.where("retired").equals(0).toArray(),
    []
  );
}

/** Returns all logs for a specific date. */
export function useLogsForDate(date: string): DailyLogRow[] | undefined {
  return useLiveQuery(
    () => db.dailyLogs.where({ date, retired: 0 }).toArray(),
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
export function useEffectiveSubjects(): Subject[] | undefined {
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
    };
  });
}

