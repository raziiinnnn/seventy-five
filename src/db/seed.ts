/**
 * Seed data for initial testing.
 *
 * Uses the 8 real Semester 5 CSE-AI ETLAB subjects
 * (overall: 407 attended / 489 total) and a representative KTU S5 CSE-AI timetable.
 *
 * Call `seedDatabase()` once on first launch (guard with profile existence check).
 */

import { db } from "./database";
import type { SubjectRow, TimetableRow } from "./database";

// ---------------------------------------------------------------------------
// Subject seed — exact 8-card Semester 5 CSE-AI ETLAB dataset (407 / 489)
// ---------------------------------------------------------------------------

export const SEED_SUBJECTS: Omit<SubjectRow, "id">[] = [
  {
    code: "PCCST501",
    slotLetter: "A",
    name: "COMPUTER NETWORKS",
    kind: "theory",
    hoursPerSession: 1,
    attended: 64,
    total: 79,
    missed: 15,
    leave: 0,
    dutyLeave: 0,
    creditWise: "8 / 10",
    asOfDate: "2026-11-11",
    isExamSubject: false,
    sortOrder: 1,
  },
  {
    code: "PCCAT502",
    slotLetter: "B",
    name: "INTRODUCTION TO ARTIFICIAL INTELLIGENCE",
    kind: "theory",
    hoursPerSession: 1,
    attended: 63,
    total: 75,
    missed: 12,
    leave: 0,
    dutyLeave: 0,
    creditWise: "8 / 10",
    asOfDate: "2026-11-11",
    isExamSubject: false,
    sortOrder: 2,
  },
  {
    code: "PCCST503",
    slotLetter: "C",
    name: "MACHINE LEARNING",
    kind: "theory",
    hoursPerSession: 1,
    attended: 63,
    total: 78,
    missed: 15,
    leave: 0,
    dutyLeave: 0,
    creditWise: "8 / 10",
    asOfDate: "2026-11-11",
    isExamSubject: false,
    sortOrder: 3,
  },
  {
    code: "PBCAT504",
    slotLetter: "D",
    name: "ADVANCED GRAPH ALGORITHM",
    kind: "theory",
    hoursPerSession: 1,
    attended: 69,
    total: 87,
    missed: 18,
    leave: 0,
    dutyLeave: 0,
    creditWise: "6 / 10",
    asOfDate: "2026-11-11",
    isExamSubject: false,
    sortOrder: 4,
  },
  {
    code: "PEAIT523",
    slotLetter: "E",
    name: "HEALTHCARE ANALYTICS",
    kind: "theory",
    hoursPerSession: 1,
    attended: 46,
    total: 48,
    missed: 2,
    leave: 0,
    dutyLeave: 0,
    creditWise: "10 / 10",
    asOfDate: "2026-11-11",
    isExamSubject: false,
    sortOrder: 5,
  },
  {
    code: "PCCAL507",
    slotLetter: "L",
    name: "AI ALGORITHMS LAB",
    kind: "lab",
    hoursPerSession: 3,
    attended: 33,
    total: 36,
    missed: 3,
    leave: 0,
    dutyLeave: 0,
    creditWise: "10 / 10",
    asOfDate: "2026-11-11",
    isExamSubject: false,
    sortOrder: 6,
  },
  {
    code: "PCCSL508",
    slotLetter: "Q",
    name: "MACHINE LEARNING LAB",
    kind: "lab",
    hoursPerSession: 3,
    attended: 30,
    total: 33,
    missed: 3,
    leave: 0,
    dutyLeave: 0,
    creditWise: "10 / 10",
    asOfDate: "2026-11-11",
    isExamSubject: false,
    sortOrder: 7,
  },
  {
    code: "PLT-2026",
    slotLetter: "Z",
    name: "PLACEMENT TRAINING",
    kind: "theory",
    hoursPerSession: 1,
    attended: 39,
    total: 53,
    missed: 14,
    leave: 0,
    dutyLeave: 0,
    asOfDate: "2026-11-11",
    isExamSubject: false,
    sortOrder: 8,
  },
];

// ---------------------------------------------------------------------------
// Timetable seed — representative S5 CSE-AI weekly schedule
// ---------------------------------------------------------------------------

export const SEED_TIMETABLE: TimetableRow[] = [
  {
    weekday: "mon",
    periods: [
      { period: 1, subjectId: "PCCST501", hours: 1 },
      { period: 2, subjectId: "PCCST501", hours: 1 },
      { period: 3, subjectId: "PCCAT502", hours: 1 },
      { period: 4, subjectId: "PCCST503", hours: 1 },
      { period: 5, subjectId: "PBCAT504", hours: 1 },
    ],
  },
  {
    weekday: "tue",
    periods: [
      { period: 1, subjectId: "PCCAT502", hours: 1 },
      { period: 2, subjectId: "PBCAT504", hours: 1 },
      { period: 3, subjectId: "PCCST503", hours: 1 },
      { period: 4, subjectId: "PEAIT523", hours: 1 },
      { period: 5, subjectId: "PLT-2026", hours: 1 },
    ],
  },
  {
    weekday: "wed",
    periods: [
      { period: 1, subjectId: "PCCST501", hours: 1 },
      { period: 2, subjectId: "PCCAT502", hours: 1 },
      { period: 3, subjectId: "PBCAT504", hours: 1 },
      // AI Algorithms Lab — 3-hour block
      { period: 4, subjectId: "PCCAL507", hours: 3 },
    ],
  },
  {
    weekday: "thu",
    periods: [
      { period: 1, subjectId: "PCCST503", hours: 1 },
      { period: 2, subjectId: "PCCST501", hours: 1 },
      { period: 3, subjectId: "PBCAT504", hours: 1 },
      { period: 4, subjectId: "PLT-2026", hours: 1 },
      // Machine Learning Lab — 3-hour block
      { period: 5, subjectId: "PCCSL508", hours: 3 },
    ],
  },
  {
    weekday: "fri",
    periods: [
      { period: 1, subjectId: "PCCAT502", hours: 1 },
      { period: 2, subjectId: "PCCST503", hours: 1 },
      { period: 3, subjectId: "PEAIT523", hours: 1 },
      { period: 4, subjectId: "PLT-2026", hours: 1 },
    ],
  },
  {
    weekday: "sat",
    periods: [
      { period: 1, subjectId: "PCCST501", hours: 1 },
      { period: 2, subjectId: "PBCAT504", hours: 1 },
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
      branch: "CSE-AI",
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
