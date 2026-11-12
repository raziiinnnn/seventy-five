/**
 * Display-only attendance and date formatting helpers.
 * Never used for 75% safety logic (which always uses Step 1 integer math).
 */

import { getWeekdayKey } from "@/engine/calendar";
import type { Weekday } from "@/engine/types2";

export type SafetyTone = "safe" | "careful" | "red";

const MONTH_NAMES = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec",
] as const;

export const WEEKDAY_SHORT_LABELS: Record<Weekday | "sun", string> = {
  sun: "Sun",
  mon: "Mon",
  tue: "Tue",
  wed: "Wed",
  thu: "Thu",
  fri: "Fri",
  sat: "Sat",
};

/** Formats `"YYYY-MM-DD"` as `"Thu, 12 Nov"` without JS Date timezone shifts. */
export function formatDateWithWeekday(dateStr: string): string {
  const monthIdx = parseInt(dateStr.slice(5, 7), 10) - 1;
  const day = parseInt(dateStr.slice(8, 10), 10);
  const weekday = WEEKDAY_SHORT_LABELS[getWeekdayKey(dateStr)];
  const month = MONTH_NAMES[monthIdx] ?? dateStr.slice(5, 7);
  return `${weekday}, ${day} ${month}`;
}

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

