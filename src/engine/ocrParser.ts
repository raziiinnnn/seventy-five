/**
 * Pure ETLAB Multi-Screenshot OCR Text Parser & Card Deduplicator.
 *
 * Parses raw OCR text from 1–4 overlapping screenshots of the ETLAB
 * "By Course" screen into structured cards, deduplicates overlapping cards
 * (preferring arithmetically complete cards over cut-off fragments), and runs
 * validateEtlExtract checksum validation when the overall header is present.
 *
 * Zero runtime dependencies. Integer math only. No Date calls.
 *
 * Resilient to real Tesseract noise:
 *  - Course code digit confusion (`PCCATS02`→`PCCAT502`, `PCCALS007`→`PCCAL507`, `PLT-2O26 (2)`→`PLT-2026 (Z)`)
 *  - "of" read as "0f", "hours" as "hrs", "4O7" with O→0
 *  - Slash "/" misread as "1", "l", "I", or "7" (e.g. "64/79" → "64179")
 *  - Mangled numerator with intact denominator (e.g. `do/48` + Missed 2 + 96% → `46/48`)
 *  - Parentheses mangled into brackets, braces, missing, or standalone letter
 *  - Fraction completely absent → recover from Missed + % arithmetic
 *  - Row-merged course badges & faculty icons (`Theory & ... ® FACULTY`)
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
  /** Raw text strings returned by Tesseract (Y-sorted horizontal lines), one per image. */
  rawTexts?: string[];
}

// ---------------------------------------------------------------------------
// Regex patterns
// ---------------------------------------------------------------------------

/**
 * Matches ETLAB course code + slot letter headers (case-sensitive on code/slot
 * to avoid accidentally consuming English words like "INTRODUCTION").
 *
 * Handles:
 *  - PCCST501 (A), PLT-2026 ( Z ), PEAIT523(E), PCCALS007 (L)
 *  - PCCAL507 [L], PCCST501 {A}
 *  - PCCST501 IAI, PCCST501 |A| (OCR bracket misreads)
 *  - PCCST501 (A, PCCST501 A)   (half-missing parens)
 *  - PCCST501 A Theory / PCCST501 A Practical / PCCST501 A\n... (standalone letter)
 */
const CODE_WITH_SLOT_RE =
  /(?<![A-Za-z0-9-])((?=[A-Z0-9-]*[A-Z]{2,})(?=[A-Z0-9-]*\d)[A-Z0-9]{2,12}(?:-[A-Z0-9]{1,8})?)(?:\n?[ \t]*[(\[{][ \t]*([A-Z])[ \t]*[)\]}]|[ \t]+[Il|][ \t]*([A-Z])[ \t]*[Il|](?![A-Za-z0-9])|[ \t]*[(\[{][ \t]*([A-Z])(?![A-Za-z0-9])|[ \t]+([A-Z])[ \t]*[)\]\}](?![A-Za-z0-9])|[ \t]+([A-Z])(?=[ \t]*(?:\n|$|[ \t]+(?:[Tt](?:heory|HEORY)|[Pp](?:ractical|RACTICAL)|[Pp](?:rogram|ROGRAM)\s+[Ee](?:lective|LECTIVE)|[Cc](?:redit|REDIT)|[Mm](?:issed|ISSED)|\d{1,3}\s*%|\d+\s*[/|\\]\s*\d+))))/g;

/**
 * Specialised matcher for `PLT-2026` variants including space/em-dash/missing
 * hyphen (`PLT 2026`, `PLT—2026`, `PLT2026`, `PLT-2O26`) and slot `Z` or `2`
 * (since Tesseract frequently reads `(Z)` as `(2)`).
 */
