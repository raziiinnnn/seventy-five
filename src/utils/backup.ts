/**
 * Export / Import backup and class-template sharing utilities.
 *
 * All functions are async and handle only serialization/validation —
 * no React, no state management, no side effects beyond reading/writing the DB.
 */

import { db } from "@/db/database";
import type { SubjectRow, TimetableRow, ProfileRow, DailyLogRow, DLRecordRow, CalendarOverrideRow } from "@/db/database";

// ---------------------------------------------------------------------------
// Versioning
// ---------------------------------------------------------------------------

const BACKUP_VERSION = 1;

export interface AppBackup {
  version: number;
  exportedAt: string;      // ISO 8601
  profile: ProfileRow | undefined;
  subjects: SubjectRow[];
  timetable: TimetableRow[];
  calendarOverrides: CalendarOverrideRow[];
  dailyLogs: DailyLogRow[];
  dlRecords: DLRecordRow[];
}

// ---------------------------------------------------------------------------
// Export
// ---------------------------------------------------------------------------

/**
 * Serializes every Dexie table into a JSON string.
 * The resulting string can be saved as a `.75pct.json` file.
 */
export async function exportAppDataJSON(): Promise<string> {
  const [profile, subjects, timetable, calendarOverrides, dailyLogs, dlRecords] =
    await Promise.all([
      db.profile.get("current"),
      db.subjects.orderBy("sortOrder").toArray(),
      db.timetable.toArray(),
      db.calendarOverrides.toArray(),
      db.dailyLogs.toArray(),
      db.dlRecords.toArray(),
    ]);

  const backup: AppBackup = {
    version: BACKUP_VERSION,
    exportedAt: new Date().toISOString(),
    profile,
    subjects,
    timetable,
    calendarOverrides,
    dailyLogs,
    dlRecords,
  };

  return JSON.stringify(backup, null, 2);
}

// ---------------------------------------------------------------------------
// Import
// ---------------------------------------------------------------------------

/**
 * Validates and restores/overwrites all Dexie tables from a JSON backup string.
 * Throws a descriptive error if the JSON is malformed or the version is unsupported.
 *
 * ⚠️  This wipes ALL existing data before importing — always offer a confirmation
 *      dialog in the UI before calling this.
 */
export async function importAppDataJSON(jsonStr: string): Promise<void> {
  let backup: unknown;
  try {
    backup = JSON.parse(jsonStr) as unknown;
  } catch {
    throw new Error("importAppDataJSON: invalid JSON — could not parse the backup file.");
  }

  assertIsAppBackup(backup);

  if (backup.version > BACKUP_VERSION) {
    throw new Error(
      `importAppDataJSON: backup version ${backup.version} is newer than ` +
      `this app's supported version ${BACKUP_VERSION}. Please update the app.`
    );
  }

  // Wipe and restore in a single transaction
  await db.transaction(
    "rw",
    [db.profile, db.subjects, db.timetable, db.calendarOverrides, db.dailyLogs, db.dlRecords],
    async () => {
      await Promise.all([
        db.profile.clear(),
        db.subjects.clear(),
        db.timetable.clear(),
        db.calendarOverrides.clear(),
        db.dailyLogs.clear(),
        db.dlRecords.clear(),
      ]);

      const writes: Promise<unknown>[] = [];

      if (backup.profile) {
        writes.push(db.profile.put(backup.profile));
      }
      if (backup.subjects.length > 0) {
        writes.push(db.subjects.bulkPut(backup.subjects));
      }
      if (backup.timetable.length > 0) {
        writes.push(db.timetable.bulkPut(backup.timetable));
      }
      if (backup.calendarOverrides.length > 0) {
        writes.push(db.calendarOverrides.bulkPut(backup.calendarOverrides));
      }
      if (backup.dailyLogs.length > 0) {
        writes.push(db.dailyLogs.bulkPut(backup.dailyLogs));
      }
      if (backup.dlRecords.length > 0) {
        writes.push(db.dlRecords.bulkPut(backup.dlRecords));
      }

      await Promise.all(writes);
    }
  );
}

