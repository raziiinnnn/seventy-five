/**
 * Dexie transaction helpers for Daily Attendance Logs, Calendar Overrides,
 * and Weekly Timetable editing (Step 7).
 */

import { db } from "@/db/database";
import type { DailyLogRow } from "@/db/database";
import type {
  CalendarOverride,
  PeriodEvent,
  ScheduledPeriod,
  Weekday,
} from "@/engine/types2";

export interface DayLogEntryInput {
  period: number;
  subjectId: string;
  hours: number;
  status: PeriodEvent;
}

/**
 * Replaces all non-retired logs for `date` with `entries` inside one Dexie
 * transaction. Retired history rows on that date remain untouched.
 */
export async function saveDayAttendanceLogs(
  date: string,
  entries: DayLogEntryInput[]
): Promise<void> {
  await db.transaction("rw", db.dailyLogs, async () => {
    await db.dailyLogs
      .where("date")
      .equals(date)
      .and((l) => !l.retired)
      .delete();

    if (entries.length > 0) {
      const rows: Omit<DailyLogRow, "id">[] = entries.map((e) => ({
        date,
        subjectId: e.subjectId,
        period: e.period,
        status: e.status,
        hours: Math.max(1, Math.round(e.hours)),
        retired: false,
      }));
      await db.dailyLogs.bulkAdd(rows);
    }
  });
}

/**
 * Deletes all non-retired logs for `date` so a day can be re-logged or cleared.
 */
export async function clearDayAttendanceLogs(date: string): Promise<void> {
  await db.transaction("rw", db.dailyLogs, async () => {
    await db.dailyLogs
      .where("date")
      .equals(date)
      .and((l) => !l.retired)
      .delete();
  });
}

/**
 * Sets or removes a per-date calendar override.
 * When `override` is `null`, removes any override for `date`.
 * When marking a date as `"holiday"`, also clears any active non-retired
 * `dailyLogs` on that date.
 */
export async function setDateOverride(
  date: string,
  override: CalendarOverride | null
): Promise<void> {
  await db.transaction("rw", [db.calendarOverrides, db.dailyLogs], async () => {
    if (override === null) {
      await db.calendarOverrides.delete(date);
      return;
    }

    await db.calendarOverrides.put({ date, override });

    if (override.kind === "holiday") {
      await db.dailyLogs
        .where("date")
        .equals(date)
        .and((l) => !l.retired)
        .delete();
    }
  });
}

/**
 * Normalizes period numbers (`1, 2, ...`) and saves the weekly timetable row
 * for `weekday`.
 */
export async function saveWeekdayTimetable(
  weekday: Weekday,
  periods: ScheduledPeriod[]
): Promise<void> {
  const normalized: ScheduledPeriod[] = periods.map((p, idx) => ({
    period: idx + 1,
    subjectId: p.subjectId,
    hours: Math.max(1, Math.round(p.hours)),
  }));
  await db.timetable.put({ weekday, periods: normalized });
}

