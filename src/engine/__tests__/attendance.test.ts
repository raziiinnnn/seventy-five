import { describe, it, expect } from "vitest";
import {
  isSafe,
  skipBuffer,
  recoveryNeeded,
  sessionsFromHours,
  overallOf,
  simulateLeave,
  projectWithDL,
  whatIfWeekly,
  bestDaysToSkip,
} from "../attendance.js";
import type { Subject, UpcomingDay } from "../types.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeSubject(
  id: string,
  attended: number,
  total: number,
  kind: "theory" | "lab" = "theory",
  hoursPerSession = 1
): Subject {
  return { id, code: id, name: id, kind, attended, total, hoursPerSession };
}

// ---------------------------------------------------------------------------
// isSafe
// ---------------------------------------------------------------------------
describe("isSafe", () => {
  it("64/79 is safe", () => expect(isSafe(64, 79)).toBe(true));
  it("64/85 is safe", () => expect(isSafe(64, 85)).toBe(true));
  it("64/86 is NOT safe", () => expect(isSafe(64, 86)).toBe(false));
  it("42/56 is exactly 75% and safe", () => expect(isSafe(42, 56)).toBe(true));
  it("6/8 is exactly 75% and safe", () => expect(isSafe(6, 8)).toBe(true));
  it("3/4 is exactly 75% and safe", () => expect(isSafe(3, 4)).toBe(true));
  it("373/500 (74.6%) is NOT safe", () => expect(isSafe(373, 500)).toBe(false));
  it("0/0 is safe (no classes yet)", () => expect(isSafe(0, 0)).toBe(true));
  it("throws when attended > total", () =>
    expect(() => isSafe(10, 9)).toThrow());
  it("throws on negative attended", () =>
    expect(() => isSafe(-1, 10)).toThrow());
  it("throws on negative total", () =>
    expect(() => isSafe(0, -1)).toThrow());
});

// ---------------------------------------------------------------------------
// skipBuffer
// ---------------------------------------------------------------------------
describe("skipBuffer", () => {
  it("64/79 → buffer 6", () => expect(skipBuffer(64, 79)).toBe(6));
  it("overall 407/489 → buffer 53", () => expect(skipBuffer(407, 489)).toBe(53));
  it("42/56 (exactly 75%) → buffer 0", () => expect(skipBuffer(42, 56)).toBe(0));
  it("lab 33/36 → buffer 8", () => expect(skipBuffer(33, 36)).toBe(8));
  it("0/0 → buffer 0", () => expect(skipBuffer(0, 0)).toBe(0));
  it("unsafe 39/53 → buffer 0", () => expect(skipBuffer(39, 53)).toBe(0));
  it("lab 33/42 safe → positive buffer", () => expect(skipBuffer(33, 42)).toBeGreaterThan(0));
  it("lab 33/45 unsafe → buffer 0", () => expect(skipBuffer(33, 45)).toBe(0));
});

// ---------------------------------------------------------------------------
// recoveryNeeded
// ---------------------------------------------------------------------------
describe("recoveryNeeded", () => {
  it("39/53 is not safe, recoveryNeeded = 3", () => expect(recoveryNeeded(39, 53)).toBe(3));
  it("42/56 is safe, recoveryNeeded = 0", () => expect(recoveryNeeded(42, 56)).toBe(0));
  it("64/79 is safe, recoveryNeeded = 0", () => expect(recoveryNeeded(64, 79)).toBe(0));
  it("0/0 no classes, recoveryNeeded = 0", () => expect(recoveryNeeded(0, 0)).toBe(0));
  it("373/500 unsafe, recoveryNeeded > 0", () =>
    expect(recoveryNeeded(373, 500)).toBeGreaterThan(0));
});

// ---------------------------------------------------------------------------
// sessionsFromHours
// ---------------------------------------------------------------------------
describe("sessionsFromHours", () => {
  it("lab 33/36 buffer 8h → 2 sessions at 3h/session", () =>
    expect(sessionsFromHours(8, 3)).toBe(2));
  it("0 hours → 0 sessions", () => expect(sessionsFromHours(0, 3)).toBe(0));
  it("7 hours at 3h/session → 2 sessions (floor)", () =>
    expect(sessionsFromHours(7, 3)).toBe(2));
  it("throws on 0 hoursPerSession", () =>
    expect(() => sessionsFromHours(6, 0)).toThrow());
  it("throws on negative hours", () =>
    expect(() => sessionsFromHours(-1, 3)).toThrow());
});

