/**
 * Tests for src/engine/ocrParser.ts
 *
 * Uses the real Semester 5 CSE-AI ETLAB dataset (407 / 489 across 8 subjects):
 *  1. PCCST501 (A) — COMPUTER NETWORKS (theory, 1h): 64/79 (81%), missed 15, credit 8/10
 *  2. PCCAT502 (B) — INTRODUCTION TO ARTIFICIAL INTELLIGENCE (theory, 1h): 63/75 (84%), missed 12, credit 8/10
 *  3. PCCST503 (C) — MACHINE LEARNING (theory, 1h): 63/78 (81%), missed 15, credit 8/10
 *  4. PBCAT504 (D) — ADVANCED GRAPH ALGORITHM (theory, 1h): 69/87 (79%), missed 18, credit 6/10
 *  5. PEAIT523 (E) — HEALTHCARE ANALYTICS (theory, 1h): 46/48 (96%), missed 2, credit 10/10
 *  6. PCCAL507 (L) — AI ALGORITHMS LAB (lab, 3h): 33/36 (92%), missed 3, credit 10/10
 *  7. PCCSL508 (Q) — MACHINE LEARNING LAB (lab, 3h): 30/33 (91%), missed 3, credit 10/10
 *  8. PLT-2026 (Z) — PLACEMENT TRAINING (theory, 1h): 39/53 (74%), missed 14
 */

import { describe, it, expect } from "vitest";
import {
  parseSingleEtlabOcrText,
  mergeAndValidateOcrExtracts,
} from "../ocrParser.js";
import { validateEtlExtract } from "../checksum.js";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const FULL_PAGE_OCR = `
Attendance
By Course   By Date

Overall Attendance
83%
407 of 489 hours attended

PCCST501 (A)
COMPUTER NETWORKS
Theory   Credit-wise 8 / 10
81%
64/79
Missed 15   Leave 0   Duty Leave 0

PCCAT502 (B)
INTRODUCTION TO ARTIFICIAL INTELLIGENCE
Theory   Credit-wise 8 / 10
84%
63/75
Missed 12   Leave 0   Duty Leave 0

PCCST503 (C)
MACHINE LEARNING
Theory   Credit-wise 8 / 10
81%
63/78
Missed 15   Leave 0   Duty Leave 0

PBCAT504 (D)
ADVANCED GRAPH ALGORITHM
Theory   Credit-wise 6 / 10
79%
69/87
Missed 18   Leave 0   Duty Leave 0

PEAIT523 (E)
HEALTHCARE ANALYTICS
Theory   Credit-wise 10 / 10
96%
46/48
Missed 2   Leave 0   Duty Leave 0

PCCAL507 (L)
AI ALGORITHMS LAB
Practical   Credit-wise 10 / 10
92%
33/36
Missed 3   Leave 0   Duty Leave 0

PCCSL508 (Q)
MACHINE LEARNING LAB
Practical   Credit-wise 10 / 10
91%
30/33
Missed 3   Leave 0   Duty Leave 0

PLT-2026 (Z)
PLACEMENT TRAINING
Theory
74%
39/53
Missed 14   Leave 0   Duty Leave 0
`;

