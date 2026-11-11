/**
 * Tests for src/engine/checksum.ts
 *
 * Uses the real ETLAB numbers from the brief:
 *   Overall: 407 attended / 489 total
 *   Cards:   64/79, 63/75, 63/78, 69/87, 46/48, 33/36, 30/33, 39/53
 *   Verify:  64+63+63+69+46+33+30+39 = 407  ✓
 *            79+75+78+87+48+36+33+53 = 489  ✓
 *
 * Percentage display (round, not truncate — ETLAB uses standard rounding):
 *   64/79  → round(81.01%) = 81%
 *   63/75  → round(84.00%) = 84%
 *   63/78  → round(80.77%) = 81%
 *   69/87  → round(79.31%) = 79%
 *   46/48  → round(95.83%) = 96%
 *   33/36  → round(91.67%) = 92%
 *   30/33  → round(90.91%) = 91%
 *   39/53  → round(73.58%) = 74%
 */

import { describe, it, expect } from "vitest";
import { validateEtlExtract } from "../checksum.js";
import type { EtlabCard, EtlabOverallHeader } from "../types2.js";

// ---------------------------------------------------------------------------
// Real data fixture
// ---------------------------------------------------------------------------

/** Build a card where attended = total - missed - leave - dutyLeave. */
function makeCard(
  subjectId: string,
  attended: number,
  total: number,
  displayedPercent: number,
  missed?: number,
  leave = 0,
  dutyLeave = 0
): EtlabCard {
  // Derive missed from the arithmetic identity if not provided
  const m = missed ?? total - attended - leave - dutyLeave;
  return { subjectId, attended, total, missed: m, leave, dutyLeave, displayedPercent };
}

const realCards: EtlabCard[] = [
  makeCard("CS101", 64, 79,  81),  // round(64/79*100)=round(81.01)=81 ✓
  makeCard("MA101", 63, 75,  84),  // round(63/75*100)=round(84.00)=84 ✓
  makeCard("PH101", 63, 78,  81),  // round(63/78*100)=round(80.77)=81 ✓
  makeCard("EC101", 69, 87,  79),  // round(69/87*100)=round(79.31)=79 ✓
  makeCard("HU101", 46, 48,  96),  // round(46/48*100)=round(95.83)=96 ✓
  makeCard("LA101", 33, 36,  92),  // round(33/36*100)=round(91.67)=92 ✓
  makeCard("LA102", 30, 33,  91),  // round(30/33*100)=round(90.91)=91 ✓
  makeCard("ES101", 39, 53,  74),  // round(39/53*100)=round(73.58)=74 ✓
];

const realHeader: EtlabOverallHeader = { attended: 407, total: 489 };

// ---------------------------------------------------------------------------
// Happy-path: real ETLAB numbers must all pass
// ---------------------------------------------------------------------------
describe("validateEtlExtract — real ETLAB data (407/489)", () => {
  it("passes with valid cards and matching overall header", () => {
    const result = validateEtlExtract(realHeader, realCards);
    expect(result.valid).toBe(true);
    expect(result.cardErrors).toHaveLength(0);
    expect(result.headerMismatch).toBeNull();
  });

  it("sum of card attended equals 407", () => {
    const sum = realCards.reduce((s, c) => s + c.attended, 0);
    expect(sum).toBe(407);
  });

  it("sum of card total equals 489", () => {
    const sum = realCards.reduce((s, c) => s + c.total, 0);
    expect(sum).toBe(489);
  });
});

