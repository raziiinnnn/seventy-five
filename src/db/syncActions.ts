/**
 * Database Sync & Reconciliation Actions.
 *
 * Connects the pure engine reconcile functions to Dexie (IndexedDB).
 * All functions are async and use Dexie transactions where writes are involved.
 *
 * None of these are imported in Vitest tests — they are browser-only.
 */

import { db } from "@/db/database";
import {
  inferAsOfDateAndReconcile,
} from "@/engine/reconcile";
import type { ParsedEtlabCard } from "@/engine/ocrParser";
import type {
  EtlabAnchor,
  EtlabSnapshot,
  DailyLog,
  DLRecord,
  Timetable,
  CalendarOverrides,
  ReconcileResult,
} from "@/engine/types2";
import type { TimetableRow, DailyLogRow, DLRecordRow, SubjectRow } from "@/db/database";
import { timetableRowsToEngineFormat } from "@/hooks/useAttendanceStore";

// ---------------------------------------------------------------------------
// Helper: row → engine type converters
// ---------------------------------------------------------------------------

function subjectRowToAnchor(row: SubjectRow): EtlabAnchor {
  return {
    subjectId: row.id,
    attended: row.attended,
    total: row.total,
    missed: row.missed,
    dutyLeave: row.dutyLeave,
    asOfDate: row.asOfDate,
  };
}

function dailyLogRowToEngineLog(row: DailyLogRow): DailyLog {
  return {
    date: row.date,
    subjectId: row.subjectId,
    period: row.period,
    event: row.status,
    hours: row.hours,
  };
}

function dlRecordRowToEngineDL(row: DLRecordRow): DLRecord {
  return {
    id: row.id,
    subjectId: row.subjectId,
    hours: row.hours,
    logDates: row.logDates,
    status: row.status,
  };
}

function parsedCardToSnapshot(card: ParsedEtlabCard): EtlabSnapshot {
  return {
    attended: card.attended,
    total: card.total,
    missed: card.missed,
    dutyLeave: card.dutyLeave,
  };
}

/**
 * Matches an extracted OCR card against existing DB subjects by:
 *  1. Exact id or code match (`s.id === card.code || s.code === card.code`), then
 *  2. Case-insensitive id/code match, then
 *  3. Slot letter match (`card.slotLetter && s.slotLetter === card.slotLetter`).
 *
 * Preserving the matched SubjectRow lets callers keep `existing.id` so logs
 * and DL records reconcile against the existing subject instead of creating a duplicate.
 */
export function findMatchingSubject(
  subjectRows: SubjectRow[],
  card: ParsedEtlabCard
): SubjectRow | undefined {
  const codeUpper = card.code.trim().toUpperCase();
  const slotUpper = card.slotLetter.trim().toUpperCase();

  return (
    subjectRows.find((s) => s.code === card.code || s.id === card.code) ??
    subjectRows.find(
      (s) => s.code.toUpperCase() === codeUpper || s.id.toUpperCase() === codeUpper
    ) ??
    (slotUpper
      ? subjectRows.find(
          (s) => s.slotLetter?.trim().toUpperCase() === slotUpper
        )
      : undefined)
  );
}

// ---------------------------------------------------------------------------
// previewEtlabSync
// ---------------------------------------------------------------------------

export interface SyncPreviewItem {
  card: ParsedEtlabCard;
  isNew: boolean;
  existingName?: string;
  oldAnchor?: EtlabAnchor;
  reconcileResult?: ReconcileResult;
  /** True when the card's total < anchor total — user might have reset ETLAB. */
  allowReset?: boolean;
}