const PLT_CODE_SLOT_RE =
  /(?<![A-Za-z0-9-])(PLT[-—–\s]?[2Z][0O]26)(?:\n?[ \t]*[(\[{][ \t]*([Z2])[ \t]*[)\]}]|[ \t]+[Il|][ \t]*([Z2])[ \t]*[Il|](?![A-Za-z0-9])|[ \t]*[(\[{][ \t]*([Z2])(?![A-Za-z0-9])|[ \t]+([Z2])[ \t]*[)\]\}](?![A-Za-z0-9])|[ \t]+([Z2])(?=[ \t]*(?:\n|$|[ \t]+(?:[Nn]o\s+[Uu]niversity|[Tt](?:heory|HEORY)|[Cc](?:redit|REDIT)|[Mm](?:issed|ISSED)|\d{1,3}\s*%|\d+\s*[/|\\]\s*\d+))))?/g;

/**
 * Fallback course code detector when Tesseract drops the slot letter altogether,
 * e.g. `PCCST501` alone at the start of a line before title / Theory / badge.
 */
const CODE_NO_SLOT_RE =
  /(?:^|\n)[ \t]*([A-Z]{2,}[A-Z0-9-]*\d[A-Z0-9-]*)(?=[ \t]*(?:\n|$|\d{1,3}\s*%|\d+\s*[/|\\]\s*\d+|[Tt](?:heory|HEORY)|[Pp](?:ractical|RACTICAL)|[Pp](?:rogram|ROGRAM)|[Nn]o\s+[Uu]niversity))/g;

/** Credit-wise ratio pattern: "Credit-wise: 8 / 10", "Credit wise 8/10", etc. */
const CREDIT_WISE_CAPTURE_RE =
  /\bcredit[\s\-]*wise\b[\s:.\-]*(\d+)\s*[/|\\]\s*(\d+)/gi;

/** Strip Credit-wise tokens (including mangled "Credit 8/10" or fused "8110"). */
const CREDIT_WISE_STRIP_RE =
  /\bcredit(?:[\s\-]*wise)?\b[\s:.\-]*(?:\d+\s*[/|\\]\s*\d+|\d{3,5})(?=\s|$|[|•])/gi;

/**
 * Overall header primary variants:
 *  - "407 of 489 hours attended"
 *  - "407 0f 489 hrs"
 *  - "407 out of 489 hours"
 *  - "407/489 hrs" / "407 / 489 hours attended"
 */
const OVERALL_HOURS_RE =
  /\b(\d+)\s*(?:(?:of|0f|out\s*of)\s*(\d+)\s*(?:(?:hours?|hrs?)(?:\s+attended)?|attended)?|[/|\\]\s*(\d+)\s*(?:hours?|hrs?)(?:\s+attended)?)\b/i;

/** Fallback: "Overall Attendance 83% 407/489" or "Overall: 407 / 489". */
const OVERALL_FALLBACK_RE =
  /\boverall(?:\s+attendance)?[\s:|\\-]*(?:\d{1,3}\s*%\s*)?(\d+)\s*[/|\\]\s*(\d+)\b/i;

/** Stat patterns — Duty Leave matched first so it never collides with Leave. */
const DUTY_LEAVE_RE =
  /\bduty[\s\-]*leave\b[\s:.\-]*([\dOo]+)\b(?![\s]*[%\/])/i;
const LEAVE_RE =
  /\bleave\b[\s:.\-]*([\dOo]+)\b(?![\s]*[%\/])/i;
const MISSED_RE =
  /\bmissed\b[\s:.\-]*([\dOo]+)\b(?![\s]*[%\/])/i;

/** Attendance fraction X/Y (or X|Y or X\Y), avoiding DD/MM/YYYY dates. */
const FRACTION_RE =
  /(?<!\d\/\s*)(\d{1,3})\s*[/|\\]\s*(\d{1,3})(?!\s*\/\d)/g;

/** Partial fraction where numerator was garbled into letters/digits (e.g. `do/48`). */
const PARTIAL_DENOM_RE =
  /(?<!\d\/\s*)\b[a-zA-Z0-9]{1,3}\s*[/|\\]\s*(\d{2,3})\b(?!\s*\/\d)/g;

/** Displayed integer percentage e.g. "81%" or "81 %". */
const PERCENT_RE = /(?:^|[^\d.])(\d{1,3})\s*%/g;

/** Token candidate where a slash might have been misread as 1, 7, l, or I. */
const FUSED_CANDIDATE_RE = /\b\d[\d17lI]{2,6}\b/g;