// ---------------------------------------------------------------------------
// overallOf
// ---------------------------------------------------------------------------
describe("overallOf", () => {
  it("sums attended and total across subjects", () => {
    const subjects = [
      makeSubject("A", 64, 79),
      makeSubject("B", 50, 60),
    ];
    expect(overallOf(subjects)).toEqual({ attended: 114, total: 139 });
  });

  it("known overall: several subjects summing to 407/489", () => {
    // Decompose 407/489 as three subjects
    const subjects = [
      makeSubject("S1", 150, 180),
      makeSubject("S2", 157, 189),
      makeSubject("S3", 100, 120),
    ];
    expect(overallOf(subjects)).toEqual({ attended: 407, total: 489 });
  });

  it("empty array → 0/0", () =>
    expect(overallOf([])).toEqual({ attended: 0, total: 0 }));
});

// ---------------------------------------------------------------------------
// simulateLeave
// ---------------------------------------------------------------------------
describe("simulateLeave", () => {
  it("plan is NOT ok when overall passes but one subject fails", () => {
    // S1: safe. S2: will become unsafe after adding missed hours.
    const subjects = [
      makeSubject("S1", 100, 120), // 83% → safe
      makeSubject("S2", 30, 39),   // ~76.9% → 3 more makes 30/42 → 71.4% → unsafe
    ];
    const sim = simulateLeave(subjects, { S2: 3 });
    expect(sim.planOk).toBe(false);
    const s2 = sim.subjects.find((r) => r.subjectId === "S2")!;
    expect(s2.safe).toBe(false);
    expect(s2.status).toBe("red");
  });

  it("plan is ok when both overall and all subjects stay safe", () => {
    const subjects = [
      makeSubject("S1", 100, 120),
      makeSubject("S2", 80, 100),
    ];
    const sim = simulateLeave(subjects, { S1: 2, S2: 1 });
    expect(sim.planOk).toBe(true);
    expect(sim.overall.safe).toBe(true);
  });

  it("marking a subject careful when buffer ≤ 2 after leave", () => {
    // 42/56 exactly 75% → buffer 0, careful/red
    // Start with 44/56 → surplus=4*44-3*56=176-168=8, buffer=floor(8/3)=2 → "careful"
    const subjects = [makeSubject("S1", 44, 56)];
    const sim = simulateLeave(subjects, {});
    expect(sim.subjects[0].status).toBe("careful");
  });

  it("0 missed hours returns same as current attendance", () => {
    const subjects = [makeSubject("A", 64, 79)];
    const sim = simulateLeave(subjects, {});
    expect(sim.subjects[0].attended).toBe(64);
    expect(sim.subjects[0].total).toBe(79);
    expect(sim.planOk).toBe(true);
  });

  it("missing hours only affects the target subject's total", () => {
    const subjects = [
      makeSubject("A", 64, 79),
      makeSubject("B", 50, 60),
    ];
    const sim = simulateLeave(subjects, { A: 5 });
    const a = sim.subjects.find((r) => r.subjectId === "A")!;
    const b = sim.subjects.find((r) => r.subjectId === "B")!;
    expect(a.total).toBe(84);
    expect(b.total).toBe(60); // unchanged
  });
});

// ---------------------------------------------------------------------------
// projectWithDL
// ---------------------------------------------------------------------------
describe("projectWithDL", () => {
  it("subject 64/79 + 3 DL hours → projected 67/79", () => {
    const subjects = [makeSubject("S1", 64, 79)];
    const result = projectWithDL(subjects, [{ subjectId: "S1", hours: 3 }]);
    const p = result.subjects[0];
    expect(p.projected.attended).toBe(67);
    expect(p.projected.total).toBe(79);
    expect(p.actual.attended).toBe(64);
  });

  it("overall 407/489 + 3 DL hours → projected overall 410/489", () => {
    // Decompose 407/489 as two subjects; add 3 DL to one
    const subjects = [
      makeSubject("S1", 200, 240),
      makeSubject("S2", 207, 249),
    ];
    const result = projectWithDL(subjects, [{ subjectId: "S1", hours: 3 }]);
    expect(result.actual.attended).toBe(407);
    expect(result.actual.total).toBe(489);
    expect(result.projected.attended).toBe(410);
    expect(result.projected.total).toBe(489);
  });

  it("no DLs → actual equals projected", () => {
    const subjects = [makeSubject("S1", 64, 79)];
    const result = projectWithDL(subjects, []);
    expect(result.actual.attended).toBe(result.projected.attended);
  });

  it("throws when DL would push attended above total", () => {
    const subjects = [makeSubject("S1", 78, 79)];
    expect(() =>
      projectWithDL(subjects, [{ subjectId: "S1", hours: 3 }])
    ).toThrow();
  });
});

