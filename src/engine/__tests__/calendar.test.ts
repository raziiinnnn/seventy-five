/**
 * Tests for src/engine/calendar.ts
 *
 * Key dates used (2024 calendar):
 *  2024-11-02 → 1st Saturday of November 2024 (working)
 *  2024-11-09 → 2nd Saturday of November 2024 (holiday)
 *  2024-11-16 → 3rd Saturday of November 2024 (working)
 *  2024-11-23 → 4th Saturday of November 2024 (holiday)
 *  2024-11-30 → 5th Saturday of November 2024 (working)
 *  2024-11-03 → Sunday (holiday)
 *  2024-11-04 → Monday (working)
 *
 *  2024-03-02 → 1st Saturday of March 2024 (working)
 *  2024-03-09 → 2nd Saturday of March 2024 (holiday)
 *  2024-03-23 → 4th Saturday of March 2024 (holiday)
 *  2024-03-30 → 5th Saturday of March 2024 (working)
 */

import { describe, it, expect } from "vitest";
import {
  isDefaultWorkingDay,
  getScheduledPeriodsForDate,
  getCatchUpQueue,
  projectRemainingClasses,
} from "../calendar.js";
import type { Timetable, CalendarOverrides, ScheduledPeriod } from "../types2.js";

// ---------------------------------------------------------------------------
// Minimal timetable fixture
// ---------------------------------------------------------------------------
const timetable: Timetable = {
  mon: [
    { period: 1, subjectId: "CS101", hours: 1 },
    { period: 2, subjectId: "MA101", hours: 1 },
  ],
  tue: [
    { period: 1, subjectId: "CS101", hours: 1 },
    { period: 2, subjectId: "PH101", hours: 1 },
  ],
  wed: [
    { period: 1, subjectId: "MA101", hours: 1 },
    { period: 2, subjectId: "LAB01", hours: 3 },
  ],
  thu: [{ period: 1, subjectId: "CS101", hours: 1 }],
  fri: [
    { period: 1, subjectId: "PH101", hours: 1 },
    { period: 2, subjectId: "MA101", hours: 1 },
  ],
  sat: [{ period: 1, subjectId: "CS101", hours: 1 }],
};

const noOverrides: CalendarOverrides = {};

// ---------------------------------------------------------------------------
// isDefaultWorkingDay
// ---------------------------------------------------------------------------
describe("isDefaultWorkingDay", () => {
  // Saturdays in November 2024
  it("1st Saturday (2024-11-02) is a working day", () =>
    expect(isDefaultWorkingDay("2024-11-02")).toBe(true));
  it("2nd Saturday (2024-11-09) is a holiday", () =>
    expect(isDefaultWorkingDay("2024-11-09")).toBe(false));
  it("3rd Saturday (2024-11-16) is a working day", () =>
    expect(isDefaultWorkingDay("2024-11-16")).toBe(true));
  it("4th Saturday (2024-11-23) is a holiday", () =>
    expect(isDefaultWorkingDay("2024-11-23")).toBe(false));
  it("5th Saturday (2024-11-30) is a working day", () =>
    expect(isDefaultWorkingDay("2024-11-30")).toBe(true));

  // Other days
  it("Sunday (2024-11-03) is a holiday", () =>
    expect(isDefaultWorkingDay("2024-11-03")).toBe(false));
  it("Monday (2024-11-04) is a working day", () =>
    expect(isDefaultWorkingDay("2024-11-04")).toBe(true));
  it("Friday (2024-11-08) is a working day", () =>
    expect(isDefaultWorkingDay("2024-11-08")).toBe(true));

  // Saturdays in March 2024
  it("1st Saturday March 2024 (2024-03-02) is working", () =>
    expect(isDefaultWorkingDay("2024-03-02")).toBe(true));
  it("2nd Saturday March 2024 (2024-03-09) is holiday", () =>
    expect(isDefaultWorkingDay("2024-03-09")).toBe(false));
  it("4th Saturday March 2024 (2024-03-23) is holiday", () =>
    expect(isDefaultWorkingDay("2024-03-23")).toBe(false));
  it("5th Saturday March 2024 (2024-03-30) is working", () =>
    expect(isDefaultWorkingDay("2024-03-30")).toBe(true));

  it("throws on malformed date", () =>
    expect(() => isDefaultWorkingDay("2024/11/02")).toThrow());
  it("throws on invalid month", () =>
    expect(() => isDefaultWorkingDay("2024-13-01")).toThrow());
});

