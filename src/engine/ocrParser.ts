/**
 * Pure ETLAB Multi-Screenshot OCR Text Parser & Card Deduplicator.
 *
 * Parses raw OCR text from 1–4 overlapping screenshots of the ETLAB
 * "By Course" screen into structured cards, deduplicates overlapping cards
 * (preferring arithmetically complete cards over cut-off fragments), and runs
 * validateEtlExtract checksum validation when the overall header is present.
 *
 * Zero runtime dependencies. Integer math only. No Date calls.
 */

import type {
  ChecksumResult,
  EtlabCard,
  EtlabOverallHeader,
} from "./types2.js";
import { validateEtlExtract } from "./checksum.js";

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

/** A parsed ETLAB course card with full metadata ready for seeding or sync. */
export interface ParsedEtlabCard extends EtlabCard {
  code: string;
  slotLetter: string;
  name: string;
  kind: "theory" | "lab";
  hoursPerSession: number;
  creditWise?: string;
}

/** Result of parsing a single OCR text dump. */
export interface SingleOcrParseResult {
  overallHeader: EtlabOverallHeader | null;
  cards: ParsedEtlabCard[];
  warnings: string[];
}

/** Result of merging and validating 1–4 overlapping screenshot OCR dumps. */
export interface MultiOcrParseResult {
  overallHeader: EtlabOverallHeader | null;
  cards: ParsedEtlabCard[];
  checksum: ChecksumResult | null;
  duplicatesRemoved: number;
  warnings: string[];
}

// ---------------------------------------------------------------------------
// Regex patterns
// ---------------------------------------------------------------------------

/**
 * Matches ETLAB course code + slot letter headers, e.g.:
 *   PCCST501 (A), PEAIT523(E), PCCAL507 [L], PLT-2026 ( Z )
 * Requires at least 2 uppercase letters and at least 1 digit in the code.
 */
const CODE_SLOT_RE =
  /(?<![A-Za-z0-9-])((?=[A-Z0-9-]*[A-Z]{2,})(?=[A-Z0-9-]*\d)[A-Z0-9]{2,12}(?:-[A-Z0-9]{1,8})?)[ \t]*\n?[ \t]*[\(\[\{][ \t]*([A-Z])[ \t]*[\)\]\}]/g;

/** Primary overall header pattern: "407 of 489 hours attended" */
const OVERALL_HOURS_RE =
  /\b(\d+)\s+of\s+(\d+)\s+(?:hours?|hrs?)(?:\s+attended)?\b/i;

/** Fallback overall header pattern if "of ... hours" was formatted differently. */
const OVERALL_FALLBACK_RE =
  /\boverall(?:\s+attendance)?[\s:|\-]*(?:\d{1,3}\s*%\s*)?(\d+)\s*\/\s*(\d+)\b/i;

/** Credit-wise ratio pattern: "Credit-wise: 8 / 10", "Credit wise 8/10", etc. */
const CREDIT_WISE_RE =
  /\bcredit[\s\-]*wise\b[\s:.\-]*(\d+)\s*\/\s*(\d+)/gi;

/** Stat patterns — matched in order so "Duty Leave" never collides with "Leave". */
const DUTY_LEAVE_RE =
  /\bduty[\s\-]*leave\b[\s:.\-]*(\d+|[Oo])\b(?![\s]*[%\/])/i;
const LEAVE_RE =
  /\bleave\b[\s:.\-]*(\d+|[Oo])\b(?![\s]*[%\/])/i;
const MISSED_RE =
  /\bmissed\b[\s:.\-]*(\d+|[Oo])\b(?![\s]*[%\/])/i;

/** Attendance fraction X/Y (guards against dates like DD/MM/YYYY). */
const FRACTION_RE =
  /(?<!\d\/\s*)(\d+)\s*\/\s*(\d+)(?!\s*\/\d)/g;

/** Displayed integer percentage e.g. "81%" or "81 %". */
const PERCENT_RE = /(?:^|[^\d.])(\d{1,3})\s*%/;

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/** Converts an OCR number token ("15" or "O"/"o" -> 0) into an integer. */
function parseOcrNumber(token: string): number {
  if (token === "O" || token === "o") return 0;
  return parseInt(token, 10);
}

/**
 * Extracts `overallHeader` and returns both the header and a copy of `text`
 * with the matched header phrase removed (so it doesn't interfere with fragments).
 */