async function loadSyncContext() {
  const [subjectRows, logRows, timetableRows, overrideRows, dlRows] =
    await Promise.all([
      db.subjects.toArray(),
      db.dailyLogs.filter((l) => !l.retired).toArray(),
      db.timetable.toArray(),
      db.calendarOverrides.toArray(),
      db.dlRecords.toArray(),
    ]);

  const engineLogs: DailyLog[] = logRows.map(dailyLogRowToEngineLog);
  const engineDLs: DLRecord[] = dlRows.map(dlRecordRowToEngineDL);
  const timetable: Timetable = timetableRowsToEngineFormat(
    timetableRows as TimetableRow[]
  );

  const overrides: CalendarOverrides = {};
  for (const row of overrideRows) {
    overrides[row.date] = row.override;
  }

  return { subjectRows, engineLogs, engineDLs, timetable, overrides };
}

/**
 * Dry-run: computes what would change if these OCR cards were committed.
 * Reads current DB state, runs reconciliation per card, and returns a
 * preview item for each card (showing new vs. existing, mismatch info, etc.).
 *
 * Does NOT write to the database.
 */
export async function previewEtlabSync(
  cards: ParsedEtlabCard[],
  syncDateStr: string
): Promise<SyncPreviewItem[]> {
  const { subjectRows, engineLogs, engineDLs, timetable, overrides } =
    await loadSyncContext();

  const results: SyncPreviewItem[] = [];

  for (const card of cards) {
    const existing = findMatchingSubject(subjectRows, card);

    if (!existing) {
      results.push({ card, isNew: true });
      continue;
    }

    const existingName = existing.name.trim() ? existing.name : undefined;
    const oldAnchor = subjectRowToAnchor(existing);
    const snapshot = parsedCardToSnapshot(card);
    const allowReset = card.total < oldAnchor.total;

    try {
      const reconcileResult = inferAsOfDateAndReconcile(
        oldAnchor,
        snapshot,
        engineLogs,
        timetable,
        overrides,
        engineDLs,
        { walkToDate: syncDateStr, allowReset }
      );
      results.push({
        card,
        isNew: false,
        ...(existingName !== undefined ? { existingName } : {}),
        oldAnchor,
        reconcileResult,
        allowReset,
      });
    } catch {
      // Surface as a preview item with no reconcileResult so the UI can warn
      results.push({
        card,
        isNew: false,
        ...(existingName !== undefined ? { existingName } : {}),
        oldAnchor,
        allowReset,
      });
    }
  }

  return results;
}

// ---------------------------------------------------------------------------
// commitEtlabSync
// ---------------------------------------------------------------------------

/**
 * Commits the OCR cards as a Dexie transaction:
 * 1. For each card matched by code, id, or slotLetter: runs reconciliation
 *    while preserving `existing.id`, updates the subject anchor, retires
 *    local logs that are now subsumed by ETLAB, and updates DL records.
 * 2. New subjects (not yet in the DB) are inserted with defaults.
 *
 * All writes happen inside a single Dexie transaction for atomicity.
 */