// ---------------------------------------------------------------------------
// Course code normalization
// ---------------------------------------------------------------------------

const SUFFIX_DIGIT_MAP: Record<string, string> = {
  S: "5",
  s: "5",
  O: "0",
  o: "0",
  I: "1",
  l: "1",
  B: "8",
  Z: "2",
};

/**
 * Normalizes OCR-mangled KTU course codes into canonical uppercase codes.
 *
 * Examples:
 *  - `PCCATS02` → `PCCAT502`
 *  - `PCCSTS03` → `PCCST503`
 *  - `PBCATS04` → `PBCAT504`
 *  - `PEAITS23` → `PEAIT523`
 *  - `PCCALS007` → `PCCAL507` (5-letter prefix + doubled `00` → `0`)
 *  - `PLT-2O26` / `PLT 2026` / `PLT—2026` / `PLT2026` → `PLT-2026`
 */
export function normalizeCourseCode(rawCode: string): string {
  const trimmed = rawCode.trim().toUpperCase();

  if (/^PLT[-—–\s]?[2Z][0O]26$/.test(trimmed)) {
    return "PLT-2026";
  }

  // Handle doubled-zero suffixes on 5-letter prefixes (e.g. PCCALS007 -> PCCAL507)
  // before checking 6-letter+3-digit codes, since S looks like prefix letter 6.
  const doubledZeroMatch = /^([A-Z]{5})([0-9SOIlBZ]{4})$/.exec(trimmed);
  if (doubledZeroMatch && doubledZeroMatch[1] && doubledZeroMatch[2]) {
    const prefix = doubledZeroMatch[1];
    const mapped = doubledZeroMatch[2].replace(
      /[SOIlBZ]/g,
      (ch) => SUFFIX_DIGIT_MAP[ch] ?? ch
    );
    if (mapped.includes("00")) {
      return `${prefix}${mapped.replace(/00/, "0")}`;
    }
  }

  // Already has a clean 3-digit suffix (e.g. PCCST501, CS307)
  if (/^[A-Z]{2,6}\d{3}$/.test(trimmed)) {
    return trimmed;
  }

  // Non-greedy prefix (4–6 letters) so S/O/I/B/Z in the numeric suffix stays in suffix
  const stdMatch = /^([A-Z]{4,6}?)([0-9SOIlBZ]{3,4})$/.exec(trimmed);
  if (stdMatch && stdMatch[1] && stdMatch[2]) {
    const prefix = stdMatch[1];
    let suffix = stdMatch[2].replace(/[SOIlBZ]/g, (ch) => SUFFIX_DIGIT_MAP[ch] ?? ch);
    if (prefix.length === 5 && suffix.length === 4) {
      suffix = suffix.replace(/00/, "0");
    }
    return `${prefix}${suffix}`;
  }

  // General fallback matching /^([A-Z]{4,6})([A-Z0-9]{3,4})$/
  const broadMatch = /^([A-Z]{4,6}?)([A-Z0-9]{3,4})$/.exec(trimmed);
  if (broadMatch && broadMatch[1] && broadMatch[2]) {
    const prefix = broadMatch[1];
    let suffix = broadMatch[2].replace(/[SOoIlBZ]/g, (ch) => SUFFIX_DIGIT_MAP[ch] ?? ch);
    if (prefix.length === 5 && suffix.length === 4) {
      suffix = suffix.replace(/00/, "0");
    }
    return `${prefix}${suffix}`;
  }

  return trimmed;
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/**
 * Replaces `O`/`o` with `0` inside tokens that already contain at least one digit
 * (e.g. `4O7` → `407`), preserving length 1:1 and leaving normal words untouched.
 */
function normalizeNumericTokens(text: string): string {
  return text.replace(/\b[\dOo]+\b/g, (token) =>
    /\d/.test(token) ? token.replace(/[Oo]/g, "0") : token
  );
}

/** Converts an OCR number token ("15", "O", "o", "4O") into an integer. */
function parseOcrInt(token: string): number {
  return parseInt(token.replace(/[Oo]/g, "0"), 10);
}

/**
 * Extracts `overallHeader` and returns both the header and a copy of `text`
 * with the matched header phrase removed (length-preserving index math).
 */
function extractOverallHeader(text: string): {
  header: EtlabOverallHeader | null;
  remainingText: string;
} {
  const normalised = normalizeNumericTokens(text);

  const tryPrimary = (): { header: EtlabOverallHeader; remainingText: string } | null => {
    const m = OVERALL_HOURS_RE.exec(normalised);
    if (!m || !m[1]) return null;
    const totalGroup = m[2] ?? m[3];
    if (!totalGroup) return null;
    const attended = parseInt(m[1], 10);
    const total = parseInt(totalGroup, 10);
    if (total > 0 && attended >= 0 && attended <= total) {
      return {
        header: { attended, total },
        remainingText:
          text.slice(0, m.index) + text.slice(m.index + m[0].length),
      };
    }
    return null;
  };

  const primary = tryPrimary();
  if (primary) return primary;

  const fm = OVERALL_FALLBACK_RE.exec(normalised);
  if (fm && fm[1] && fm[2]) {
    const attended = parseInt(fm[1], 10);
    const total = parseInt(fm[2], 10);
    if (total > 0 && attended >= 0 && attended <= total) {
      return {
        header: { attended, total },
        remainingText:
          text.slice(0, fm.index) + text.slice(fm.index + fm[0].length),
      };
    }
  }

  return { header: null, remainingText: text };
}

/** Strips Credit-wise blocks from a working copy so N/N isn't read as attendance. */
function stripCreditWise(text: string): string {
  return text.replace(CREDIT_WISE_STRIP_RE, " ");
}

/** Returns true if a line starts a card's metadata/stats section (not the title). */
function isMetadataLine(trimmedLine: string): boolean {
  if (
    /^(?:theory|practical|program\s+elective|open\s+elective|no\s+university\s+exam)(?:\s*(?:[|•\-]|credit[\s\-]*wise|\d+\s*%|\d+\s*[/|\\]\s*\d+|missed|leave|duty[\s\-]*leave).*)?$/i.test(
      trimmedLine
    )
  ) {
    return true;
  }
  if (/^(?:missed|leave|duty[\s\-]*leave|credit[\s\-]*wise)\b/i.test(trimmedLine)) {
    return true;
  }
  if (/^[\dOo]{1,3}\s*%/.test(trimmedLine)) return true;
  if (/^\d+\s*[/|\\]\s*\d+/.test(trimmedLine)) return true;
  return false;
}

/**
 * Strips inline badges, stats, percents, faculty icons/names (`® ...`),
 * trailing garbled fractions (`do/48`, `64/79`), and trailing `sus` noise
 * from a candidate subject name line without corrupting titles like
 * `THEORY OF COMPUTATION`.
 */
function stripInlineMetadata(line: string): string {
  let out = line;

  // Strip everything from faculty icon (®, ©, @) onward on the same line
  out = out.replace(/[®©@].*$/g, " ");

  // Strip Credit-wise, stats, percents, and fractions (including garbled `do/48`)
  out = out.replace(CREDIT_WISE_STRIP_RE, " ");
  out = out.replace(/\bduty[\s\-]*leave\b[\s:.\-]*(?:[\dOo]+)?\b/gi, " ");
  out = out.replace(/\b(?:missed|leave)\b[\s:.\-]*(?:[\dOo]+)?\b/gi, " ");
  out = out.replace(/\b[\dOo]{1,3}\s*%/g, " ");
  out = out.replace(/(?<!\d\/\s*)\b[a-zA-Z0-9]{1,3}\s*[/|\\]\s*\d{1,3}\b(?!\s*\/\d)/g, " ");
  out = out.replace(/[|•·]+/g, " ");

  // Iteratively strip leading course-type prefixes & leading separators
  let prev: string;
  do {
    prev = out;
    out = out.replace(/^[\s&\-:|]+/, "");
    out = out.replace(
      /^no\s+university\s+exam(?:\s+(?:and|&)\s+no\s+internal\s+exam)?(?:\b[\s&\-:|]*)?/i,
      ""
    );
    out = out.replace(/^(?:program|open)\s+elective(?:\b[\s&\-:|]*)?/i, "");
    // Strip "Theory" / "Practical" only when followed by separator (&, -, :, |),
    // alone on the line, OR Title-case badge before another title (not "THEORY OF ...")
    out = out.replace(/^(?:theory|practical)\s*[&\-:|]\s*/i, "");
    out = out.replace(/^(?:theory|practical)\s*$/i, "");
    out = out.replace(/^(?:Theory|Practical)\s+(?!(?:of|and|for)\b)/, "");
    out = out.replace(
      /\s{2,}(?:theory|practical|program\s+elective)\b/gi,
      " "
    );
  } while (out !== prev);

  // Strip trailing fraction noise or stray `sus` artifact
  out = out.replace(/\s+\bsus\b\s*$/i, "");
  out = out.replace(/^(?:\bsus\b\s*)$/i, "");

  out = out.replace(/^[\s\-:&|]+|[\s\-:&|]+$/g, "");
  out = out.replace(/\s+/g, " ").trim();
  return out;
}

/** Extracts the clean subject name from lines immediately following CODE (SLOT). */
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
    }
    const cleaned = stripInlineMetadata(trimmed);
    if (cleaned) {
      nameParts.push(cleaned);
    } else if (nameParts.length > 0) {
      break;
    }
  }

  const joined = nameParts
    .join(" ")
    .replace(/\s+\bsus\b\s*$/i, "")
    .replace(/\s+/g, " ")
    .trim();

  return joined.length > 0 ? joined : fallbackCode;
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
  if (/\b(?:missed|duty[\s\-]*leave)\b[\s:.\-]*(?:[\dOo]+)\b/i.test(withoutCredit)) {
    return true;
  }
  return false;
}