function extractOverallHeader(text: string): {
  header: EtlabOverallHeader | null;
  remainingText: string;
} {
  const primary = OVERALL_HOURS_RE.exec(text);
  if (primary && primary[1] && primary[2]) {
    const attended = parseInt(primary[1], 10);
    const total = parseInt(primary[2], 10);
    if (total >= 0 && attended >= 0 && attended <= total) {
      return {
        header: { attended, total },
        remainingText:
          text.slice(0, primary.index) +
          text.slice(primary.index + primary[0].length),
      };
    }
  }

  const fallback = OVERALL_FALLBACK_RE.exec(text);
  if (fallback && fallback[1] && fallback[2]) {
    const attended = parseInt(fallback[1], 10);
    const total = parseInt(fallback[2], 10);
    if (total > 0 && attended >= 0 && attended <= total) {
      return {
        header: { attended, total },
        remainingText:
          text.slice(0, fallback.index) +
          text.slice(fallback.index + fallback[0].length),
      };
    }
  }

  return { header: null, remainingText: text };
}

/** Strips Credit-wise blocks from a working copy so 8/10 isn't read as attendance. */
function stripCreditWise(text: string): string {
  return text.replace(CREDIT_WISE_RE, " ");
}

/** Returns true if a line starts a card's metadata/stats section (not the title). */
function isMetadataLine(trimmedLine: string): boolean {
  if (
    /^(?:theory|practical)(?:\s*(?:[|•\-]|credit[\s\-]*wise|\d+\s*%|\d+\s*\/\s*\d+|missed|leave|duty[\s\-]*leave).*)?$/i.test(
      trimmedLine
    )
  ) {
    return true;
  }
  if (/^(?:missed|leave|duty[\s\-]*leave|credit[\s\-]*wise)\b/i.test(trimmedLine)) {
    return true;
  }
  if (/^\d{1,3}\s*%/.test(trimmedLine)) {
    return true;
  }
  if (/^\d+\s*\/\s*\d+/.test(trimmedLine)) {
    return true;
  }
  return false;
}

/** Removes inline badges, stats, percents, and fractions from a candidate name line. */
function stripInlineMetadata(line: string): string {
  let out = line;

  // Remove Credit-wise blocks
  out = out.replace(CREDIT_WISE_RE, " ");

  // Remove Duty Leave / Leave / Missed and their numeric values
  out = out.replace(/\bduty[\s\-]*leave\b[\s:.\-]*(?:\d+|[Oo])?\b/gi, " ");
  out = out.replace(/\b(?:missed|leave)\b[\s:.\-]*(?:\d+|[Oo])?\b/gi, " ");

  // Remove standalone badge words when at start, after separator/2+ spaces, or alone
  out = out.replace(
    /^(?:theory|practical)(?=\s*(?:[|•\-]|$|\d|credit))/i,
    " "
  );
  out = out.replace(/(?:[|•]|\s{2,})\s*(?:theory|practical)\b/gi, " ");
  out = out.replace(/^\s*(?:theory|practical)\s*$/i, " ");

  // Remove percentages and fractions
  out = out.replace(/\b\d{1,3}\s*%/g, " ");
  out = out.replace(/(?<!\d\/\s*)\d+\s*\/\s*\d+(?!\s*\/\d)/g, " ");

  // Trim noisy punctuation separators at ends and collapse whitespace
  out = out.replace(/[|•·]+/g, " ");
  out = out.replace(/^[\s\-:]+|[\s\-:]+$/g, "");
  out = out.replace(/\s+/g, " ").trim();

  return out;
}

/** Extracts the human-readable subject name from the lines immediately following CODE (SLOT). */
function extractSubjectName(bodyAfterCode: string, fallbackCode: string): string {
  const lines = bodyAfterCode.split("\n");
  const nameParts: string[] = [];

  for (const rawLine of lines) {
    const trimmed = rawLine.trim();
    if (!trimmed) {
      if (nameParts.length > 0) break;
      continue;
    }

    if (isMetadataLine(trimmed)) {
      if (nameParts.length > 0) break;
      // Still try stripping in case line 0 has name + inline badge/stats;
      // pure metadata lines strip to "".
    }

    const cleaned = stripInlineMetadata(trimmed);
    if (cleaned) {
      nameParts.push(cleaned);
    } else if (nameParts.length > 0) {
      break;
    }
  }

  return nameParts.length > 0 ? nameParts.join(" ") : fallbackCode;
}

