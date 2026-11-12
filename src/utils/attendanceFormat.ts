/**
 * Display-only attendance formatting helpers.
 * Never used for 75% safety logic (which always uses Step 1 integer math).
 */

export type SafetyTone = "safe" | "careful" | "red";

/** Formats attended/total as a truncated 1-decimal percentage string (no rounding up). */
export function formatPctTruncated(attended: number, total: number): string {
  if (total <= 0) return "0.0";
  const thousandths = Math.floor((attended * 1000) / total);
  const whole = Math.floor(thousandths / 10);
  const frac = thousandths % 10;
  return `${whole}.${frac}`;
}

/** Returns CSS percentage width clamped to [0, 100] for progress bars. */
export function clampBarWidth(attended: number, total: number): number {
  if (total <= 0) return 0;
  return Math.max(0, Math.min(100, (attended * 100) / total));
}

/** Maps integer safe flag + skipBuffer into UI color tone. */
export function getSafetyTone(
  safe: boolean,
  buffer: number,
  total: number
): SafetyTone {
  if (!safe) return "red";
  if (total > 0 && buffer <= 2) return "careful";
  return "safe";
}