/** Integer-rounded percentage: Math.round((attended / total) * 100). */
function roundedPercent(attended: number, total: number): number {
  if (total === 0) return 0;
  return Math.floor((attended * 200 + total) / (2 * total));
}

/** Arithmetic integrity helper matching Step 2's checksum identity. */
function passesCardArithmetic(card: ParsedEtlabCard): boolean {
  return card.total - card.missed - card.leave - card.dutyLeave === card.attended;
}

/** Displayed percentage integrity helper. */
function passesCardPercent(card: ParsedEtlabCard): boolean {
  return roundedPercent(card.attended, card.total) === card.displayedPercent;
}

/** Picks the higher-quality card when the same code appears in multiple screenshots. */
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

  if (candidate.creditWise !== undefined && existing.creditWise === undefined) {
    return candidate;
  }
  if (existing.creditWise !== undefined && candidate.creditWise === undefined) {
    return existing;
  }
  if (candidate.name.length > existing.name.length) return candidate;
  return existing;
}

// ---------------------------------------------------------------------------
// Fraction recovery helpers
// ---------------------------------------------------------------------------

/**
 * Attempts to recover `attended/total` from a fused token where Tesseract
 * misread the slash `/` as `1`, `7`, `l`, or `I` (e.g. `64179` -> `64/79`).
 */
