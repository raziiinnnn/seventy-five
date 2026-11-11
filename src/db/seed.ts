/**
 * Seed data for initial testing.
 *
 * Uses the 8 real ETLAB subjects from Step 2's checksum tests
 * (overall: 407 attended / 489 total) and a typical KTU S5 CSE timetable.
 *
 * Call `seedDatabase()` once on first launch (guard with profile existence check).
 */

import { db } from "./database";
import type { SubjectRow, TimetableRow } from "./database";

// ---------------------------------------------------------------------------
// Subject seed — matches the 8-card ETLAB fixture exactly
// ---------------------------------------------------------------------------

export const SEED_SUBJECTS: Omit<SubjectRow, "id">[] = [
  {
    code: "CS309",
    name: "Object Oriented Programming",
    kind: "theory",
    hoursPerSession: 1,
    attended: 64,
    total: 79,
    missed: 15,
    dutyLeave: 0,
    asOfDate: "2026-11-11",
    isExamSubject: false,
    sortOrder: 1,
  },
  {
    code: "CS307",
    name: "Theory of Computation",
    kind: "theory",
    hoursPerSession: 1,
    attended: 63,
    total: 75,
    missed: 12,
    dutyLeave: 0,
    asOfDate: "2026-11-11",
    isExamSubject: false,
    sortOrder: 2,
  },
  {
    code: "CS303",
    name: "Data Structures",
    kind: "theory",
    hoursPerSession: 1,
    attended: 63,
    total: 78,
    missed: 15,
    dutyLeave: 0,
    asOfDate: "2026-11-11",
    isExamSubject: false,
    sortOrder: 3,
  },
  {
    code: "CS305",
    name: "Computer Architecture",
    kind: "theory",
    hoursPerSession: 1,
    attended: 69,
    total: 87,
    missed: 18,
    dutyLeave: 0,
    asOfDate: "2026-11-11",
    isExamSubject: false,
    sortOrder: 4,
  },
  {
    code: "HU301",
    name: "Life Skills",
    kind: "theory",
    hoursPerSession: 1,
    attended: 46,
    total: 48,
    missed: 2,
    dutyLeave: 0,
    asOfDate: "2026-11-11",
    isExamSubject: false,
    sortOrder: 5,
  },
  {
    code: "CS331",
    name: "OOP Lab",
    kind: "lab",
    hoursPerSession: 3,
    attended: 33,
    total: 36,
    missed: 3,
    dutyLeave: 0,
    asOfDate: "2026-11-11",
    isExamSubject: false,
    sortOrder: 6,
  },
  {
    code: "CS333",
    name: "Data Structures Lab",
    kind: "lab",
    hoursPerSession: 3,
    attended: 30,
    total: 33,
    missed: 3,
    dutyLeave: 0,
    asOfDate: "2026-11-11",
    isExamSubject: false,
    sortOrder: 7,
  },
  {
    code: "ES301",
    name: "Environmental Science",
    kind: "theory",
    hoursPerSession: 1,
    attended: 39,
    total: 53,
    missed: 14,
    dutyLeave: 0,
    asOfDate: "2026-11-11",
    isExamSubject: false,
    sortOrder: 8,
  },
];

// ---------------------------------------------------------------------------
// Timetable seed — representative S5 CSE weekly schedule
// ---------------------------------------------------------------------------

export const SEED_TIMETABLE: TimetableRow[] = [
  {
    weekday: "mon",
    periods: [
      { period: 1, subjectId: "CS309", hours: 1 },
      { period: 2, subjectId: "CS309", hours: 1 },
      { period: 3, subjectId: "CS307", hours: 1 },
      { period: 4, subjectId: "CS303", hours: 1 },
      { period: 5, subjectId: "CS305", hours: 1 },
    ],
  },
  {
    weekday: "tue",
    periods: [
      { period: 1, subjectId: "CS307", hours: 1 },
      { period: 2, subjectId: "CS305", hours: 1 },
      { period: 3, subjectId: "CS303", hours: 1 },
      { period: 4, subjectId: "HU301", hours: 1 },
      { period: 5, subjectId: "ES301", hours: 1 },
    ],
  },
  {
    weekday: "wed",
    periods: [
      { period: 1, subjectId: "CS309", hours: 1 },
      { period: 2, subjectId: "CS307", hours: 1 },
      { period: 3, subjectId: "CS305", hours: 1 },
      // OOP Lab — 3-hour block
      { period: 4, subjectId: "CS331", hours: 3 },
    ],
  },
  {
    weekday: "thu",
    periods: [
      { period: 1, subjectId: "CS303", hours: 1 },
      { period: 2, subjectId: "CS309", hours: 1 },
      { period: 3, subjectId: "CS305", hours: 1 },
      { period: 4, subjectId: "ES301", hours: 1 },
      // DS Lab — 3-hour block
      { period: 5, subjectId: "CS333", hours: 3 },
    ],
  },
  {
    weekday: "fri",
    periods: [
      { period: 1, subjectId: "CS307", hours: 1 },
      { period: 2, subjectId: "CS303", hours: 1 },
      { period: 3, subjectId: "HU301", hours: 1 },
      { period: 4, subjectId: "ES301", hours: 1 },
    ],
  },
  {
    weekday: "sat",
    periods: [
      { period: 1, subjectId: "CS309", hours: 1 },
      { period: 2, subjectId: "CS305", hours: 1 },
    ],
  },
];

// ---------------------------------------------------------------------------
// Seed function — idempotent; skips if data already exists
// ---------------------------------------------------------------------------

/**
 * Seeds the database with the 8 ETLAB subjects and the weekly timetable.
 * Safe to call on every app launch — exits early if profile already exists.
 */
export async function seedDatabase(): Promise<void> {
  const existing = await db.profile.get("current");
  if (existing) return; // already seeded

  await db.transaction("rw", [db.profile, db.subjects, db.timetable], async () => {
    // Profile
    await db.profile.put({
      id: "current",
      name: "",
      department: "Computer Science & Engineering",
      branch: "CSE",
      semester: 5,
      createdAt: new Date().toISOString(),
    });

    // Subjects — assign stable IDs using the subject code
    for (const s of SEED_SUBJECTS) {
      await db.subjects.put({ id: s.code, ...s });
    }

    // Timetable rows — the seed uses codes as subjectIds
    for (const row of SEED_TIMETABLE) {
      await db.timetable.put(row);
    }
  });
}