// ---------------------------------------------------------------------------
// Class template sharing
// ---------------------------------------------------------------------------

/** Lightweight shareable format — subjects + timetable only, no personal data. */
export interface ClassTemplate {
  v: number;
  subjects: Array<
    Pick<
      SubjectRow,
      | "id"
      | "code"
      | "name"
      | "kind"
      | "hoursPerSession"
      | "sortOrder"
      | "isExamSubject"
      | "slotLetter"
      | "creditWise"
    >
  >;
  timetable: TimetableRow[];
}

/**
 * Generates a compact JSON string a classmate can paste into the app (or scan
 * via QR) to auto-fill subjects and timetable. Personal attendance numbers are
 * deliberately excluded.
 */
export function generateClassTemplateString(
  subjects: SubjectRow[],
  timetable: TimetableRow[]
): string {
  const template: ClassTemplate = {
    v: BACKUP_VERSION,
    subjects: subjects.map(
      ({
        id,
        code,
        name,
        kind,
        hoursPerSession,
        sortOrder,
        isExamSubject,
        slotLetter,
        creditWise,
      }) => ({
        id,
        code,
        name,
        kind,
        hoursPerSession,
        sortOrder,
        isExamSubject,
        ...(slotLetter !== undefined ? { slotLetter } : {}),
        ...(creditWise !== undefined ? { creditWise } : {}),
      })
    ),
    timetable,
  };
  // Compact — no pretty-printing to keep the QR payload small
  return JSON.stringify(template);
}

/**
 * Imports a class template into the database, adding subjects that don't yet
 * exist (by id) and upserting timetable rows. Existing attendance data is preserved.
 */
export async function importClassTemplate(templateStr: string): Promise<void> {
  let template: unknown;
  try {
    template = JSON.parse(templateStr) as unknown;
  } catch {
    throw new Error("importClassTemplate: invalid JSON.");
  }

  assertIsClassTemplate(template);

  await db.transaction("rw", [db.subjects, db.timetable], async () => {
    // Upsert subjects — bulkPut overwrites on matching id
    const subjectRows: SubjectRow[] = template.subjects.map((s) => ({
      ...s,
      // Start brand-new subjects from zero — the owner will sync ETLAB later
      attended: 0,
      total: 0,
      missed: 0,
      leave: 0,
      dutyLeave: 0,
      asOfDate: new Date().toISOString().slice(0, 10),
    }));
    await db.subjects.bulkPut(subjectRows);

    // Upsert timetable rows
    await db.timetable.bulkPut(template.timetable);
  });
}

// ---------------------------------------------------------------------------
// Private type guards
// ---------------------------------------------------------------------------

function assertIsAppBackup(value: unknown): asserts value is AppBackup {
  if (typeof value !== "object" || value === null) {
    throw new Error("importAppDataJSON: backup must be a JSON object.");
  }
  const v = value as Record<string, unknown>;
  if (typeof v["version"] !== "number") {
    throw new Error("importAppDataJSON: backup is missing a numeric `version` field.");
  }
  for (const key of ["subjects", "timetable", "calendarOverrides", "dailyLogs", "dlRecords"] as const) {
    if (!Array.isArray(v[key])) {
      throw new Error(`importAppDataJSON: backup is missing or has invalid \`${key}\` array.`);
    }
  }
}

function assertIsClassTemplate(value: unknown): asserts value is ClassTemplate {
  if (typeof value !== "object" || value === null) {
    throw new Error("importClassTemplate: template must be a JSON object.");
  }
  const v = value as Record<string, unknown>;
  if (typeof v["v"] !== "number") {
    throw new Error("importClassTemplate: template is missing a numeric `v` field.");
  }
  if (!Array.isArray(v["subjects"])) {
    throw new Error("importClassTemplate: template is missing a `subjects` array.");
  }
  if (!Array.isArray(v["timetable"])) {
    throw new Error("importClassTemplate: template is missing a `timetable` array.");
  }
}