export async function commitEtlabSync(
  cards: ParsedEtlabCard[],
  syncDateStr: string
): Promise<void> {
  // Read outside the rw transaction (Dexie rw transactions restrict async work)
  const { subjectRows, engineLogs, engineDLs, timetable, overrides } =
    await loadSyncContext();

  let nextSortOrder = Math.max(0, ...subjectRows.map((r) => r.sortOrder)) + 1;

  await db.transaction("rw", [db.subjects, db.dailyLogs, db.dlRecords], async () => {
    for (const card of cards) {
      const existing = findMatchingSubject(subjectRows, card);

      if (!existing) {
        const newRow: SubjectRow = {
          id: card.code,
          code: card.code,
          name: card.name,
          kind: card.kind,
          hoursPerSession: card.hoursPerSession,
          attended: card.attended,
          total: card.total,
          missed: card.missed,
          leave: card.leave,
          dutyLeave: card.dutyLeave,
          asOfDate: syncDateStr,
          isExamSubject: false,
          sortOrder: nextSortOrder++,
          ...(card.slotLetter ? { slotLetter: card.slotLetter } : {}),
          ...(card.creditWise !== undefined ? { creditWise: card.creditWise } : {}),
        };
        await db.subjects.put(newRow);
        continue;
      }

      const oldAnchor = subjectRowToAnchor(existing);
      const snapshot = parsedCardToSnapshot(card);
      const allowReset = card.total < oldAnchor.total;
      const preservedName = existing.name.trim().length > 0 ? existing.name : card.name;
      const resolvedSlot = card.slotLetter || existing.slotLetter;
      const resolvedCredit = card.creditWise ?? existing.creditWise;

      let reconcileResult: ReconcileResult;
      try {
        reconcileResult = inferAsOfDateAndReconcile(
          oldAnchor,
          snapshot,
          engineLogs,
          timetable,
          overrides,
          engineDLs,
          { walkToDate: syncDateStr, allowReset }
        );
      } catch {
        // If reconcile fails, hard-update anchor while preserving existing.id and clean name
        await db.subjects.update(existing.id, {
          name: preservedName,
          attended: card.attended,
          total: card.total,
          missed: card.missed,
          leave: card.leave,
          dutyLeave: card.dutyLeave,
          asOfDate: syncDateStr,
          ...(resolvedSlot ? { slotLetter: resolvedSlot } : {}),
          ...(resolvedCredit !== undefined ? { creditWise: resolvedCredit } : {}),
        });
        continue;
      }

      const { newAnchor, retiredLogs, updatedDLRecords } = reconcileResult;

      // Update subject anchor in-place (preserving existing.id and existing non-empty name)
      await db.subjects.update(existing.id, {
        name: preservedName,
        attended: newAnchor.attended,
        total: newAnchor.total,
        missed: newAnchor.missed,
        leave: card.leave, // ETLAB carries leave directly
        dutyLeave: newAnchor.dutyLeave,
        asOfDate: newAnchor.asOfDate,
        ...(resolvedSlot ? { slotLetter: resolvedSlot } : {}),
        ...(resolvedCredit !== undefined ? { creditWise: resolvedCredit } : {}),
      });

      // Retire logs that fall on or before the new asOfDate
      if (retiredLogs.length > 0) {
        const retiredDates = new Set(retiredLogs.map((l) => l.date));
        await db.dailyLogs
          .where("[date+subjectId]")
          .anyOf([...retiredDates].map((d) => [d, existing.id]))
          .modify({ retired: true });
      }

      // Update DL records (auto-closed, flagged, etc.)
      for (const dl of updatedDLRecords) {
        const original = engineDLs.find((d) => d.id === dl.id);
        if (original && original.status !== dl.status) {
          await db.dlRecords.update(dl.id, { status: dl.status });
        }
      }
    }
  });
}

// ---------------------------------------------------------------------------
// saveQuickCalibration
// ---------------------------------------------------------------------------

export interface CalibrationUpdate {
  id: string;
  attended: number;
  total: number;
  missed: number;
  dutyLeave: number;
  leave: number;
}

/**
 * Saves manually-entered attendance numbers as new ETLAB anchors and
 * retires all local logs on or before the given asOfDate.
 *
 * Used by the Quick Calibration Drawer when the user wants to sync by
 * typing numbers directly instead of scanning screenshots.
 */
export async function saveQuickCalibration(
  updates: CalibrationUpdate[],
  asOfDate: string
): Promise<void> {
  await db.transaction("rw", [db.subjects, db.dailyLogs], async () => {
    for (const u of updates) {
      await db.subjects.update(u.id, {
        attended: u.attended,
        total: u.total,
        missed: u.missed,
        dutyLeave: u.dutyLeave,
        leave: u.leave,
        asOfDate,
      });

      // Retire all logs for this subject on or before asOfDate
      await db.dailyLogs
        .where("[date+subjectId]")
        .below([asOfDate + "\uffff", u.id])  // date <= asOfDate AND subjectId = u.id
        .filter((l) => !l.retired && l.subjectId === u.id && l.date <= asOfDate)
        .modify({ retired: true });
    }
  });
}