function recoverFusedFraction(
  statsText: string,
  missed: number,
  leave: number,
  dutyLeave: number,
  displayedPercent: number
): { attended: number; total: number } | null {
  const unattended = missed + leave + dutyLeave;
  let arithOnly: { attended: number; total: number } | null = null;
  let pctOnly: { attended: number; total: number } | null = null;

  FUSED_CANDIDATE_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = FUSED_CANDIDATE_RE.exec(statsText)) !== null) {
    const token = m[0];
    for (let splitIdx = 1; splitIdx < token.length - 1; splitIdx++) {
      const ch = token[splitIdx];
      if (ch !== "1" && ch !== "7" && ch !== "l" && ch !== "I") continue;

      const left = token.slice(0, splitIdx);
      const right = token.slice(splitIdx + 1);
      if (!/^\d+$/.test(left) || !/^\d+$/.test(right)) continue;

      const aa = parseInt(left, 10);
      const bb = parseInt(right, 10);
      if (bb <= 0 || aa < 0 || aa > bb) continue;

      const arithMatch = bb - unattended === aa;
      const pctMatch =
        displayedPercent >= 0 &&
        displayedPercent <= 100 &&
        roundedPercent(aa, bb) === displayedPercent;

      if (arithMatch && pctMatch) {
        return { attended: aa, total: bb };
      }
      if (arithMatch && (unattended > 0 || displayedPercent === 100) && !arithOnly) {
        arithOnly = { attended: aa, total: bb };
      }
      if (pctMatch && bb >= 5 && !pctOnly) {
        pctOnly = { attended: aa, total: bb };
      }
    }
  }

  return arithOnly ?? pctOnly;
}

