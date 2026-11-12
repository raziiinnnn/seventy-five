/**
 * Tests for src/engine/reconcile.ts
 *
 * Covers:
 * - applyLocalOverlay: current subject (no overlay) vs stale subject (4 days overlay)
 * - inferAsOfDateAndReconcile: walking forward to match deltaY
 * - Conflict detection: local 0 absences vs ETLAB deltaMissed = 3
 * - DL lifecycle: logged / certificate_received / applied → reflected; applied → applied_not_reflected
 */

import { describe, it, expect } from "vitest";
import { applyLocalOverlay, inferAsOfDateAndReconcile } from "../reconcile.js";
import type {
  EtlabAnchor,
  EtlabSnapshot,
  DailyLog,
  DLRecord,
  Timetable,
  CalendarOverrides,
} from "../types2.js";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------
const timetable: Timetable = {
  mon: [{ period: 1, subjectId: "CS101", hours: 1 }],
  tue: [{ period: 1, subjectId: "CS101", hours: 1 }],
  wed: [{ period: 1, subjectId: "CS101", hours: 1 }],
  thu: [{ period: 1, subjectId: "CS101", hours: 1 }],
  fri: [{ period: 1, subjectId: "CS101", hours: 1 }],
};

const noOverrides: CalendarOverrides = {};

