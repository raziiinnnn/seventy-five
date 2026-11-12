/**
 * Semester Calendar & Timetable engine.
 *
 * Rules:
 *  - Never calls new Date() — all dates arrive as "YYYY-MM-DD" strings.
 *  - Saturday rule: 2nd and 4th Saturdays are holidays; 1st, 3rd, 5th are working days.
 *  - All date arithmetic uses integer math (year/month/day components and Julian Day Numbers).
 */

import type {
  Weekday,
  ScheduledPeriod,
  Timetable,
  CalendarOverride,
  CalendarOverrides,
  CatchUpEntry,
  RemainingHours,
} from "./types2.js";

// ---------------------------------------------------------------------------
// Date parsing helpers (pure, no Date objects)
// ---------------------------------------------------------------------------

/** Parsed components of an ISO date string. */
interface DateParts {
  year: number;
  month: number; // 1–12
  day: number;   // 1–31
}

/** Parses "YYYY-MM-DD" into { year, month, day }. Throws on invalid input. */
function parseDateStr(dateStr: string): DateParts {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) {
    throw new Error(`Invalid date string: "${dateStr}". Expected "YYYY-MM-DD".`);
  }
  const year = parseInt(dateStr.slice(0, 4), 10);
  const month = parseInt(dateStr.slice(5, 7), 10);
  const day = parseInt(dateStr.slice(8, 10), 10);

  if (month < 1 || month > 12) {
    throw new Error(`Invalid month in date "${dateStr}": ${month}.`);
  }
  if (day < 1 || day > 31) {
    throw new Error(`Invalid day in date "${dateStr}": ${day}.`);
  }
  return { year, month, day };
}

/**
 * Converts a date to a Julian Day Number (integer) for arithmetic.
 * Algorithm: Meeus/Jones/Butcher — works for the entire Gregorian calendar.
 */
function toJDN(year: number, month: number, day: number): number {
  const a = Math.floor((14 - month) / 12);
  const y = year + 4800 - a;
  const m = month + 12 * a - 3;
  return day + Math.floor((153 * m + 2) / 5) + 365 * y +
    Math.floor(y / 4) - Math.floor(y / 100) + Math.floor(y / 400) - 32045;
}

/** Converts a Julian Day Number back to { year, month, day }. */
function fromJDN(jdn: number): DateParts {
  const a = jdn + 32044;
  const b = Math.floor((4 * a + 3) / 146097);
  const c = a - Math.floor((146097 * b) / 4);
  const d = Math.floor((4 * c + 3) / 1461);
  const e = c - Math.floor((1461 * d) / 4);
  const m = Math.floor((5 * e + 2) / 153);
  const day = e - Math.floor((153 * m + 2) / 5) + 1;
  const month = m + 3 - 12 * Math.floor(m / 10);
  const year = 100 * b + d - 4800 + Math.floor(m / 10);
  return { year, month, day };
}

/** Pads a number to 2 digits. */
function pad2(n: number): string {
  return n < 10 ? `0${n}` : `${n}`;
}

/** Converts DateParts back to "YYYY-MM-DD". */
function toDateStr(parts: DateParts): string {
  return `${parts.year}-${pad2(parts.month)}-${pad2(parts.day)}`;
}

/** Returns the day-of-week for a date as 0=Sun … 6=Sat. */
function getDayOfWeek(year: number, month: number, day: number): number {
  return (toJDN(year, month, day) + 1) % 7;
}

/** Returns the ISO date string for `jdn`. */
function jdnToDateStr(jdn: number): string {
  return toDateStr(fromJDN(jdn));
}

/** Returns the Weekday key ("mon"…"sat") for a given date, or null for Sunday. */
function toWeekdayKey(dayOfWeek: number): Weekday | null {
  switch (dayOfWeek) {
    case 1: return "mon";
    case 2: return "tue";
    case 3: return "wed";
    case 4: return "thu";
    case 5: return "fri";
    case 6: return "sat";
    default: return null; // Sunday
  }
}

// ---------------------------------------------------------------------------
// Saturday ordinal calculation
// ---------------------------------------------------------------------------

/**
 * Returns which occurrence of Saturday within the month this date is.
 * e.g., 1st Saturday = 1, 2nd Saturday = 2, etc.
 * Caller must ensure dayOfWeek === 6.
 */
function saturdayOrdinal(year: number, month: number, day: number): number {
  // Saturdays in a month: day 1-7 → 1st, 8-14 → 2nd, 15-21 → 3rd, 22-28 → 4th, 29+ → 5th
  return Math.floor((day - 1) / 7) + 1;
}

// ---------------------------------------------------------------------------
// Public functions
// ---------------------------------------------------------------------------