/**
 * Recovers `attended/total` when the numerator was garbled into letters/noise
 * while the slash and denominator stayed intact (e.g. `do/48` with `Missed 2`
 * and `96%` → `46/48`).
 *
 * Excludes `10` when `Credit-wise` noise might have left `X / 10`.
 */
function recoverPartialDenominatorFraction(
  statsText: string,
  missed: number,
  leave: number,
  dutyLeave: number,
  displayedPercent: number
): { attended: number; total: number } | null {
  if (displayedPercent < 0 || displayedPercent > 100) return null;
  const unattended = missed + leave + dutyLeave;

  PARTIAL_DENOM_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = PARTIAL_DENOM_RE.exec(statsText)) !== null) {
    const y = parseInt(m[1] ?? "0", 10);
    if (y === 10 || y <= unattended) continue;

    const candidateAttended = y - unattended;
    if (roundedPercent(candidateAttended, y) === displayedPercent) {
      return { attended: candidateAttended, total: y };
    }
  }

  return null;
}

/**
 * Recovers `attended/total` purely from `Missed + Leave + DutyLeave` and `P%`
 * when the fraction `X/Y` inside the colored pill was completely missed by OCR.
 */
function recoverFractionFromMissedAndPercent(
  missed: number,
  leave: number,
  dutyLeave: number,
  displayedPercent: number
): { attended: number; total: number } | null {
  if (displayedPercent < 0 || displayedPercent >= 100) return null;

  const unattended = missed + leave + dutyLeave;
  if (unattended <= 0) return null;

  const denominator = 100 - displayedPercent;
  const estimatedTotal = Math.round((unattended * 100) / denominator);
  const maxDelta = Math.max(5, Math.ceil(estimatedTotal * 0.05));

  for (let delta = 0; delta <= maxDelta; delta++) {
    const offsets = delta === 0 ? [0] : [delta, -delta];
    for (const offset of offsets) {
      const candidateTotal = estimatedTotal + offset;
      if (candidateTotal <= 0 || candidateTotal < unattended) continue;
      const candidateAttended = candidateTotal - unattended;
      if (candidateAttended < 0) continue;
      if (roundedPercent(candidateAttended, candidateTotal) === displayedPercent) {
        return { attended: candidateAttended, total: candidateTotal };
      }
    }
  }

  return null;
}

// ---------------------------------------------------------------------------
// Code+Slot extraction helper
// ---------------------------------------------------------------------------

interface CodeSlotMatch {
  index: number;
  endIndex: number;
  code: string;
  slotLetter: string;
}

function overlapsExisting(
  matches: CodeSlotMatch[],
  index: number,
  endIndex: number
): boolean {
  return matches.some(
    (m) => Math.max(m.index, index) < Math.min(m.endIndex, endIndex)
  );
}

/**
 * Finds all course-code + slot-letter headers in `text`, normalizing OCR-mangled
 * course codes (`PCCATS02`→`PCCAT502`, `PCCALS007`→`PCCAL507`, `PLT-2O26 (2)`→`PLT-2026 (Z)`)
 * and handling mangled slot parentheses or dropped slots.
 */