// ---------------------------------------------------------------------------
// applyLocalOverlay
// ---------------------------------------------------------------------------
describe("applyLocalOverlay", () => {
  it("Subject A: anchor is current (asOfDate = today) → overlay adds 0", () => {
    const anchors: EtlabAnchor[] = [
      {
        subjectId: "CS101",
        attended: 64,
        total: 79,
        missed: 15,
        dutyLeave: 0,
        asOfDate: "2024-11-08",
      },
    ];
    // Logs are on or before asOfDate → none qualify
    const logs: DailyLog[] = [
      { date: "2024-11-08", subjectId: "CS101", period: 1, event: "present", hours: 1 },
      { date: "2024-11-07", subjectId: "CS101", period: 1, event: "absent", hours: 1 },
    ];
    const result = applyLocalOverlay(anchors, logs, []);
    const sub = result.subjects[0]!;
    expect(sub.attended).toBe(64);
    expect(sub.total).toBe(79);
  });

  it("Subject B: anchor is 4 days stale → 4 days of local logs sit on top", () => {
    const anchors: EtlabAnchor[] = [
      {
        subjectId: "CS101",
        attended: 60,
        total: 75,
        missed: 15,
        dutyLeave: 0,
        asOfDate: "2024-11-04", // Mon
      },
    ];
    // Local logs: Tue–Fri (2024-11-05 to 2024-11-08), one present each day
    const logs: DailyLog[] = [
      { date: "2024-11-05", subjectId: "CS101", period: 1, event: "present", hours: 1 },
      { date: "2024-11-06", subjectId: "CS101", period: 1, event: "present", hours: 1 },
      { date: "2024-11-07", subjectId: "CS101", period: 1, event: "absent", hours: 1 },
      { date: "2024-11-08", subjectId: "CS101", period: 1, event: "present", hours: 1 },
    ];
    const result = applyLocalOverlay(anchors, logs, []);
    const sub = result.subjects[0]!;
    // 2 present + 1 absent + 1 present = 3 present, 4 total events
    expect(sub.attended).toBe(63);  // 60 + 3
    expect(sub.total).toBe(79);     // 75 + 4
  });

  it("cancelled periods add nothing to attended or total", () => {
    const anchors: EtlabAnchor[] = [
      { subjectId: "CS101", attended: 60, total: 75, missed: 15, dutyLeave: 0, asOfDate: "2024-11-04" },
    ];
    const logs: DailyLog[] = [
      { date: "2024-11-05", subjectId: "CS101", period: 1, event: "cancelled", hours: 1 },
    ];
    const result = applyLocalOverlay(anchors, logs, []);
    expect(result.subjects[0]!.attended).toBe(60);
    expect(result.subjects[0]!.total).toBe(75);
  });

  it("dl event adds to total only (unapproved)", () => {
    const anchors: EtlabAnchor[] = [
      { subjectId: "CS101", attended: 60, total: 75, missed: 15, dutyLeave: 0, asOfDate: "2024-11-04" },
    ];
    const logs: DailyLog[] = [
      { date: "2024-11-05", subjectId: "CS101", period: 1, event: "dl", hours: 1 },
    ];
    const result = applyLocalOverlay(anchors, logs, []);
    expect(result.subjects[0]!.attended).toBe(60); // unchanged
    expect(result.subjects[0]!.total).toBe(76);    // +1
  });

  it("logged, certificate_received, and applied DL records appear in pendingDLs", () => {
    const anchors: EtlabAnchor[] = [
      { subjectId: "CS101", attended: 60, total: 75, missed: 15, dutyLeave: 0, asOfDate: "2024-11-04" },
    ];
    const dlRecords: DLRecord[] = [
      { id: "dl1", subjectId: "CS101", hours: 2, status: "logged", logDates: ["2024-11-05"] },
      { id: "dl2", subjectId: "CS101", hours: 1, status: "certificate_received", logDates: ["2024-11-06"] },
      { id: "dl3", subjectId: "CS101", hours: 3, status: "applied", logDates: ["2024-11-07"] },
    ];
    const result = applyLocalOverlay(anchors, [], dlRecords);
    expect(result.pendingDLs).toHaveLength(3);
    expect(result.pendingDLs.map((d) => d.hours)).toEqual([2, 1, 3]);
  });

  it("reflected DL records do NOT appear in pendingDLs", () => {
    const anchors: EtlabAnchor[] = [
      { subjectId: "CS101", attended: 60, total: 75, missed: 15, dutyLeave: 0, asOfDate: "2024-11-04" },
    ];
    const dlRecords: DLRecord[] = [
      { id: "dl1", subjectId: "CS101", hours: 2, status: "reflected", logDates: ["2024-11-01"] },
    ];
    const result = applyLocalOverlay(anchors, [], dlRecords);
    expect(result.pendingDLs).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// inferAsOfDateAndReconcile — asOfDate inference
// ---------------------------------------------------------------------------
describe("inferAsOfDateAndReconcile — asOfDate inference", () => {
  it("deltaY=0 → asOfDate unchanged", () => {
    const anchor: EtlabAnchor = {
      subjectId: "CS101", attended: 60, total: 75, missed: 15, dutyLeave: 0,
      asOfDate: "2024-11-04",
    };
    const snap: EtlabSnapshot = { attended: 60, total: 75, missed: 15, dutyLeave: 0 };
    const result = inferAsOfDateAndReconcile(anchor, snap, [], timetable, noOverrides, []);
    expect(result.newAnchor.asOfDate).toBe("2024-11-04");
    expect(result.inferredExact).toBe(true);
  });

  it("deltaY=1 → walks one day forward (Tue 2024-11-05, 1 CS101 hour)", () => {
    // CS101 has 1h on Tue (2024-11-05). deltaY=1 → new asOfDate = 2024-11-05
    const anchor: EtlabAnchor = {
      subjectId: "CS101", attended: 60, total: 75, missed: 15, dutyLeave: 0,
      asOfDate: "2024-11-04",
    };
    const snap: EtlabSnapshot = { attended: 61, total: 76, missed: 15, dutyLeave: 0 };
    const result = inferAsOfDateAndReconcile(anchor, snap, [], timetable, noOverrides, []);
    expect(result.newAnchor.asOfDate).toBe("2024-11-05");
    expect(result.inferredExact).toBe(true);
  });

  it("deltaY=3 → walks to 2024-11-07 (3 weekday × 1h each)", () => {
    // Mon=1h, Tue=1h, Wed=1h → cumulative 3 on Wed 2024-11-06
    // Start: anchor asOfDate = 2024-11-03 (Sun). Walk: Mon=1, Tue=2, Wed=3 → 2024-11-06
    const anchor: EtlabAnchor = {
      subjectId: "CS101", attended: 60, total: 75, missed: 15, dutyLeave: 0,
      asOfDate: "2024-11-03",
    };
    const snap: EtlabSnapshot = { attended: 63, total: 78, missed: 15, dutyLeave: 0 };
    const result = inferAsOfDateAndReconcile(anchor, snap, [], timetable, noOverrides, []);
    expect(result.newAnchor.asOfDate).toBe("2024-11-06");
    expect(result.inferredExact).toBe(true);
  });

  it("retires logs on or before the new asOfDate", () => {
    const anchor: EtlabAnchor = {
      subjectId: "CS101", attended: 60, total: 75, missed: 15, dutyLeave: 0,
      asOfDate: "2024-11-03",
    };
    const snap: EtlabSnapshot = { attended: 61, total: 76, missed: 15, dutyLeave: 0 };
    const logs: DailyLog[] = [
      { date: "2024-11-04", subjectId: "CS101", period: 1, event: "present", hours: 1 }, // will retire
      { date: "2024-11-05", subjectId: "CS101", period: 1, event: "present", hours: 1 }, // stays active
    ];
    const result = inferAsOfDateAndReconcile(anchor, snap, logs, timetable, noOverrides, []);
    // deltaY=1 → new asOfDate=2024-11-04 (Mon, 1h)
    expect(result.newAnchor.asOfDate).toBe("2024-11-04");
    expect(result.retiredLogs).toHaveLength(1);
    expect(result.retiredLogs[0]!.date).toBe("2024-11-04");
    expect(result.retiredLogs[0]!.retired).toBe(true);
  });

  it("throws when ETLAB total decreases and allowReset is not set", () => {
    const anchor: EtlabAnchor = {
      subjectId: "CS101", attended: 60, total: 75, missed: 15, dutyLeave: 0,
      asOfDate: "2024-11-04",
    };
    const snap: EtlabSnapshot = { attended: 59, total: 74, missed: 15, dutyLeave: 0 };
    expect(() =>
      inferAsOfDateAndReconcile(anchor, snap, [], timetable, noOverrides, [])
    ).toThrow();
  });

  it("allows reset when allowReset: true", () => {
    const anchor: EtlabAnchor = {
      subjectId: "CS101", attended: 60, total: 75, missed: 15, dutyLeave: 0,
      asOfDate: "2024-11-04",
    };
    const snap: EtlabSnapshot = { attended: 59, total: 74, missed: 15, dutyLeave: 0 };
    expect(() =>
      inferAsOfDateAndReconcile(anchor, snap, [], timetable, noOverrides, [], { allowReset: true })
    ).not.toThrow();
  });
});

// ---------------------------------------------------------------------------
// inferAsOfDateAndReconcile — conflict detection
// ---------------------------------------------------------------------------
describe("inferAsOfDateAndReconcile — conflict detection", () => {
  it("no conflict when local absent matches ETLAB deltaMissed", () => {
    // Student logged 1 absent; ETLAB missed also went up by 1
    const anchor: EtlabAnchor = {
      subjectId: "CS101", attended: 60, total: 75, missed: 10, dutyLeave: 0,
      asOfDate: "2024-11-03",
    };
    const snap: EtlabSnapshot = { attended: 60, total: 76, missed: 11, dutyLeave: 0 };
    const logs: DailyLog[] = [
      { date: "2024-11-04", subjectId: "CS101", period: 1, event: "absent", hours: 1 },
    ];
    const result = inferAsOfDateAndReconcile(anchor, snap, logs, timetable, noOverrides, []);
    expect(result.mismatch).toBeNull();
  });

  it("conflict when student logged 0 absences but ETLAB deltaMissed = 3", () => {
    // Student logged 3 "present" periods; ETLAB says missed went up by 3
    const anchor: EtlabAnchor = {
      subjectId: "CS101", attended: 60, total: 75, missed: 10, dutyLeave: 0,
      asOfDate: "2024-11-03",
    };
    const snap: EtlabSnapshot = { attended: 60, total: 78, missed: 13, dutyLeave: 0 };
    const logs: DailyLog[] = [
      { date: "2024-11-04", subjectId: "CS101", period: 1, event: "present", hours: 1 },
      { date: "2024-11-05", subjectId: "CS101", period: 1, event: "present", hours: 1 },
      { date: "2024-11-06", subjectId: "CS101", period: 1, event: "present", hours: 1 },
    ];
    const result = inferAsOfDateAndReconcile(anchor, snap, logs, timetable, noOverrides, []);
    expect(result.mismatch).not.toBeNull();
    expect(result.mismatch!.expectedMissed).toBe(0);  // local: 0 absences
    expect(result.mismatch!.etlabMissed).toBe(3);     // ETLAB: +3
  });

  it("conflict details: student had 1 absent, ETLAB says 2 missed", () => {
    const anchor: EtlabAnchor = {
      subjectId: "CS101", attended: 60, total: 75, missed: 10, dutyLeave: 0,
      asOfDate: "2024-11-03",
    };
    const snap: EtlabSnapshot = { attended: 60, total: 77, missed: 12, dutyLeave: 0 };
    const logs: DailyLog[] = [
      { date: "2024-11-04", subjectId: "CS101", period: 1, event: "absent", hours: 1 },
      { date: "2024-11-05", subjectId: "CS101", period: 1, event: "present", hours: 1 },
    ];
    const result = inferAsOfDateAndReconcile(anchor, snap, logs, timetable, noOverrides, []);
    expect(result.mismatch).not.toBeNull();
    expect(result.mismatch!.expectedMissed).toBe(1);
    expect(result.mismatch!.etlabMissed).toBe(2);
  });
});

// ---------------------------------------------------------------------------
// inferAsOfDateAndReconcile — DL lifecycle
// ---------------------------------------------------------------------------
describe("inferAsOfDateAndReconcile — DL lifecycle", () => {
  it("logged DL auto-closes as 'reflected' when ETLAB dutyLeave rises by enough", () => {
    const anchor: EtlabAnchor = {
      subjectId: "CS101", attended: 60, total: 75, missed: 10, dutyLeave: 0,
      asOfDate: "2024-11-03",
    };
    const snap: EtlabSnapshot = { attended: 62, total: 76, missed: 10, dutyLeave: 2 };
    const dlRecords: DLRecord[] = [
      { id: "dl1", subjectId: "CS101", hours: 2, status: "logged", logDates: ["2024-11-04"] },
    ];
    const result = inferAsOfDateAndReconcile(anchor, snap, [], timetable, noOverrides, dlRecords);
    const dl = result.updatedDLRecords.find((d) => d.id === "dl1")!;
    expect(dl.status).toBe("reflected");
  });

  it("'certificate_received' DL auto-closes as 'reflected' when ETLAB dutyLeave rises by enough", () => {
    const anchor: EtlabAnchor = {
      subjectId: "CS101", attended: 60, total: 75, missed: 10, dutyLeave: 0,
      asOfDate: "2024-11-03",
    };
    const snap: EtlabSnapshot = { attended: 62, total: 76, missed: 10, dutyLeave: 2 };
    const dlRecords: DLRecord[] = [
      { id: "dl1", subjectId: "CS101", hours: 2, status: "certificate_received", logDates: ["2024-11-04"] },
    ];
    const result = inferAsOfDateAndReconcile(anchor, snap, [], timetable, noOverrides, dlRecords);
    const dl = result.updatedDLRecords.find((d) => d.id === "dl1")!;
    expect(dl.status).toBe("reflected");
  });

  it("'applied' DL is flagged 'applied_not_reflected' when ETLAB dutyLeave stays the same", () => {
    const anchor: EtlabAnchor = {
      subjectId: "CS101", attended: 60, total: 75, missed: 10, dutyLeave: 0,
      asOfDate: "2024-11-03",
    };
    const snap: EtlabSnapshot = { attended: 61, total: 76, missed: 10, dutyLeave: 0 }; // dutyLeave unchanged
    const dlRecords: DLRecord[] = [
      { id: "dl1", subjectId: "CS101", hours: 2, status: "applied", logDates: ["2024-11-02"] },
    ];
    const result = inferAsOfDateAndReconcile(anchor, snap, [], timetable, noOverrides, dlRecords);
    const dl = result.updatedDLRecords.find((d) => d.id === "dl1")!;
    expect(dl.status).toBe("applied_not_reflected");
  });

  it("DL for a different subject is not modified", () => {
    const anchor: EtlabAnchor = {
      subjectId: "CS101", attended: 60, total: 75, missed: 10, dutyLeave: 0,
      asOfDate: "2024-11-03",
    };
    const snap: EtlabSnapshot = { attended: 61, total: 76, missed: 10, dutyLeave: 2 };
    const dlRecords: DLRecord[] = [
      { id: "dl2", subjectId: "MA101", hours: 2, status: "logged", logDates: ["2024-11-04"] },
    ];
    const result = inferAsOfDateAndReconcile(anchor, snap, [], timetable, noOverrides, dlRecords);
    const dl = result.updatedDLRecords.find((d) => d.id === "dl2")!;
    expect(dl.status).toBe("logged"); // untouched
  });

  it("partial DL coverage: first DL reflected, second stays logged", () => {
    const anchor: EtlabAnchor = {
      subjectId: "CS101", attended: 60, total: 75, missed: 10, dutyLeave: 0,
      asOfDate: "2024-11-03",
    };
    // dutyLeave rose by 2 → enough to close dl1 (2h) but not dl2 (3h)
    const snap: EtlabSnapshot = { attended: 62, total: 76, missed: 10, dutyLeave: 2 };
    const dlRecords: DLRecord[] = [
      { id: "dl1", subjectId: "CS101", hours: 2, status: "logged", logDates: ["2024-11-04"] },
      { id: "dl2", subjectId: "CS101", hours: 3, status: "certificate_received", logDates: ["2024-11-05"] },
    ];
    const result = inferAsOfDateAndReconcile(anchor, snap, [], timetable, noOverrides, dlRecords);
    const dl1 = result.updatedDLRecords.find((d) => d.id === "dl1")!;
    const dl2 = result.updatedDLRecords.find((d) => d.id === "dl2")!;
    expect(dl1.status).toBe("reflected");
    expect(dl2.status).toBe("certificate_received"); // budget exhausted
  });
});