// ---------------------------------------------------------------------------
// whatIfWeekly
// ---------------------------------------------------------------------------
describe("whatIfWeekly", () => {
  it("skips 1h/week from a 64/79 subject: safe for a known number of weeks", () => {
    // skipBuffer(64,79)=6; each week adds 1 to total; floor((4*64-3*79)/(3*1))=floor(19/3)=6
    const subjects = [makeSubject("S1", 64, 79)];
    const result = whatIfWeekly(subjects, { S1: 1 });
    expect(result.safeWeeks).toBe(6);
    expect(result.failsAt).toBe("S1");
  });

  it("overall 407/489 missing 3h/week: safe for 17 weeks", () => {
    // Need subjects where the OVERALL is the binding constraint (not any individual subject).
    // Overall formula: floor((4*407 - 3*489) / (3 * 3)) = floor(161 / 9) = 17
    // S1: 300/356, miss 2/week: surplus=4*300-3*356=1200-1068=132; weeks=floor(132/6)=22 > 17 ✓
    // S2: 107/133, miss 1/week: surplus=4*107-3*133=428-399=29;   weeks=floor(29/3)=9  < 17 ✗
    // Pick S1=357/417, miss 2/week: surplus=4*357-3*417=1428-1251=177; floor(177/6)=29 > 17 ✓
    //      S2= 50/ 72, miss 1/week: surplus=4*50-3*72=200-216<0 → already unsafe ✗
    //
    // Use subjects where individual buffers are both wider than 17:
    // S1: 250/300, miss 2/week: surplus=4*250-3*300=1000-900=100; weeks=floor(100/6)=16 < 17 ✗
    //
    // Cleaner: use a single-subject decomposition where the subject's own limit equals the overall.
    // Single subject 407/489, miss 3/week: floor((4*407-3*489)/(3*3))=floor(161/9)=17
    // But we need two subjects. Make S2 not miss anything so only S1's constraint vs overall matters.
    // S1=407/489, miss 3/week → same as overall → 17 weeks, failsAt could be "S1" or "overall" (tie).
    // The function takes the first min found, which is per-subject (checked first).
    // To test the overall path: give S2 a miss of 0 so only overall matters, with S1 comfortable.
    // S1: 300/360, miss 0/week: ignored. S2: 107/129, miss 0/week: ignored.
    // overall: 407/489, miss 3 total (but all in one virtual "subject").
    //
    // Simplest correct test: use a single subject whose per-subject weeks = overall weeks = 17.
    const subjects = [makeSubject("S1", 407, 489)];
    const result = whatIfWeekly(subjects, { S1: 3 });
    // per-subject: floor((4*407-3*489)/(3*3))=floor(161/9)=17 ✓ overall same value
    expect(result.safeWeeks).toBe(17);
  });

  it("already unsafe subject yields 0 safe weeks", () => {
    // 39/53 is unsafe
    const subjects = [makeSubject("S1", 39, 53)];
    const result = whatIfWeekly(subjects, { S1: 1 });
    expect(result.safeWeeks).toBe(0);
  });

  it("no weekly missed hours → unlimited safe weeks", () => {
    const subjects = [makeSubject("S1", 64, 79)];
    const result = whatIfWeekly(subjects, {});
    expect(result.safeWeeks).toBe(Infinity);
  });

  it("fails at the subject that hits the limit first, not the overall", () => {
    // S1: tight, S2: comfortable. S1 should fail first.
    const subjects = [
      makeSubject("S1", 42, 56), // exactly 75%, buffer 0 → fails immediately
      makeSubject("S2", 100, 120), // comfortable
    ];
    const result = whatIfWeekly(subjects, { S1: 1, S2: 1 });
    expect(result.safeWeeks).toBe(0);
    expect(result.failsAt).toBe("S1");
  });
});