// ---------------------------------------------------------------------------
// getScheduledPeriodsForDate
// ---------------------------------------------------------------------------
describe("getScheduledPeriodsForDate", () => {
  it("Monday returns Monday timetable", () => {
    // 2024-11-04 is Monday
    const periods = getScheduledPeriodsForDate("2024-11-04", timetable, noOverrides);
    expect(periods).toHaveLength(2);
    expect(periods[0]?.subjectId).toBe("CS101");
    expect(periods[1]?.subjectId).toBe("MA101");
  });

  it("Sunday returns []", () => {
    // 2024-11-03 is Sunday
    expect(getScheduledPeriodsForDate("2024-11-03", timetable, noOverrides)).toEqual([]);
  });

  it("2nd Saturday returns [] (holiday by default)", () => {
    // 2024-11-09 is 2nd Saturday
    expect(getScheduledPeriodsForDate("2024-11-09", timetable, noOverrides)).toEqual([]);
  });

  it("1st Saturday returns Saturday timetable", () => {
    // 2024-11-02 is 1st Saturday
    const periods = getScheduledPeriodsForDate("2024-11-02", timetable, noOverrides);
    expect(periods).toHaveLength(1);
    expect(periods[0]?.subjectId).toBe("CS101");
  });

  it("holiday override returns [] even for a Monday", () => {
    const overrides: CalendarOverrides = {
      "2024-11-04": { kind: "holiday", reason: "Onam" },
    };
    expect(getScheduledPeriodsForDate("2024-11-04", timetable, overrides)).toEqual([]);
  });

  it("follow_weekday override makes a Saturday follow Tuesday's timetable", () => {
    // 2024-11-09 is 2nd Saturday (normally holiday); override to follow Tuesday
    const overrides: CalendarOverrides = {
      "2024-11-09": { kind: "follow_weekday", weekday: "tue" },
    };
    const periods = getScheduledPeriodsForDate("2024-11-09", timetable, overrides);
    expect(periods).toHaveLength(2);
    expect(periods[0]?.subjectId).toBe("CS101");
    expect(periods[1]?.subjectId).toBe("PH101");
  });

  it("custom_periods override returns exactly those periods", () => {
    const custom: ScheduledPeriod[] = [
      { period: 1, subjectId: "EXTRA", hours: 2 },
    ];
    const overrides: CalendarOverrides = {
      "2024-11-04": { kind: "custom_periods", periods: custom },
    };
    const periods = getScheduledPeriodsForDate("2024-11-04", timetable, overrides);
    expect(periods).toHaveLength(1);
    expect(periods[0]?.subjectId).toBe("EXTRA");
    expect(periods[0]?.hours).toBe(2);
  });
});

