/**
 * ETLAB OCR Checksum Validator.
 *
 * Validates the arithmetic and consistency of values extracted from an ETLAB
 * screenshot. Designed to catch OCR errors before they corrupt the anchor.
 *
 * All math is integer arithmetic. No floating-point comparisons.
 */

import type {
  EtlabCard,
  EtlabOverallHeader,
  ChecksumResult,
} from "./types2.js";

/**
 * Validates an OCR-extracted ETLAB page.
 *
 * Per-card checks:
 *  1. Arithmetic: total - missed - leave - dutyLeave === attended
 *     (or total - missed === attended when leave and dutyLeave are both 0).
 *  2. Displayed percent: Math.round((attended / total) * 100) === displayedPercent.
 *
 * Header checks:
 *  3. Sum of card.attended === overallHeader.attended.
 *  4. Sum of card.total === overallHeader.total.
 *     If they don't match, returns the exact delta so the UI can warn about
 *     a cut-off card in the screenshot.
 *
 * @param overallHeader - The overall row (top-level totals) from the ETLAB page.
 * @param extractedCards - Individual subject cards extracted from the page.
 */
export function validateEtlExtract(
  overallHeader: EtlabOverallHeader,
  extractedCards: EtlabCard[]
): ChecksumResult {
  const cardErrors: ChecksumResult["cardErrors"] = [];
  let sumAttended = 0;
  let sumTotal = 0;

  for (const card of extractedCards) {
    // -----------------------------------------------------------------------
    // Check 1: Arithmetic consistency
    // total - missed - leave - dutyLeave should equal attended
    // -----------------------------------------------------------------------
    const computedAttended = card.total - card.missed - card.leave - card.dutyLeave;
    if (computedAttended !== card.attended) {
      cardErrors.push({
        subjectId: card.subjectId,
        issue: "arithmetic",
        detail:
          `total(${card.total}) - missed(${card.missed}) - leave(${card.leave}) ` +
          `- dutyLeave(${card.dutyLeave}) = ${computedAttended}, ` +
          `but card shows attended=${card.attended}.`,
      });
    }

    // -----------------------------------------------------------------------
    // Check 2: Displayed percentage
    // Math.round((attended / total) * 100) should equal displayedPercent
    // Use integer arithmetic: round((attended * 100 * 2 + total) / (total * 2))
    // equivalent to Math.round(attended * 100 / total) but stays integer
    // -----------------------------------------------------------------------
    if (card.total > 0) {
      // Math.round(x) = Math.floor(x + 0.5) = Math.floor((2x + 1) / 2)
      // x = attended * 100 / total
      // 2x = attended * 200 / total  → floor((attended * 200 + total) / (2 * total))
      const computedPercent = Math.floor(
        (card.attended * 200 + card.total) / (2 * card.total)
      );
      if (computedPercent !== card.displayedPercent) {
        cardErrors.push({
          subjectId: card.subjectId,
          issue: "percent_mismatch",
          detail:
            `Expected displayed percent round(${card.attended}/${card.total}*100)` +
            `=${computedPercent}, but card shows ${card.displayedPercent}.`,
        });
      }
    }

    sumAttended += card.attended;
    sumTotal += card.total;
  }

  // -------------------------------------------------------------------------
  // Check 3 & 4: Header totals
  // -------------------------------------------------------------------------
  const missingAttended = overallHeader.attended - sumAttended;
  const missingTotal = overallHeader.total - sumTotal;

  const headerMismatch =
    missingAttended !== 0 || missingTotal !== 0
      ? { missingAttended, missingTotal }
      : null;

  return {
    valid: cardErrors.length === 0 && headerMismatch === null,
    cardErrors,
    headerMismatch,
  };
}