/** Checks if a preamble before the first course code looks like a cut-off card fragment. */
function hasCutOffCardFragment(preambleWithoutHeader: string): boolean {
  const withoutCredit = stripCreditWise(preambleWithoutHeader);
  FRACTION_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = FRACTION_RE.exec(withoutCredit)) !== null) {
    const att = parseInt(m[1] ?? "0", 10);
    const tot = parseInt(m[2] ?? "0", 10);
    if (tot > 0 && att <= tot) return true;
  }
  if (/\b(?:missed|duty[\s\-]*leave)\b[\s:.\-]*(?:\d+|[Oo])\b/i.test(withoutCredit)) {
    return true;
  }
  return false;
}

/** Arithmetic integrity helper matching Step 2's checksum identity. */
function passesCardArithmetic(card: ParsedEtlabCard): boolean {
  return card.total - card.missed - card.leave - card.dutyLeave === card.attended;
}

/** Displayed percentage integrity helper matching Step 2's checksum rounding. */
function passesCardPercent(card: ParsedEtlabCard): boolean {
  if (card.total === 0) return card.displayedPercent === 0;
  const computed = Math.floor((card.attended * 200 + card.total) / (2 * card.total));
  return computed === card.displayedPercent;
}

/** Picks the higher-quality card when the same course code appears in multiple screenshots. */
function pickBetterCard(
  existing: ParsedEtlabCard,
  candidate: ParsedEtlabCard
): ParsedEtlabCard {
  const existingArith = passesCardArithmetic(existing);
  const candidateArith = passesCardArithmetic(candidate);
  if (candidateArith && !existingArith) return candidate;
  if (existingArith && !candidateArith) return existing;

  const existingPct = passesCardPercent(existing);
  const candidatePct = passesCardPercent(candidate);
  if (candidatePct && !existingPct) return candidate;
  if (existingPct && !candidatePct) return existing;

  // Prefer whichever carries more extracted detail (e.g. creditWise or fuller name)
  if (candidate.creditWise !== undefined && existing.creditWise === undefined) {
    return candidate;
  }
  if (existing.creditWise !== undefined && candidate.creditWise === undefined) {
    return existing;
  }
  if (candidate.name.length > existing.name.length) {
    return candidate;
  }

  return existing;
}

// ---------------------------------------------------------------------------
// Public functions
// ---------------------------------------------------------------------------

/**
 * Parses raw OCR text from a single ETLAB "By Course" screenshot.
 *
 * Resilient to noisy spacing, brackets around slot letters, missing spaces
 * before `(`, `O` instead of `0`, and wrapped subject titles. Ignores partial
 * cut-off cards lacking a course code or a valid X/Y fraction and records
 * a note in `warnings`.
 */
