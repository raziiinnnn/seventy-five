/**
 * Database actions for Duty Leave (DL) records and Student Profile (Step 8).
 */

import { db } from "@/db/database";
import type { DLRecordRow } from "@/db/database";
import type { DLStatus } from "@/engine/types2";

export interface CreateDLRecordInput {
  eventName: string;
  subjectId: string;
  hours: number;
  logDates: string[];
  status?: DLStatus;
}

/**
 * Validates and creates a new Duty Leave record in Dexie.
 * Generates a stable UUID and defaults status to "logged".
 */
export async function createDLRecord(
  input: CreateDLRecordInput
): Promise<string> {
  const eventName = input.eventName.trim();
  if (!eventName) {
    throw new Error("Event name cannot be empty.");
  }
  const hours = Math.round(input.hours);
  if (!Number.isInteger(hours) || hours <= 0) {
    throw new Error("Hours must be a positive whole number.");
  }

  const id = crypto.randomUUID();
  const row: DLRecordRow = {
    id,
    eventName,
    subjectId: input.subjectId,
    hours,
    logDates: input.logDates,
    status: input.status ?? "logged",
    createdAt: new Date().toISOString(),
  };

  await db.dlRecords.put(row);
  return id;
}

/**
 * Updates the lifecycle status of a Duty Leave record.
 */
export async function updateDLRecordStatus(
  id: string,
  status: DLStatus
): Promise<void> {
  await db.dlRecords.update(id, { status });
}

/**
 * Deletes a Duty Leave record by ID.
 */
export async function deleteDLRecord(id: string): Promise<void> {
  await db.dlRecords.delete(id);
}

export interface StudentProfileInput {
  name: string;
  department: string;
  branch: string;
  semester: number;
}

/**
 * Upserts the student's profile ("current"), preserving createdAt if present.
 */
export async function saveStudentProfile(
  input: StudentProfileInput
): Promise<void> {
  const existing = await db.profile.get("current");
  const createdAt = existing?.createdAt ?? new Date().toISOString();

  await db.profile.put({
    id: "current",
    name: input.name.trim(),
    department: input.department.trim(),
    branch: input.branch.trim(),
    semester: Math.max(1, Math.min(8, Math.round(input.semester))),
    createdAt,
  });
}