function extractCodeSlotMatches(text: string): CodeSlotMatch[] {
  const matches: CodeSlotMatch[] = [];

  // 1. Dedicated PLT-2026 matcher first (handles spaces/em-dash/O-for-0/slot 2-for-Z)
  PLT_CODE_SLOT_RE.lastIndex = 0;
  let pm: RegExpExecArray | null;
  while ((pm = PLT_CODE_SLOT_RE.exec(text)) !== null) {
    const rawSlot = pm[2] ?? pm[3] ?? pm[4] ?? pm[5] ?? pm[6] ?? "";
    const slotLetter = rawSlot === "2" ? "Z" : rawSlot;
    matches.push({
      index: pm.index,
      endIndex: pm.index + pm[0].length,
      code: "PLT-2026",
      slotLetter,
    });
  }

  // 2. Standard KTU code + slot match
  CODE_WITH_SLOT_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = CODE_WITH_SLOT_RE.exec(text)) !== null) {
    const rawCode = m[1];
    const slotLetter = m[2] ?? m[3] ?? m[4] ?? m[5] ?? m[6];
    if (!rawCode || !slotLetter) continue;

    const endIndex = m.index + m[0].length;
    if (overlapsExisting(matches, m.index, endIndex)) continue;

    matches.push({
      index: m.index,
      endIndex,
      code: normalizeCourseCode(rawCode),
      slotLetter,
    });
  }

  // 3. Fallback for codes at line start whose "(A)" slot was completely dropped
  CODE_NO_SLOT_RE.lastIndex = 0;
  let nm: RegExpExecArray | null;
  while ((nm = CODE_NO_SLOT_RE.exec(text)) !== null) {
    const rawCode = nm[1];
    if (!rawCode || rawCode.length < 5) continue;

    const codeOffset = nm[0].indexOf(rawCode);
    const codeIndex = nm.index + codeOffset;
    const codeEnd = codeIndex + rawCode.length;

    if (!overlapsExisting(matches, codeIndex, codeEnd)) {
      matches.push({
        index: codeIndex,
        endIndex: codeEnd,
        code: normalizeCourseCode(rawCode),
        slotLetter: "",
      });
    }
  }

  matches.sort((a, b) => a.index - b.index);
  return matches;
}

// ---------------------------------------------------------------------------
// Public functions
// ---------------------------------------------------------------------------

/**
 * Parses raw OCR text from a single ETLAB "By Course" screenshot.
 *
 * Resilient to noisy spacing, OCR digit/letter confusion in course codes,
 * mangled parens, fused fractions (`64179`), garbled numerators (`do/48`),
 * missing fractions (recovered from `Missed + %`), and merged faculty rows.
 */