// ---------------------------------------------------------------------------
// 1. Single full-page OCR dump of the 8 S5 CSE-AI subjects
// ---------------------------------------------------------------------------
describe("parseSingleEtlabOcrText — full 8-subject S5 CSE-AI dump", () => {
  it("extracts overall header (407/489) and all 8 cards accurately", () => {
    const parsed = parseSingleEtlabOcrText(FULL_PAGE_OCR);

    expect(parsed.overallHeader).toEqual({ attended: 407, total: 489 });
    expect(parsed.warnings).toHaveLength(0);
    expect(parsed.cards).toHaveLength(8);

    expect(parsed.cards.map((c) => c.code)).toEqual([
      "PCCST501",
      "PCCAT502",
      "PCCST503",
      "PBCAT504",
      "PEAIT523",
      "PCCAL507",
      "PCCSL508",
      "PLT-2026",
    ]);

    expect(parsed.cards.map((c) => c.slotLetter)).toEqual([
      "A",
      "B",
      "C",
      "D",
      "E",
      "L",
      "Q",
      "Z",
    ]);

    expect(parsed.cards.map((c) => c.kind)).toEqual([
      "theory",
      "theory",
      "theory",
      "theory",
      "theory",
      "lab",
      "lab",
      "theory",
    ]);

    expect(parsed.cards.map((c) => c.hoursPerSession)).toEqual([
      1, 1, 1, 1, 1, 3, 3, 1,
    ]);

    const c1 = parsed.cards[0]!;
    expect(c1.name).toBe("COMPUTER NETWORKS");
    expect(c1.attended).toBe(64);
    expect(c1.total).toBe(79);
    expect(c1.missed).toBe(15);
    expect(c1.displayedPercent).toBe(81);
    expect(c1.creditWise).toBe("8 / 10");

    const c6 = parsed.cards[5]!;
    expect(c6.name).toBe("AI ALGORITHMS LAB");
    expect(c6.kind).toBe("lab");
    expect(c6.hoursPerSession).toBe(3);
    expect(c6.attended).toBe(33);
    expect(c6.total).toBe(36);

    const c8 = parsed.cards[7]!;
    expect(c8.name).toBe("PLACEMENT TRAINING");
    expect(c8.attended).toBe(39);
    expect(c8.total).toBe(53);
    expect(c8.creditWise).toBeUndefined();

    // Must pass validateEtlExtract cleanly
    const checksum = validateEtlExtract(parsed.overallHeader!, parsed.cards);
    expect(checksum.valid).toBe(true);
    expect(checksum.cardErrors).toHaveLength(0);
    expect(checksum.headerMismatch).toBeNull();
  });

  it("detects lab by trailing LAB in name even if Practical badge is absent", () => {
    const text = `
PCCAL507 (L)
AI ALGORITHMS LAB
92%
33/36
Missed 3  Leave 0  Duty Leave 0
`;
    const parsed = parseSingleEtlabOcrText(text);
    expect(parsed.cards).toHaveLength(1);
    expect(parsed.cards[0]!.kind).toBe("lab");
    expect(parsed.cards[0]!.hoursPerSession).toBe(3);
  });

  it("does not confuse subject name 'THEORY OF COMPUTATION' with the Theory badge", () => {
    const text = `
CS307 (B)
THEORY OF COMPUTATION
Theory  Credit-wise 8 / 10
84%  63/75
Missed 12  Leave 0  Duty Leave 0
`;
    const parsed = parseSingleEtlabOcrText(text);
    expect(parsed.cards).toHaveLength(1);
    expect(parsed.cards[0]!.name).toBe("THEORY OF COMPUTATION");
    expect(parsed.cards[0]!.attended).toBe(63);
    expect(parsed.cards[0]!.total).toBe(75);
  });

  it("does not misread Credit-wise 10/10 as attendance when attendance X/Y is cut off", () => {
    const cutOffWithCreditWise = `
PEAIT523 (E)
HEALTHCARE ANALYTICS
Theory   Credit-wise 10 / 10
`;
    const parsed = parseSingleEtlabOcrText(cutOffWithCreditWise);
    expect(parsed.cards).toHaveLength(0);
    expect(parsed.warnings.length).toBeGreaterThan(0);
    expect(parsed.warnings[0]).toContain("PEAIT523");
  });
});