// ---------------------------------------------------------------------------
// Card arithmetic errors
// ---------------------------------------------------------------------------
describe("validateEtlExtract — arithmetic errors", () => {
  it("flags a card where total - missed != attended (leave/DL = 0)", () => {
    const badCard: EtlabCard = {
      subjectId: "BAD01",
      attended: 60,
      total: 80,
      missed: 25,   // should be 20 to match attended=60
      leave: 0,
      dutyLeave: 0,
      displayedPercent: 75,
    };
    const result = validateEtlExtract({ attended: 60, total: 80 }, [badCard]);
    expect(result.valid).toBe(false);
    expect(result.cardErrors[0]?.issue).toBe("arithmetic");
    expect(result.cardErrors[0]?.subjectId).toBe("BAD01");
  });

  it("passes when leave and DL account for the gap", () => {
    // attended = total - missed - leave - dutyLeave
    // 60 = 80 - 10 - 5 - 5
    const goodCard: EtlabCard = {
      subjectId: "GOOD01",
      attended: 60,
      total: 80,
      missed: 10,
      leave: 5,
      dutyLeave: 5,
      displayedPercent: 75, // round(60/80*100) = round(75) = 75
    };
    const result = validateEtlExtract({ attended: 60, total: 80 }, [goodCard]);
    expect(result.cardErrors.filter((e) => e.issue === "arithmetic")).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// Percent mismatch errors
// ---------------------------------------------------------------------------
describe("validateEtlExtract — percent mismatch", () => {
  it("flags a card with incorrect displayedPercent", () => {
    const badPercentCard: EtlabCard = {
      subjectId: "PCT01",
      attended: 64,
      total: 79,
      missed: 15,
      leave: 0,
      dutyLeave: 0,
      displayedPercent: 80, // correct is 81
    };
    const result = validateEtlExtract({ attended: 64, total: 79 }, [badPercentCard]);
    expect(result.valid).toBe(false);
    const pctErr = result.cardErrors.find((e) => e.issue === "percent_mismatch");
    expect(pctErr).toBeDefined();
    expect(pctErr?.subjectId).toBe("PCT01");
  });

  it("does not flag when displayedPercent is correct (rounding up at .5)", () => {
    // 1/2 = 50%, round = 50
    const card: EtlabCard = makeCard("HALF", 1, 2, 50);
    const result = validateEtlExtract({ attended: 1, total: 2 }, [card]);
    expect(result.cardErrors.filter((e) => e.issue === "percent_mismatch")).toHaveLength(0);
  });

  it("rounds 0.5 up: 3/4 = 75.0% → displayed 75", () => {
    const card: EtlabCard = makeCard("3OF4", 3, 4, 75);
    const result = validateEtlExtract({ attended: 3, total: 4 }, [card]);
    expect(result.cardErrors).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// Header mismatch (cut-off screenshot)
// ---------------------------------------------------------------------------
describe("validateEtlExtract — header mismatch", () => {
  it("flags when sum of attended does not match header (one card cut off)", () => {
    // Supply 7 of 8 cards (missing ES101: 39/53)
    const sevenCards = realCards.slice(0, 7);
    const result = validateEtlExtract(realHeader, sevenCards);
    expect(result.headerMismatch).not.toBeNull();
    expect(result.headerMismatch!.missingAttended).toBe(39);
    expect(result.headerMismatch!.missingTotal).toBe(53);
  });

  it("missingAttended and missingTotal are exact deltas", () => {
    // Header says 407/489 but we only give 6 cards (missing LA101+ES101 = 30+39=69 attended, 33+53=86 total)
    const sixCards = realCards.slice(0, 6);
    const result = validateEtlExtract(realHeader, sixCards);
    expect(result.headerMismatch!.missingAttended).toBe(69);
    expect(result.headerMismatch!.missingTotal).toBe(86);
  });

  it("valid: no header mismatch with all 8 cards", () => {
    const result = validateEtlExtract(realHeader, realCards);
    expect(result.headerMismatch).toBeNull();
  });

  it("flags when header total is higher than sum (not just attended)", () => {
    // Artificially make header total higher
    const result = validateEtlExtract({ attended: 407, total: 500 }, realCards);
    expect(result.headerMismatch).not.toBeNull();
    expect(result.headerMismatch!.missingTotal).toBe(11); // 500 - 489
    expect(result.headerMismatch!.missingAttended).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Multiple errors on a single validation
// ---------------------------------------------------------------------------
describe("validateEtlExtract — multiple simultaneous errors", () => {
  it("reports all errors from multiple bad cards", () => {
    const cards: EtlabCard[] = [
      { subjectId: "A", attended: 60, total: 80, missed: 25, leave: 0, dutyLeave: 0, displayedPercent: 75 },
      { subjectId: "B", attended: 50, total: 70, missed: 20, leave: 0, dutyLeave: 0, displayedPercent: 99 },
    ];
    const header: EtlabOverallHeader = { attended: 110, total: 150 };
    const result = validateEtlExtract(header, cards);
    expect(result.valid).toBe(false);
    // A: arithmetic error (60 ≠ 80-25=55)
    // B: percent error (round(50/70*100)=round(71.4)=71, not 99)
    const aErr = result.cardErrors.filter((e) => e.subjectId === "A");
    const bErr = result.cardErrors.filter((e) => e.subjectId === "B");
    expect(aErr.some((e) => e.issue === "arithmetic")).toBe(true);
    expect(bErr.some((e) => e.issue === "percent_mismatch")).toBe(true);
  });

  it("empty card list with nonzero header flags header mismatch", () => {
    const result = validateEtlExtract({ attended: 100, total: 120 }, []);
    expect(result.headerMismatch).not.toBeNull();
    expect(result.headerMismatch!.missingAttended).toBe(100);
    expect(result.headerMismatch!.missingTotal).toBe(120);
  });
});