/** Adds `offsetDays` (can be negative or zero) to an ISO `"YYYY-MM-DD"` date string. */
export function addDaysToDate(dateStr: string, offsetDays: number): string {
  const { year, month, day } = parseDateStr(dateStr);
  return jdnToDateStr(toJDN(year, month, day) + offsetDays);
}

/** Returns the weekday key (`"mon"`..`"sat"`) or `"sun"` for an ISO date string. */
export function getWeekdayKey(dateStr: string): Weekday | "sun" {
  const { year, month, day } = parseDateStr(dateStr);
  return toWeekdayKey(getDayOfWeek(year, month, day)) ?? "sun";
}

/**
 * Returns true if the given date is a default working day.
 * Mon–Fri are always working days.
 * Saturday: 2nd and 4th are holidays; 1st, 3rd, 5th are working days.
 * Sunday: always a holiday.
 */
export function isDefaultWorkingDay(dateStr: string): boolean {
  const { year, month, day } = parseDateStr(dateStr);
  const dow = getDayOfWeek(year, month, day);

  if (dow === 0) return false; // Sunday
  if (dow >= 1 && dow <= 5) return true; // Mon–Fri

  // Saturday
  const ordinal = saturdayOrdinal(year, month, day);
  return ordinal !== 2 && ordinal !== 4; // 1st, 3rd, 5th are working
}

/**
 * Returns the scheduled periods for a given date, applying overrides.
 *
 * Override precedence (highest first):
 *   1. "holiday"        → []
 *   2. "follow_weekday" → timetable[weekday]
 *   3. "custom_periods" → override.periods
 *   4. Default working day → timetable[weekdayKey]
 *   5. Non-working day → []
 */
export function getScheduledPeriodsForDate(
  dateStr: string,
  timetable: Timetable,
  calendarOverrides: CalendarOverrides
): ScheduledPeriod[] {
  const { year, month, day } = parseDateStr(dateStr);
  const override = calendarOverrides[dateStr];

  if (override) {
    if (override.kind === "holiday") return [];
    if (override.kind === "follow_weekday") {
      return (timetable[override.weekday] ?? []).slice();
    }
    if (override.kind === "custom_periods") {
      return override.periods.slice();
    }
  }

  if (!isDefaultWorkingDay(dateStr)) return [];

  const dow = getDayOfWeek(year, month, day);
  const key = toWeekdayKey(dow);
  if (key === null) return [];

  return (timetable[key] ?? []).slice();
}

/**
 * Returns all working dates in the half-open range (lastCheckedDate, todayDate]
 * that have at least one scheduled period and are NOT yet in loggedDatesSet.
 * Results are chronological.
 */
export function getCatchUpQueue(
  lastCheckedDate: string,
  todayDate: string,
  timetable: Timetable,
  calendarOverrides: CalendarOverrides,
  loggedDatesSet: Set<string>
): CatchUpEntry[] {
  const { year: y1, month: m1, day: d1 } = parseDateStr(lastCheckedDate);
  const { year: y2, month: m2, day: d2 } = parseDateStr(todayDate);

  const startJDN = toJDN(y1, m1, d1) + 1; // strictly AFTER lastCheckedDate
  const endJDN = toJDN(y2, m2, d2);       // inclusive

  if (startJDN > endJDN) return [];

  const queue: CatchUpEntry[] = [];

  for (let jdn = startJDN; jdn <= endJDN; jdn++) {
    const dateStr = jdnToDateStr(jdn);
    if (loggedDatesSet.has(dateStr)) continue;

    const periods = getScheduledPeriodsForDate(dateStr, timetable, calendarOverrides);
    if (periods.length === 0) continue;

    queue.push({ date: dateStr, periods });
  }

  return queue;
}

/**
 * Sums total scheduled hours per subjectId across all working days in
 * (fromDateAfter, semesterEndDate] so the simulator knows how many hours remain.
 */
export function projectRemainingClasses(
  fromDateAfter: string,
  semesterEndDate: string,
  timetable: Timetable,
  calendarOverrides: CalendarOverrides
): RemainingHours {
  const { year: y1, month: m1, day: d1 } = parseDateStr(fromDateAfter);
  const { year: y2, month: m2, day: d2 } = parseDateStr(semesterEndDate);

  const startJDN = toJDN(y1, m1, d1) + 1;
  const endJDN = toJDN(y2, m2, d2);

  const totals: RemainingHours = {};

  for (let jdn = startJDN; jdn <= endJDN; jdn++) {
    const dateStr = jdnToDateStr(jdn);
    const periods = getScheduledPeriodsForDate(dateStr, timetable, calendarOverrides);
    for (const p of periods) {
      totals[p.subjectId] = (totals[p.subjectId] ?? 0) + p.hours;
    }
  }

  return totals;
}