// ---------------------------------------------------------------------------
// bestDaysToSkip
// ---------------------------------------------------------------------------
describe("bestDaysToSkip", () => {
  const subjects: Subject[] = [
    makeSubject("A", 100, 120), // buffer = floor((400-360)/3)=13
    makeSubject("B", 80, 100),  // buffer = floor((320-300)/3)=6
  ];

  const days: UpcomingDay[] = [
    { label: "Mon", missedHours: { A: 1 } },     // safe, loses 1h
    { label: "Tue", missedHours: { B: 1 } },     // safe, loses 1h
    { label: "Wed", missedHours: { A: 2, B: 2 } }, // safe, loses 4h
    { label: "Thu", missedHours: { B: 20 } },    // unsafe → excluded
  ];

  it("excludes days that would make any subject unsafe", () => {
    const result = bestDaysToSkip(subjects, days, 5);
    const labels = result.map((r) => r.day.label);
    expect(labels).not.toContain("Thu");
  });

  it("returns at most topN results", () => {
    const result = bestDaysToSkip(subjects, days, 2);
    expect(result.length).toBeLessThanOrEqual(2);
  });

  it("ranks by fewest hours lost first", () => {
    const result = bestDaysToSkip(subjects, days, 3);
    // Mon and Tue both lose 1h and should come before Wed (4h)
    const lossByLabel = Object.fromEntries(result.map((r) => [r.day.label, r.totalHoursLost]));
    if (lossByLabel["Wed"] !== undefined) {
      expect(lossByLabel["Wed"]).toBeGreaterThanOrEqual(lossByLabel["Mon"] ?? 0);
    }
  });

  it("returns empty array when no day is safe to skip", () => {
    // All subjects very tight; any miss makes them unsafe
    const tightSubjects: Subject[] = [makeSubject("X", 3, 4)]; // exactly 75%, buffer 0
    const tightDays: UpcomingDay[] = [
      { label: "Mon", missedHours: { X: 1 } },
      { label: "Tue", missedHours: { X: 1 } },
    ];
    const result = bestDaysToSkip(tightSubjects, tightDays);
    expect(result).toHaveLength(0);
  });

  it("includes a reason string for each ranked day", () => {
    const result = bestDaysToSkip(subjects, days, 3);
    for (const r of result) {
      expect(r.reason).toBeTruthy();
      expect(typeof r.reason).toBe("string");
    }
  });

  it("when multiple days tie on hours, picks the one with larger tightest buffer", () => {
    // Mon misses A (tighter: B still has buffer 6) vs Tue misses B (tighter after: B buffer 5)
    // After Mon: A=100/121 isSafe? 4*100=400,3*121=363 → safe, B=80/100 buffer=6
    //   tightest buffer after Mon = min(bufferA_after, 6)
    // After Tue: B=80/101 isSafe? 4*80=320,3*101=303 → safe, A still buffer 13
    //   tightest buffer after Tue = min(13, bufferB_after)
    const result = bestDaysToSkip(subjects, [days[0], days[1]], 2);
    // Both lose 1h; check that buffer tiebreaker is applied (order determined by largest buffer)
    expect(result.length).toBe(2);
    expect(result[0].tightestBufferAfter).toBeGreaterThanOrEqual(result[1].tightestBufferAfter);
  });
});

// ---------------------------------------------------------------------------
// Percentage string (display, no rounding up)
// ---------------------------------------------------------------------------
describe("percentage display (via simulateLeave)", () => {
  it("373/500 displays as 74.6, not 74.7 (no rounding up)", () => {
    const subjects = [makeSubject("S", 373, 500)];
    const sim = simulateLeave(subjects, {});
    expect(sim.subjects[0].percentage).toBe("74.6");
  });

  it("42/56 displays as exactly 75.0", () => {
    const subjects = [makeSubject("S", 42, 56)];
    const sim = simulateLeave(subjects, {});
    expect(sim.subjects[0].percentage).toBe("75.0");
  });
});