// ---------------------------------------------------------------------------
// 2. Multi-screenshot merge & deduplication across 3 overlapping chunks
// ---------------------------------------------------------------------------
describe("mergeAndValidateOcrExtracts — 3 overlapping screenshots", () => {
  const shot1 = `
407 of 489 hours attended
83%

PCCST501 (A)
COMPUTER NETWORKS
Theory  Credit-wise 8 / 10
81%  64/79
Missed 15  Leave 0  Duty Leave 0

PCCAT502 (B)
INTRODUCTION TO ARTIFICIAL INTELLIGENCE
Theory  Credit-wise 8 / 10
84%  63/75
Missed 12  Leave 0  Duty Leave 0

PCCST503 (C)
MACHINE LEARNING
Theory  Credit-wise 8 / 10
81%  63/78
Missed 15  Leave 0  Duty Leave 0

PBCAT504 (D)
ADVANCED GRAPH ALGORITHM
Theory  Credit-wise 6 / 10
79%  69/87
Missed 18  Leave 0  Duty Leave 0

PEAIT523 (E)
HEALTHCARE ANALYTICS
Theory
`;

  const shot2 = `
ADVANCED GRAPH ALGORITHM
79%  69/87
Missed 18  Leave 0  Duty Leave 0

PBCAT504 (D)
ADVANCED GRAPH ALGORITHM
Theory  Credit-wise 6 / 10
79%  69/87
Missed 18  Leave 0  Duty Leave 0

PEAIT523 (E)
HEALTHCARE ANALYTICS
Theory  Credit-wise 10 / 10
96%  46/48
Missed 2  Leave 0  Duty Leave 0

PCCAL507 (L)
AI ALGORITHMS LAB
Practical  Credit-wise 10 / 10
92%  33/36
Missed 3  Leave 0  Duty Leave 0

PCCSL508 (Q)
MACHINE LEARNING LAB
Practical  Credit-wise 10 / 10
91%  30/33
Missed 3  Leave 0  Duty Leave 0
`;

  const shot3 = `
PCCAL507 (L)
AI ALGORITHMS LAB
Practical  Credit-wise 10 / 10
92%  33/36
Missed 3  Leave 0  Duty Leave 0

PCCSL508 (Q)
MACHINE LEARNING LAB
Practical  Credit-wise 10 / 10
91%  30/33
Missed 3  Leave 0  Duty Leave 0

PLT-2026 (Z)
PLACEMENT TRAINING
Theory
74%  39/53
Missed 14  Leave 0  Duty Leave 0
`;

  it("merges 3 overlapping shots, deduplicates, ignores fragments, and passes 407/489 checksum", () => {
    const res = mergeAndValidateOcrExtracts([shot1, shot2, shot3]);

    expect(res.overallHeader).toEqual({ attended: 407, total: 489 });
    expect(res.cards).toHaveLength(8);
    expect(res.duplicatesRemoved).toBeGreaterThanOrEqual(2); // PBCAT504, PCCAL507, PCCSL508 = 3
    expect(res.duplicatesRemoved).toBe(3);

    // Order preserved top-to-bottom
    expect(res.cards.map((c) => c.code)).toEqual([
      "PCCST501",
      "PCCAT502",
      "PCCST503",
      "PBCAT504",
      "PEAIT523",
      "PCCAL507",
      "PCCSL508",
      "PLT-2026",
    ]);

    // Warnings recorded for the bottom cut-off card in shot1 and top fragment in shot2
    expect(res.warnings.length).toBeGreaterThanOrEqual(2);

    // Full checksum passes
    expect(res.checksum).not.toBeNull();
    expect(res.checksum!.valid).toBe(true);
    expect(res.checksum!.headerMismatch).toBeNull();
  });

  it("prefers the arithmetically complete duplicate when an earlier shot cut off Missed", () => {
    // Card 5 in shotA has fraction 46/48, but Missed 2 was cut off -> missed=0 (48-0 !== 46)
    const shotA = `
407 of 489 hours attended
PEAIT523 (E)
HEALTHCARE ANALYTICS
Theory
96%
46/48
`;
    // Card 5 in shotB is complete with Missed 2 (48-2 === 46)
    const shotB = `
PEAIT523 (E)
HEALTHCARE ANALYTICS
Theory  Credit-wise 10 / 10
96%
46/48
Missed 2  Leave 0  Duty Leave 0
`;
    const res = mergeAndValidateOcrExtracts([shotA, shotB]);
    expect(res.cards).toHaveLength(1);
    expect(res.duplicatesRemoved).toBe(1);
    expect(res.cards[0]!.missed).toBe(2);
    expect(res.cards[0]!.creditWise).toBe("10 / 10");
    expect(res.checksum!.cardErrors).toHaveLength(0);
  });

  it("also prefers arithmetically complete card when complete shot comes first and cut-off comes second", () => {
    const completeShot = `
PEAIT523 (E)
HEALTHCARE ANALYTICS
Theory
96%  46/48
Missed 2  Leave 0  Duty Leave 0
`;
    const partialShot = `
PEAIT523 (E)
HEALTHCARE ANALYTICS
Theory
96%  46/48
`;
    const res = mergeAndValidateOcrExtracts([completeShot, partialShot]);
    expect(res.cards).toHaveLength(1);
    expect(res.duplicatesRemoved).toBe(1);
    expect(res.cards[0]!.missed).toBe(2);
  });
});