// ---------------------------------------------------------------------------
// getCatchUpQueue
// ---------------------------------------------------------------------------
describe("getCatchUpQueue", () => {
  it("returns dates strictly after lastCheckedDate up to and including todayDate", () => {
    // Range: 2024-11-04 (Mon) through 2024-11-06 (Wed), last checked 2024-11-03
    const queue = getCatchUpQueue(
      "2024-11-03",
      "2024-11-06",
      timetable,
      noOverrides,
      new Set()
    );
    const dates = queue.map((e) => e.date);
    expect(dates).toContain("2024-11-04"); // Mon
    expect(dates).toContain("2024-11-05"); // Tue
    expect(dates).toContain("2024-11-06"); // Wed
    expect(dates).not.toContain("2024-11-03"); // excluded (lastChecked)
  });

  it("skips Sundays", () => {
    // 2024-11-03 is Sunday; range Mon 2024-11-04 → Mon 2024-11-11
    const queue = getCatchUpQueue(
      "2024-11-02",
      "2024-11-11",
      timetable,
      noOverrides,
      new Set()
    );
    const dates = queue.map((e) => e.date);
    expect(dates).not.toContain("2024-11-03"); // Sunday
  });

  it("skips 2nd Saturday (2024-11-09)", () => {
    const queue = getCatchUpQueue(
      "2024-11-04",
      "2024-11-11",
      timetable,
      noOverrides,
      new Set()
    );
    const dates = queue.map((e) => e.date);
    expect(dates).not.toContain("2024-11-09"); // 2nd Saturday = holiday
  });

  it("includes 1st Saturday (2024-11-02) which has timetable entries", () => {
    const queue = getCatchUpQueue(
      "2024-11-01",
      "2024-11-02",
      timetable,
      noOverrides,
      new Set()
    );
    const dates = queue.map((e) => e.date);
    expect(dates).toContain("2024-11-02");
  });

  it("skips already-logged dates", () => {
    const logged = new Set(["2024-11-04"]); // Mon already logged
    const queue = getCatchUpQueue(
      "2024-11-03",
      "2024-11-06",
      timetable,
      noOverrides,
      logged
    );
    const dates = queue.map((e) => e.date);
    expect(dates).not.toContain("2024-11-04");
    expect(dates).toContain("2024-11-05");
  });

  it("returns empty when lastCheckedDate equals todayDate", () => {
    const queue = getCatchUpQueue(
      "2024-11-04",
      "2024-11-04",
      timetable,
      noOverrides,
      new Set()
    );
    expect(queue).toHaveLength(0);
  });

  it("includes periods in each entry", () => {
    const queue = getCatchUpQueue(
      "2024-11-03",
      "2024-11-04",
      timetable,
      noOverrides,
      new Set()
    );
    expect(queue[0]?.periods.length).toBeGreaterThan(0);
  });

  it("respects holiday override — skips a Monday marked as holiday", () => {
    const overrides: CalendarOverrides = {
      "2024-11-04": { kind: "holiday", reason: "Onam" },
    };
    const queue = getCatchUpQueue(
      "2024-11-03",
      "2024-11-05",
      timetable,
      overrides,
      new Set()
    );
    const dates = queue.map((e) => e.date);
    expect(dates).not.toContain("2024-11-04");
    expect(dates).toContain("2024-11-05");
  });
});

// ---------------------------------------------------------------------------
// projectRemainingClasses
// ---------------------------------------------------------------------------
describe("projectRemainingClasses", () => {
  it("sums hours per subject over the remaining window", () => {
    // Mon 2024-11-04 to Fri 2024-11-08 (5 days):
    //   Mon: CS101×1, MA101×1
    //   Tue: CS101×1, PH101×1
    //   Wed: MA101×1, LAB01×3
    //   Thu: CS101×1
    //   Fri: PH101×1, MA101×1
    const remaining = projectRemainingClasses(
      "2024-11-03",
      "2024-11-08",
      timetable,
      noOverrides
    );
    expect(remaining["CS101"]).toBe(3);  // Mon + Tue + Thu
    expect(remaining["MA101"]).toBe(3);  // Mon + Wed + Fri
    expect(remaining["PH101"]).toBe(2);  // Tue + Fri
    expect(remaining["LAB01"]).toBe(3);  // Wed (3h lab)
  });

  it("excludes the fromDateAfter itself", () => {
    // Start from 2024-11-04 → only Tue onwards
    const remaining = projectRemainingClasses(
      "2024-11-04",
      "2024-11-05",
      timetable,
      noOverrides
    );
    // Only Tue 2024-11-05
    expect(remaining["CS101"]).toBe(1);
    expect(remaining["PH101"]).toBe(1);
    expect(remaining["MA101"]).toBeUndefined();
  });

  it("returns empty object for a past-only window", () => {
    const remaining = projectRemainingClasses(
      "2024-11-08",
      "2024-11-07",
      timetable,
      noOverrides
    );
    expect(Object.keys(remaining)).toHaveLength(0);
  });
});