export function parseSingleEtlabOcrText(rawText: string): SingleOcrParseResult {
  const normalized = rawText.replace(/\r\n?/g, "\n");
  const warnings: string[] = [];

  const { header: overallHeader, remainingText } = extractOverallHeader(normalized);

  // Locate all course code + slot headers in top-to-bottom order
  CODE_SLOT_RE.lastIndex = 0;
  const matches: Array<{
    index: number;
    endIndex: number;
    code: string;
    slotLetter: string;
  }> = [];

  let match: RegExpExecArray | null;
  while ((match = CODE_SLOT_RE.exec(remainingText)) !== null) {
    const code = match[1];
    const slotLetter = match[2];
    if (!code || !slotLetter) continue;
    matches.push({
      index: match.index,
      endIndex: match.index + match[0].length,
      code,
      slotLetter,
    });
  }

  // Check preamble before first matched course code for top-cut-off card fragment
  const preamble =
    matches.length > 0
      ? remainingText.slice(0, matches[0]!.index)
      : remainingText;

  if (hasCutOffCardFragment(preamble)) {
    warnings.push(
      "Ignored partial card fragment at top of screenshot (missing course code)."
    );
  }

  const cards: ParsedEtlabCard[] = [];

  for (let i = 0; i < matches.length; i++) {
    const current = matches[i]!;
    const nextStart =
      i + 1 < matches.length ? matches[i + 1]!.index : remainingText.length;

    const bodyAfterCode = remainingText.slice(current.endIndex, nextStart);

    // 1. Extract optional Credit-wise ("8 / 10")
    CREDIT_WISE_RE.lastIndex = 0;
    const creditMatch = CREDIT_WISE_RE.exec(bodyAfterCode);
    const creditWise =
      creditMatch && creditMatch[1] && creditMatch[2]
        ? `${creditMatch[1]} / ${creditMatch[2]}`
        : undefined;

    // Strip Credit-wise before searching for stats or attendance fraction
    const withoutCredit = stripCreditWise(bodyAfterCode);

    // 2. Extract Duty Leave first, strip it, then extract Leave & Missed
    let workingForStats = withoutCredit;

    const dlMatch = DUTY_LEAVE_RE.exec(workingForStats);
    const dutyLeave = dlMatch && dlMatch[1] ? parseOcrNumber(dlMatch[1]) : 0;
    if (dlMatch) {
      workingForStats =
        workingForStats.slice(0, dlMatch.index) +
        " " +
        workingForStats.slice(dlMatch.index + dlMatch[0].length);
    }

    const leaveMatch = LEAVE_RE.exec(workingForStats);
    const leave = leaveMatch && leaveMatch[1] ? parseOcrNumber(leaveMatch[1]) : 0;
    if (leaveMatch) {
      workingForStats =
        workingForStats.slice(0, leaveMatch.index) +
        " " +
        workingForStats.slice(leaveMatch.index + leaveMatch[0].length);
    }

    const missedMatch = MISSED_RE.exec(workingForStats);
    const missed = missedMatch && missedMatch[1] ? parseOcrNumber(missedMatch[1]) : 0;
    if (missedMatch) {
      workingForStats =
        workingForStats.slice(0, missedMatch.index) +
        " " +
        workingForStats.slice(missedMatch.index + missedMatch[0].length);
    }

    // 3. Extract valid attendance fraction X/Y
    FRACTION_RE.lastIndex = 0;
    let attended: number | null = null;
    let total: number | null = null;
    let fracMatch: RegExpExecArray | null;
    while ((fracMatch = FRACTION_RE.exec(workingForStats)) !== null) {
      const a = parseInt(fracMatch[1] ?? "", 10);
      const t = parseInt(fracMatch[2] ?? "", 10);
      if (Number.isInteger(a) && Number.isInteger(t) && (t > 0 || a === 0) && a <= t) {
        attended = a;
        total = t;
        break;
      }
    }

    if (attended === null || total === null) {
      warnings.push(
        `Ignored partial card for ${current.code} (${current.slotLetter}): missing valid attended/total fraction.`
      );
      continue;
    }

    // 4. Extract displayed percentage
    const pctMatch = PERCENT_RE.exec(workingForStats);
    const displayedPercent = pctMatch && pctMatch[1] ? parseInt(pctMatch[1], 10) : -1;

    // 5. Extract subject name and determine kind / hoursPerSession
    const name = extractSubjectName(bodyAfterCode, current.code);
    const isLab =
      /\bpractical\b/i.test(bodyAfterCode) || /\blab(?:oratory)?\s*$/i.test(name);
    const kind: "theory" | "lab" = isLab ? "lab" : "theory";
    const hoursPerSession = isLab ? 3 : 1;

    const card: ParsedEtlabCard = {
      subjectId: current.code,
      code: current.code,
      slotLetter: current.slotLetter,
      name,
      kind,
      hoursPerSession,
      attended,
      total,
      missed,
      leave,
      dutyLeave,
      displayedPercent,
      ...(creditWise !== undefined ? { creditWise } : {}),
    };

    cards.push(card);
  }

  return { overallHeader, cards, warnings };
}

/**
 * Merges and validates OCR text dumps from 1 to 4 overlapping screenshots.
 *
 * - Picks the valid `overallHeader` if present in any screenshot.
 * - Deduplicates cards by `code` while preserving top-to-bottom order.
 * - Prefers a duplicate that passes per-card arithmetic checksum over a
 *   partially cut-off version missing Missed/Leave/Duty Leave lines.
 * - Runs `validateEtlExtract` when `overallHeader` is present.
 */
export function mergeAndValidateOcrExtracts(
  rawTexts: string[]
): MultiOcrParseResult {
  let overallHeader: EtlabOverallHeader | null = null;
  const byCode = new Map<string, ParsedEtlabCard>();
  let duplicatesRemoved = 0;
  const warnings: string[] = [];

  for (const text of rawTexts) {
    const parsed = parseSingleEtlabOcrText(text);
    warnings.push(...parsed.warnings);

    if (parsed.overallHeader !== null) {
      if (
        overallHeader === null ||
        (overallHeader.total === 0 && parsed.overallHeader.total > 0)
      ) {
        overallHeader = parsed.overallHeader;
      }
    }

    for (const card of parsed.cards) {
      const existing = byCode.get(card.code);
      if (!existing) {
        byCode.set(card.code, card);
      } else {
        duplicatesRemoved++;
        byCode.set(card.code, pickBetterCard(existing, card));
      }
    }
  }

  const cards = Array.from(byCode.values());
  const checksum =
    overallHeader !== null ? validateEtlExtract(overallHeader, cards) : null;

  return {
    overallHeader,
    cards,
    checksum,
    duplicatesRemoved,
    warnings,
  };
}