// ---------------------------------------------------------------------------
// 3. OCR noise resilience & missing card checksum headerMismatch
// ---------------------------------------------------------------------------
describe("OCR noise & missing card headerMismatch", () => {
  it("handles noisy spacing, brackets, missing space before (, Duty Leave O, and line breaks", () => {
    const noisyText = `
Overall Attendance
83%
407   of   489   hours   attended

PCCST501[A]   Theory   81 %   64 / 79
COMPUTER NETWORKS
Missed: 15 | Leave: O | Duty Leave: O | Credit-wise 8/10

PCCAT502( B )
INTRODUCTION TO ARTIFICIAL
INTELLIGENCE
Theory   84%   63 / 75
Missed: 12   Leave: 0   Duty Leave: O
Credit-wise: 8/10

PCCST503(C)
MACHINE LEARNING
Theory   Credit-wise 8/10
81%
63 / 78
Missed: 15
Leave: 0
Duty Leave: O

PBCAT504 [ D ]
ADVANCED GRAPH ALGORITHM
Theory   Credit-wise 6/10   79%   69 / 87
Missed 18   Leave 0   Duty Leave 0

PEAIT523(E)
HEALTHCARE ANALYTICS
Theory   96%   46 / 48
Missed: 2   Leave: 0   Duty Leave: 0
Credit-wise 10/10

PCCAL507 [L]
AI ALGORITHMS LAB
Practical   92%   33 / 36
Missed: 3   Leave: 0   Duty Leave: O
Credit-wise 10/10

PCCSL508(Q)
MACHINE LEARNING LAB
Practical   91%   30 / 33
Missed: 3   Leave: O   Duty Leave: 0
Credit-wise 10/10
`;
    // Notice card 8 (PLT-2026, 39/53) is completely missing!
    const res = mergeAndValidateOcrExtracts([noisyText]);

    expect(res.overallHeader).toEqual({ attended: 407, total: 489 });
    expect(res.cards).toHaveLength(7);

    // Check noisy-parsed fields
    const net = res.cards[0]!;
    expect(net.code).toBe("PCCST501");
    expect(net.slotLetter).toBe("A");
    expect(net.name).toBe("COMPUTER NETWORKS");
    expect(net.attended).toBe(64);
    expect(net.total).toBe(79);
    expect(net.leave).toBe(0);
    expect(net.dutyLeave).toBe(0);
    expect(net.creditWise).toBe("8 / 10");

    const ai = res.cards[1]!;
    expect(ai.slotLetter).toBe("B");
    expect(ai.name).toBe("INTRODUCTION TO ARTIFICIAL INTELLIGENCE");

    const ml = res.cards[2]!;
    expect(ml.code).toBe("PCCST503");
    expect(ml.slotLetter).toBe("C");
    expect(ml.missed).toBe(15);
    expect(ml.dutyLeave).toBe(0);

    // Checksum must flag exact missing delta for PLT-2026 (39/53)
    expect(res.checksum).not.toBeNull();
    expect(res.checksum!.valid).toBe(false);
    expect(res.checksum!.cardErrors).toHaveLength(0);
    expect(res.checksum!.headerMismatch).toEqual({
      missingAttended: 39,
      missingTotal: 53,
    });
  });

  it("returns checksum: null when no overallHeader is present in any screenshot", () => {
    const partialOnly = `
PCCST501 (A)
COMPUTER NETWORKS
Theory  81%  64/79
Missed 15  Leave 0  Duty Leave 0
`;
    const res = mergeAndValidateOcrExtracts([partialOnly]);
    expect(res.overallHeader).toBeNull();
    expect(res.checksum).toBeNull();
    expect(res.cards).toHaveLength(1);
  });
});