export function parseSingleEtlabOcrText(rawText: string): SingleOcrParseResult {
  const normalized = rawText.replace(/\r\n?/g, "\n");
  const warnings: string[] = [];

  const { header: overallHeader, remainingText } = extractOverallHeader(normalized);
  const matches = extractCodeSlotMatches(remainingText);

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
    CREDIT_WISE_CAPTURE_RE.lastIndex = 0;
    const creditMatch = CREDIT_WISE_CAPTURE_RE.exec(bodyAfterCode);
    const creditWise =
      creditMatch && creditMatch[1] && creditMatch[2]
        ? `${creditMatch[1]} / ${creditMatch[2]}`
        : undefined;

    const withoutCredit = stripCreditWise(bodyAfterCode);

    // 2. Extract Duty Leave, Leave, Missed (Duty Leave first)
    let workingForStats = withoutCredit;

    const dlMatch = DUTY_LEAVE_RE.exec(workingForStats);
    const dutyLeave = dlMatch && dlMatch[1] ? parseOcrInt(dlMatch[1]) : 0;
    if (dlMatch) {
      workingForStats =
        workingForStats.slice(0, dlMatch.index) +
        " " +
        workingForStats.slice(dlMatch.index + dlMatch[0].length);
    }

    const leaveMatch = LEAVE_RE.exec(workingForStats);
    const leave = leaveMatch && leaveMatch[1] ? parseOcrInt(leaveMatch[1]) : 0;
    if (leaveMatch) {
      workingForStats =
        workingForStats.slice(0, leaveMatch.index) +
        " " +
        workingForStats.slice(leaveMatch.index + leaveMatch[0].length);
    }

    const missedMatch = MISSED_RE.exec(workingForStats);
    const missed = missedMatch && missedMatch[1] ? parseOcrInt(missedMatch[1]) : 0;
    if (missedMatch) {
      workingForStats =
        workingForStats.slice(0, missedMatch.index) +
        " " +
        workingForStats.slice(missedMatch.index + missedMatch[0].length);
    }

    const statsText = normalizeNumericTokens(workingForStats);
    const unattended = missed + leave + dutyLeave;

    // 3. Extract displayed percentage (0..100)
    PERCENT_RE.lastIndex = 0;
    let displayedPercent = -1;
    let pctMatch: RegExpExecArray | null;
    while ((pctMatch = PERCENT_RE.exec(statsText)) !== null) {
      const p = parseInt(pctMatch[1] ?? "", 10);
      if (p >= 0 && p <= 100) {
        displayedPercent = p;
        break;
      }
    }

    // 4. Collect standard fractions X/Y; prefer arithmetically / %-consistent one
    FRACTION_RE.lastIndex = 0;
    const fractionCandidates: Array<{ attended: number; total: number }> = [];
    let fracMatch: RegExpExecArray | null;
    while ((fracMatch = FRACTION_RE.exec(statsText)) !== null) {
      const a = parseInt(fracMatch[1] ?? "", 10);
      const t = parseInt(fracMatch[2] ?? "", 10);
      if (Number.isInteger(a) && Number.isInteger(t) && (t > 0 || a === 0) && a <= t) {
        fractionCandidates.push({ attended: a, total: t });
      }
    }

    let attended: number | null = null;
    let total: number | null = null;

    if (fractionCandidates.length > 0) {
      const bothOk = fractionCandidates.find(
        (c) =>
          c.total - unattended === c.attended &&
          displayedPercent >= 0 &&
          roundedPercent(c.attended, c.total) === displayedPercent
      );
      const arithOk = fractionCandidates.find(
        (c) => c.total - unattended === c.attended
      );
      const pctOk = fractionCandidates.find(
        (c) =>
          displayedPercent >= 0 &&
          roundedPercent(c.attended, c.total) === displayedPercent
      );
      const chosen = bothOk ?? arithOk ?? pctOk ?? fractionCandidates[0]!;
      attended = chosen.attended;
      total = chosen.total;
    }

    // 5. Fused-fraction recovery ("64179" -> "64/79")
    if (attended === null || total === null) {
      const recovered = recoverFusedFraction(
        statsText,
        missed,
        leave,
        dutyLeave,
        displayedPercent
      );
      if (recovered) {
        attended = recovered.attended;
        total = recovered.total;
        warnings.push(
          `Recovered fused fraction for ${current.code}: ${attended}/${total} (slash misread as digit).`
        );
      }
    }

    // 6. Partial denominator recovery ("do/48" + Missed 2 + 96% -> "46/48")
    if (attended === null || total === null) {
      const recovered = recoverPartialDenominatorFraction(
        statsText,
        missed,
        leave,
        dutyLeave,
        displayedPercent
      );
      if (recovered) {
        attended = recovered.attended;
        total = recovered.total;
        warnings.push(
          `Recovered fraction for ${current.code} from partial denominator: ${attended}/${total}.`
        );
      }
    }

    // 7. Missing-fraction recovery from Missed + Percent
    if (attended === null || total === null) {
      const recovered = recoverFractionFromMissedAndPercent(
        missed,
        leave,
        dutyLeave,
        displayedPercent
      );
      if (recovered) {
        attended = recovered.attended;
        total = recovered.total;
        warnings.push(
          `Recovered fraction for ${current.code} from Missed+Percent: ${attended}/${total}.`
        );
      }
    }

    if (attended === null || total === null) {
      const slotDesc = current.slotLetter ? ` (${current.slotLetter})` : "";
      warnings.push(
        `Ignored partial card for ${current.code}${slotDesc}: missing valid attended/total fraction.`
      );
      continue;
    }

    // 8. Extract cleaned subject name and determine kind / hoursPerSession
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
 * - Returns `rawTexts` so the UI can show a debug view.
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
    rawTexts,
  };
}
