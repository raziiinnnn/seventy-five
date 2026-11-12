/**
 * ScheduleView — Daily Attendance Logger, Calendar Overrides, and Weekly Timetable Editor (Step 7).
 *
 * Sub-tab 1: Daily Log & Calendar
 *  - Date Picker bar with Prev/Next arrows, date input, and day-type badge.
 *  - 1-Tap Day Overrides: Mark as Holiday (with optional reason), Clone Weekday Timetable, Reset.
 *  - Period Check-In List using `getScheduledPeriodsForDate` & `useLogsForDate`.
 *  - Recent Local Overlay Receipts list to inspect or clear local log dates.
 *
 * Sub-tab 2: Weekly Timetable
 *  - Mon–Sat pills, per-period subject `<select>` (`[slot] code — name`), hours (`1h..4h`),
 *    reorder up/down, delete, "+ Add Period" (defaults to `hoursPerSession`), and "Save Timetable".
 */

import { useState, useMemo, useEffect } from "react";
import {
  Calendar,
  CalendarDays,
  ChevronLeft,
  ChevronRight,
  CalendarOff,
  Copy,
  RotateCcw,
  Trash2,
  Plus,
  ArrowUp,
  ArrowDown,
  Save,
  Check,
  AlertTriangle,
  Clock,
  ReceiptText,
} from "lucide-react";
import {
  addDaysToDate,
  getWeekdayKey,
  isDefaultWorkingDay,
  getScheduledPeriodsForDate,
} from "@/engine/calendar";
import type {
  CalendarOverride,
  PeriodEvent,
  ScheduledPeriod,
  Weekday,
} from "@/engine/types2";
import {
  useSubjects,
  useTimetable,
  useCalendarOverrides,
  useLogsForDate,
  useDailyLogs,
  useAppCatchUpQueue,
} from "@/hooks/useAttendanceStore";
import {
  saveDayAttendanceLogs,
  clearDayAttendanceLogs,
  setDateOverride,
  saveWeekdayTimetable,
} from "@/db/logActions";
import {
  formatDateWithWeekday,
  WEEKDAY_SHORT_LABELS,
} from "@/utils/attendanceFormat";
import { PeriodStatusPills } from "@/components/PeriodStatusPills";

interface ScheduleViewProps {
  todayDate: string;
  onOpenCatchUp?: () => void;
}

const CLONE_WEEKDAYS: Weekday[] = ["mon", "tue", "wed", "thu", "fri"];
const ALL_WEEKDAYS: Weekday[] = ["mon", "tue", "wed", "thu", "fri", "sat"];
const HOUR_OPTIONS = [1, 2, 3, 4] as const;

export function ScheduleView({ todayDate, onOpenCatchUp }: ScheduleViewProps) {
  const subjects = useSubjects();
  const timetable = useTimetable();
  const overrides = useCalendarOverrides();
  const allLogs = useDailyLogs();
  const catchUpQueue = useAppCatchUpQueue(todayDate);

  const [subTab, setSubTab] = useState<"daily" | "timetable">("daily");
  const [selectedDate, setSelectedDate] = useState<string>(todayDate);
  const existingLogs = useLogsForDate(selectedDate);

  // Holiday reason + daily log draft state
  const [holidayReason, setHolidayReason] = useState("Holiday");
  const [draftStatuses, setDraftStatuses] = useState<Record<number, PeriodEvent>>({});
  const [dailySaving, setDailySaving] = useState(false);
  const [dailyNotice, setDailyNotice] = useState<{
    kind: "ok" | "error";
    msg: string;
  } | null>(null);

  // Weekly timetable editor state
  const [selectedWeekday, setSelectedWeekday] = useState<Weekday>(() => {
    const k = getWeekdayKey(todayDate);
    return k === "sun" ? "mon" : k;
  });
  const [draftPeriods, setDraftPeriods] = useState<ScheduledPeriod[]>([]);
  const [ttDirty, setTtDirty] = useState(false);
  const [ttSaving, setTtSaving] = useState(false);
  const [ttSavedBanner, setTtSavedBanner] = useState(false);

  // Subject lookup maps
  const { subjectById, subjectByCode } = useMemo(() => {
    const byId = new Map<string, NonNullable<typeof subjects>[number]>();
    const byCode = new Map<string, NonNullable<typeof subjects>[number]>();
    for (const s of subjects ?? []) {
      byId.set(s.id, s);
      byCode.set(s.code.toUpperCase(), s);
    }
    return { subjectById: byId, subjectByCode: byCode };
  }, [subjects]);

  function resolveSubject(rawId: string) {
    return subjectById.get(rawId) ?? subjectByCode.get(rawId.toUpperCase());
  }

  // Scheduled periods for selectedDate
  const scheduledPeriods = useMemo<ScheduledPeriod[]>(() => {
    if (!timetable || !overrides) return [];
    return getScheduledPeriodsForDate(selectedDate, timetable, overrides);
  }, [selectedDate, timetable, overrides]);

  // Sync period check-in draft whenever date, scheduled periods, or DB logs change
  useEffect(() => {
    if (!existingLogs) return;
    const next: Record<number, PeriodEvent> = {};
    const usedLogIds = new Set<number>();

    scheduledPeriods.forEach((p, idx) => {
      const resolvedId = resolveSubject(p.subjectId)?.id ?? p.subjectId;
      const matched = existingLogs.find(
        (l, li) =>
          !usedLogIds.has(li) &&
          l.period === p.period &&
          (l.subjectId === resolvedId || l.subjectId === p.subjectId)
      );
      if (matched) {
        usedLogIds.add(existingLogs.indexOf(matched));
        next[idx] = matched.status;
      } else {
        const byPeriod = existingLogs.find(
          (l, li) => !usedLogIds.has(li) && l.period === p.period
        );
        if (byPeriod) {
          usedLogIds.add(existingLogs.indexOf(byPeriod));
          next[idx] = byPeriod.status;
        } else {
          next[idx] = "present";
        }
      }
    });

    setDraftStatuses(next);
  }, [selectedDate, existingLogs, scheduledPeriods]);

  // Sync holiday reason input if selectedDate has a holiday override
  const activeOverride: CalendarOverride | undefined = overrides?.[selectedDate];
  useEffect(() => {
    if (activeOverride?.kind === "holiday" && activeOverride.reason) {
      setHolidayReason(activeOverride.reason);
    } else {
      setHolidayReason("Holiday");
    }
    setDailyNotice(null);
  }, [selectedDate, activeOverride]);

  // Sync timetable draft when switching weekday or when DB loads initially
  useEffect(() => {
    if (!timetable) return;
    const rows = timetable[selectedWeekday] ?? [];
    setDraftPeriods(rows.map((p) => ({ ...p })));
    setTtDirty(false);
    setTtSavedBanner(false);
  }, [selectedWeekday, timetable]);

  // Group non-retired local overlay logs by date (newest first)
  const receiptDates = useMemo(() => {
    if (!allLogs || !subjects) return [];
    const asOfBySubject = new Map(subjects.map((s) => [s.id, s.asOfDate]));

    const grouped = new Map<
      string,
      {
        date: string;
        present: number;
        absent: number;
        dl: number;
        cancelled: number;
        isActiveOverlay: boolean;
      }
    >();

    for (const log of allLogs) {
      const entry = grouped.get(log.date) ?? {
        date: log.date,
        present: 0,
        absent: 0,
        dl: 0,
        cancelled: 0,
        isActiveOverlay: false,
      };
      entry[log.status] += log.hours;
      const anchorDate = asOfBySubject.get(log.subjectId);
      if (anchorDate && log.date > anchorDate) {
        entry.isActiveOverlay = true;
      }
      grouped.set(log.date, entry);
    }

    return Array.from(grouped.values()).sort((a, b) =>
      b.date.localeCompare(a.date)
    );
  }, [allLogs, subjects]);

  if (!subjects || !timetable || !overrides) {
    return (
      <div className="space-y-3 py-6">
        <div className="h-24 rounded-2xl bg-gray-900 animate-pulse" />
        <div className="h-44 rounded-2xl bg-gray-900 animate-pulse" />
      </div>
    );
  }

  // ---------------------------------------------------------------------------
  // Day classification badge
  // ---------------------------------------------------------------------------
  function getDayTypeBadge(): { label: string; cls: string } {
    if (activeOverride) {
      if (activeOverride.kind === "holiday") {
        return {
          label: activeOverride.reason
            ? `Holiday (${activeOverride.reason})`
            : "Holiday Override",
          cls: "bg-amber-500/15 text-amber-300 border-amber-500/30",
        };
      }
      if (activeOverride.kind === "follow_weekday") {
        return {
          label: `Cloned ${WEEKDAY_SHORT_LABELS[activeOverride.weekday]}`,
          cls: "bg-indigo-500/15 text-indigo-300 border-indigo-500/30",
        };
      }
      return {
        label: "Custom Override",
        cls: "bg-purple-500/15 text-purple-300 border-purple-500/30",
      };
    }

    const wd = getWeekdayKey(selectedDate);
    if (wd === "sun") {
      return {
        label: "Sunday (Holiday)",
        cls: "bg-gray-800 text-gray-400 border-gray-700",
      };
    }
    if (wd === "sat") {
      const working = isDefaultWorkingDay(selectedDate);
      return working
        ? {
            label: "Working Saturday",
            cls: "bg-emerald-500/15 text-emerald-300 border-emerald-500/30",
          }
        : {
            label: "2nd/4th Saturday Holiday",
            cls: "bg-gray-800 text-gray-400 border-gray-700",
          };
    }
    return {
      label: "Default Working Day",
      cls: "bg-emerald-500/15 text-emerald-300 border-emerald-500/30",
    };
  }

  // ---------------------------------------------------------------------------
  // Daily Log & Override handlers
  // ---------------------------------------------------------------------------
  async function handleSaveDayLogs(overrideAll?: PeriodEvent) {
    if (scheduledPeriods.length === 0 || dailySaving) return;
    setDailySaving(true);
    setDailyNotice(null);
    try {
      const entries = scheduledPeriods.map((p, idx) => {
        const resolved = resolveSubject(p.subjectId);
        return {
          period: p.period,
          subjectId: resolved?.id ?? p.subjectId,
          hours: p.hours,
          status: overrideAll ?? draftStatuses[idx] ?? "present",
        };
      });
      await saveDayAttendanceLogs(selectedDate, entries);
      setDailyNotice({
        kind: "ok",
        msg: `Saved attendance log for ${formatDateWithWeekday(selectedDate)}.`,
      });
    } catch (err) {
      setDailyNotice({
        kind: "error",
        msg: err instanceof Error ? err.message : "Failed to save log.",
      });
    } finally {
      setDailySaving(false);
    }
  }

  async function handleClearDayLogs(targetDate = selectedDate) {
    if (dailySaving) return;
    setDailySaving(true);
    setDailyNotice(null);
    try {
      await clearDayAttendanceLogs(targetDate);
      setDailyNotice({
        kind: "ok",
        msg: `Cleared local log for ${formatDateWithWeekday(targetDate)}.`,
      });
    } catch (err) {
      setDailyNotice({
        kind: "error",
        msg: err instanceof Error ? err.message : "Failed to clear log.",
      });
    } finally {
      setDailySaving(false);
    }
  }

  async function handleToggleHoliday() {
    if (dailySaving) return;
    setDailySaving(true);
    setDailyNotice(null);
    try {
      if (activeOverride?.kind === "holiday") {
        await setDateOverride(selectedDate, null);
        setDailyNotice({
          kind: "ok",
          msg: `Removed holiday override for ${formatDateWithWeekday(selectedDate)}.`,
        });
      } else {
        const reason = holidayReason.trim() || "Holiday";
        await setDateOverride(selectedDate, { kind: "holiday", reason });
        setDailyNotice({
          kind: "ok",
          msg: `Marked ${formatDateWithWeekday(selectedDate)} as ${reason}.`,
        });
      }
    } catch (err) {
      setDailyNotice({
        kind: "error",
        msg: err instanceof Error ? err.message : "Failed to update override.",
      });
    } finally {
      setDailySaving(false);
    }
  }

  async function handleCloneWeekday(weekday: Weekday) {
    if (dailySaving) return;
    setDailySaving(true);
    setDailyNotice(null);
    try {
      await setDateOverride(selectedDate, { kind: "follow_weekday", weekday });
      setDailyNotice({
        kind: "ok",
        msg: `${formatDateWithWeekday(selectedDate)} now follows ${WEEKDAY_SHORT_LABELS[weekday]} timetable.`,
      });
    } catch (err) {
      setDailyNotice({
        kind: "error",
        msg: err instanceof Error ? err.message : "Failed to clone weekday.",
      });
    } finally {
      setDailySaving(false);
    }
  }

  async function handleResetOverride() {
    if (dailySaving) return;
    setDailySaving(true);
    setDailyNotice(null);
    try {
      await setDateOverride(selectedDate, null);
      setDailyNotice({
        kind: "ok",
        msg: `Reset ${formatDateWithWeekday(selectedDate)} to default calendar.`,
      });
    } catch (err) {
      setDailyNotice({
        kind: "error",
        msg: err instanceof Error ? err.message : "Failed to reset override.",
      });
    } finally {
      setDailySaving(false);
    }
  }

  // ---------------------------------------------------------------------------
  // Weekly Timetable handlers
  // ---------------------------------------------------------------------------
  function handleSubjectChange(idx: number, newSubjectId: string) {
    const subj = resolveSubject(newSubjectId);
    setDraftPeriods((prev) =>
      prev.map((p, i) =>
        i === idx
          ? {
              ...p,
              subjectId: newSubjectId,
              hours: subj ? Math.max(1, subj.hoursPerSession) : p.hours,
            }
          : p
      )
    );
    setTtDirty(true);
    setTtSavedBanner(false);
  }

  function handleHoursChange(idx: number, hours: number) {
    setDraftPeriods((prev) =>
      prev.map((p, i) => (i === idx ? { ...p, hours } : p))
    );
    setTtDirty(true);
    setTtSavedBanner(false);
  }

  function handleMovePeriod(idx: number, direction: -1 | 1) {
    const target = idx + direction;
    if (target < 0 || target >= draftPeriods.length) return;
    setDraftPeriods((prev) => {
      const next = prev.map((p) => ({ ...p }));
      const a = next[idx];
      const b = next[target];
      if (!a || !b) return prev;
      next[idx] = b;
      next[target] = a;
      return next.map((p, i) => ({ ...p, period: i + 1 }));
    });
    setTtDirty(true);
    setTtSavedBanner(false);
  }

  function handleDeletePeriod(idx: number) {
    setDraftPeriods((prev) =>
      prev
        .filter((_, i) => i !== idx)
        .map((p, i) => ({ ...p, period: i + 1 }))
    );
    setTtDirty(true);
    setTtSavedBanner(false);
  }

  function handleAddPeriod() {
    const firstSubject = subjects?.[0];
    if (!firstSubject) return;
    setDraftPeriods((prev) => [
      ...prev,
      {
        period: prev.length + 1,
        subjectId: firstSubject.id,
        hours: Math.max(1, firstSubject.hoursPerSession),
      },
    ]);
    setTtDirty(true);
    setTtSavedBanner(false);
  }

  async function handleSaveTimetable() {
    if (ttSaving) return;
    setTtSaving(true);
    try {
      await saveWeekdayTimetable(selectedWeekday, draftPeriods);
      setTtDirty(false);
      setTtSavedBanner(true);
    } finally {
      setTtSaving(false);
    }
  }

  const dayBadge = getDayTypeBadge();
  const isLoggedDate = (existingLogs?.length ?? 0) > 0;

  return (
    <div className="space-y-4">
      {/* Sub-tab Switcher */}
      <div className="grid grid-cols-2 gap-1.5 bg-gray-900 p-1 rounded-xl border border-gray-800/80">
        <button
          type="button"
          onClick={() => setSubTab("daily")}
          className={`flex items-center justify-center gap-1.5 py-2 px-3 rounded-lg text-xs font-semibold transition ${
            subTab === "daily"
              ? "bg-indigo-600 text-white shadow-sm"
              : "text-gray-400 hover:text-gray-200"
          }`}
        >
          <Calendar className="w-3.5 h-3.5 shrink-0" />
          Daily Log &amp; Calendar
        </button>
        <button
          type="button"
          onClick={() => setSubTab("timetable")}
          className={`flex items-center justify-center gap-1.5 py-2 px-3 rounded-lg text-xs font-semibold transition ${
            subTab === "timetable"
              ? "bg-indigo-600 text-white shadow-sm"
              : "text-gray-400 hover:text-gray-200"
          }`}
        >
          <CalendarDays className="w-3.5 h-3.5 shrink-0" />
          Weekly Timetable
        </button>
      </div>

      {/* ====================================================================
          SUB-TAB 1: DAILY LOG & CALENDAR
      ==================================================================== */}
      {subTab === "daily" && (
        <div className="space-y-4">
          {/* Quick Catch-Up Link when days are pending */}
          {catchUpQueue && catchUpQueue.length > 0 && onOpenCatchUp && (
            <button
              type="button"
              onClick={onOpenCatchUp}
              className="w-full flex items-center justify-between gap-2 px-3.5 py-2.5 bg-amber-950/40 hover:bg-amber-950/60 border border-amber-500/30 rounded-xl text-amber-200 text-xs transition"
            >
              <span className="flex items-center gap-2 text-left">
                <AlertTriangle className="w-4 h-4 text-amber-400 shrink-0" />
                <span>
                  <strong>{catchUpQueue.length}</strong> unlogged{" "}
                  {catchUpQueue.length === 1 ? "day" : "days"} in Catch-Up Queue
                </span>
              </span>
              <span className="font-semibold text-amber-300 whitespace-nowrap shrink-0">
                Open Queue →
              </span>
            </button>
          )}

          {/* Date Picker Bar */}
          <section className="bg-gray-900 border border-gray-800/80 rounded-2xl p-3.5 space-y-2.5">
            <div className="flex items-center justify-between gap-2">
              <button
                type="button"
                aria-label="Previous day"
                onClick={() => setSelectedDate(addDaysToDate(selectedDate, -1))}
                className="p-2 rounded-xl bg-gray-800 hover:bg-gray-700 text-gray-300 transition"
              >
                <ChevronLeft className="w-4 h-4" />
              </button>

              <div className="flex-1 flex flex-col items-center gap-1 min-w-0">
                <input
                  type="date"
                  aria-label="Select log date"
                  value={selectedDate}
                  onChange={(e) => {
                    if (/^\d{4}-\d{2}-\d{2}$/.test(e.target.value)) {
                      setSelectedDate(e.target.value);
                    }
                  }}
                  className="bg-gray-800 border border-gray-700 text-white text-xs font-semibold rounded-lg px-2.5 py-1.5 focus:outline-none focus:ring-1 focus:ring-indigo-500"
                />
                <div className="flex items-center gap-1.5 flex-wrap justify-center">
                  <span className="text-[11px] font-medium text-gray-300">
                    {formatDateWithWeekday(selectedDate)}
                    {selectedDate === todayDate ? " · Today" : ""}
                  </span>
                  <span
                    className={`text-[10px] font-semibold px-2 py-0.5 rounded-full border ${dayBadge.cls}`}
                  >
                    {dayBadge.label}
                  </span>
                </div>
              </div>

              <button
                type="button"
                aria-label="Next day"
                onClick={() => setSelectedDate(addDaysToDate(selectedDate, 1))}
                className="p-2 rounded-xl bg-gray-800 hover:bg-gray-700 text-gray-300 transition"
              >
                <ChevronRight className="w-4 h-4" />
              </button>
            </div>
          </section>

          {/* 1-Tap Day Override Controls */}
          <section className="bg-gray-900 border border-gray-800/80 rounded-2xl p-3.5 space-y-3">
            <div className="flex items-center justify-between gap-2">
              <h3 className="text-[11px] font-semibold uppercase tracking-wider text-gray-400">
                Day Calendar Override
              </h3>
              {activeOverride && (
                <button
                  type="button"
                  disabled={dailySaving}
                  onClick={handleResetOverride}
                  className="inline-flex items-center gap-1 text-[11px] text-gray-300 hover:text-white px-2 py-1 rounded-lg bg-gray-800 hover:bg-gray-700 transition"
                >
                  <RotateCcw className="w-3 h-3" />
                  Reset to Default
                </button>
              )}
            </div>

            {/* Holiday Toggle + Optional Reason */}
            <div className="flex items-center gap-2">
              <input
                type="text"
                placeholder="Reason (e.g. Rain Holiday, Strike)"
                value={holidayReason}
                onChange={(e) => setHolidayReason(e.target.value)}
                className="flex-1 min-w-0 bg-gray-950 border border-gray-800 rounded-xl px-3 py-2 text-xs text-gray-200 placeholder:text-gray-600 focus:outline-none focus:ring-1 focus:ring-indigo-500"
              />
              <button
                type="button"
                disabled={dailySaving}
                onClick={handleToggleHoliday}
                className={`inline-flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-semibold border whitespace-nowrap shrink-0 transition ${
                  activeOverride?.kind === "holiday"
                    ? "bg-amber-500/20 border-amber-400 text-amber-200"
                    : "bg-gray-800 hover:bg-gray-700 border-gray-700 text-gray-200"
                }`}
              >
                <CalendarOff className="w-3.5 h-3.5 shrink-0" />
                {activeOverride?.kind === "holiday"
                  ? "Unmark Holiday"
                  : "Mark as Holiday"}
              </button>
            </div>

            {/* Quick reason presets */}
            <div className="flex items-center gap-1.5 flex-wrap">
              {(["Holiday", "Rain Holiday", "Strike"] as const).map((preset) => (
                <button
                  key={preset}
                  type="button"
                  onClick={() => setHolidayReason(preset)}
                  className={`text-[10px] px-2 py-0.5 rounded-full border transition ${
                    holidayReason === preset
                      ? "bg-amber-500/15 border-amber-500/40 text-amber-300"
                      : "bg-gray-800/70 border-gray-800 text-gray-400 hover:text-gray-200"
                  }`}
                >
                  {preset}
                </button>
              ))}
            </div>

            {/* Clone Weekday Timetable */}
            <div className="space-y-1.5 pt-1 border-t border-gray-800/80">
              <p className="text-[11px] text-gray-400 flex items-center gap-1">
                <Copy className="w-3 h-3 text-indigo-400" />
                Clone Weekday Timetable (e.g. Working Saturday)
              </p>
              <div className="grid grid-cols-5 gap-1.5">
                {CLONE_WEEKDAYS.map((wd) => {
                  const isCloned =
                    activeOverride?.kind === "follow_weekday" &&
                    activeOverride.weekday === wd;
                  return (
                    <button
                      key={wd}
                      type="button"
                      disabled={dailySaving}
                      onClick={() => handleCloneWeekday(wd)}
                      className={`py-1.5 rounded-lg text-xs font-semibold border transition ${
                        isCloned
                          ? "bg-indigo-600 text-white border-indigo-400"
                          : "bg-gray-800/70 border-gray-800 text-gray-300 hover:border-gray-700"
                      }`}
                    >
                      {WEEKDAY_SHORT_LABELS[wd]}
                    </button>
                  );
                })}
              </div>
            </div>
          </section>

          {/* Status Feedback Banner */}
          {dailyNotice && (
            <div
              className={`flex items-center gap-2 px-3 py-2 rounded-xl text-xs border ${
                dailyNotice.kind === "ok"
                  ? "bg-emerald-950/50 border-emerald-500/30 text-emerald-200"
                  : "bg-rose-950/50 border-rose-500/30 text-rose-200"
              }`}
            >
              {dailyNotice.kind === "ok" ? (
                <Check className="w-4 h-4 text-emerald-400 shrink-0" />
              ) : (
                <AlertTriangle className="w-4 h-4 text-rose-400 shrink-0" />
              )}
              <span>{dailyNotice.msg}</span>
            </div>
          )}

          {/* Period Check-In List */}
          <section className="bg-gray-900 border border-gray-800/80 rounded-2xl p-3.5 space-y-3">
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <h3 className="text-xs font-semibold uppercase tracking-wider text-gray-300">
                  Classes on {formatDateWithWeekday(selectedDate)}
                </h3>
                <span
                  className={`text-[10px] font-semibold px-2 py-0.5 rounded-full border ${
                    isLoggedDate
                      ? "bg-emerald-500/15 text-emerald-300 border-emerald-500/30"
                      : "bg-gray-800 text-gray-400 border-gray-700"
                  }`}
                >
                  {isLoggedDate ? "Logged" : "Not logged"}
                </span>
              </div>

              {isLoggedDate && (
                <button
                  type="button"
                  disabled={dailySaving}
                  onClick={() => handleClearDayLogs(selectedDate)}
                  className="inline-flex items-center gap-1 text-[11px] text-rose-300 hover:text-rose-200 px-2 py-1 rounded-lg bg-rose-950/40 hover:bg-rose-950/70 border border-rose-500/25 transition"
                >
                  <Trash2 className="w-3 h-3" />
                  Clear Log
                </button>
              )}
            </div>

            {scheduledPeriods.length === 0 ? (
              <p className="text-xs text-gray-500 py-4 text-center bg-gray-950/50 rounded-xl border border-dashed border-gray-800">
                No scheduled periods on this date. Use &ldquo;Clone Weekday
                Timetable&rdquo; above if extra classes are held.
              </p>
            ) : (
              <>
                <div className="flex gap-2">
                  <button
                    type="button"
                    disabled={dailySaving}
                    onClick={() => handleSaveDayLogs("present")}
                    className="flex-1 py-1.5 px-2.5 rounded-xl bg-emerald-600/20 hover:bg-emerald-600/30 border border-emerald-500/35 text-emerald-200 text-xs font-semibold transition"
                  >
                    Quick: All Present
                  </button>
                  <button
                    type="button"
                    disabled={dailySaving}
                    onClick={() => handleSaveDayLogs("absent")}
                    className="flex-1 py-1.5 px-2.5 rounded-xl bg-rose-600/20 hover:bg-rose-600/30 border border-rose-500/35 text-rose-200 text-xs font-semibold transition"
                  >
                    Quick: All Absent
                  </button>
                </div>

                <div className="space-y-2">
                  {scheduledPeriods.map((p, idx) => {
                    const subj = resolveSubject(p.subjectId);
                    return (
                      <div
                        key={`${selectedDate}-${p.period}-${idx}`}
                        className="bg-gray-800/70 border border-gray-800 rounded-xl p-2.5 space-y-2"
                      >
                        <div className="flex items-center justify-between gap-2">
                          <div className="flex items-center gap-1.5 min-w-0">
                            <span className="font-mono text-[11px] font-bold text-gray-400 shrink-0">
                              P{p.period}
                            </span>
                            {subj?.slotLetter && (
                              <span className="inline-flex items-center justify-center min-w-[18px] h-4 px-1 rounded bg-indigo-500/20 text-indigo-300 border border-indigo-500/30 font-mono text-[10px] font-bold shrink-0">
                                {subj.slotLetter}
                              </span>
                            )}
                            <span className="text-xs font-semibold text-white truncate">
                              {subj?.name ?? p.subjectId}
                            </span>
                          </div>
                          <span className="text-[11px] font-mono text-gray-400 shrink-0">
                            {p.hours}h
                          </span>
                        </div>

                        <PeriodStatusPills
                          value={draftStatuses[idx] ?? "present"}
                          onChange={(status) =>
                            setDraftStatuses((prev) => ({ ...prev, [idx]: status }))
                          }
                          disabled={dailySaving}
                        />
                      </div>
                    );
                  })}
                </div>

                <button
                  type="button"
                  disabled={dailySaving}
                  onClick={() => handleSaveDayLogs()}
                  className="w-full py-2.5 rounded-xl bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-white text-xs font-semibold transition flex items-center justify-center gap-1.5"
                >
                  <Save className="w-3.5 h-3.5" />
                  {isLoggedDate ? "Update Day Log" : "Save Day Log"}
                </button>
              </>
            )}
          </section>

          {/* Recent Local Overlay Receipts List */}
          <section className="bg-gray-900 border border-gray-800/80 rounded-2xl p-3.5 space-y-2.5">
            <div className="flex items-center justify-between">
              <h3 className="text-xs font-semibold uppercase tracking-wider text-gray-300 flex items-center gap-1.5">
                <ReceiptText className="w-3.5 h-3.5 text-sky-400" />
                Recent Local Receipts ({receiptDates.length})
              </h3>
              <span className="text-[10px] text-gray-500">Tap date to edit</span>
            </div>

            {receiptDates.length === 0 ? (
              <p className="text-xs text-gray-500 py-2">
                No active local attendance logs yet.
              </p>
            ) : (
              <ul className="space-y-1.5">
                {receiptDates.map((item) => {
                  const parts: string[] = [];
                  if (item.present > 0) parts.push(`${item.present}h present`);
                  if (item.absent > 0) parts.push(`${item.absent}h absent`);
                  if (item.dl > 0) parts.push(`${item.dl}h DL`);
                  if (item.cancelled > 0) parts.push(`${item.cancelled}h cancelled`);

                  return (
                    <li
                      key={item.date}
                      className={`flex items-center justify-between gap-2 rounded-xl px-3 py-2 border transition ${
                        item.date === selectedDate
                          ? "bg-indigo-600/15 border-indigo-500/40"
                          : "bg-gray-800/50 border-gray-800"
                      }`}
                    >
                      <button
                        type="button"
                        onClick={() => setSelectedDate(item.date)}
                        className="flex-1 min-w-0 text-left"
                      >
                        <div className="flex items-center gap-1.5 flex-wrap">
                          <span className="text-xs font-semibold text-white">
                            {formatDateWithWeekday(item.date)}
                          </span>
                          <span className="text-[10px] font-mono text-gray-500">
                            {item.date}
                          </span>
                          {item.isActiveOverlay ? (
                            <span className="text-[10px] px-1.5 py-0.5 rounded bg-sky-500/15 text-sky-300 border border-sky-500/25">
                              Active overlay
                            </span>
                          ) : (
                            <span className="text-[10px] px-1.5 py-0.5 rounded bg-gray-800 text-gray-400">
                              On/before anchor
                            </span>
                          )}
                        </div>
                        <p className="text-[11px] text-gray-400 mt-0.5 truncate">
                          {parts.join(" · ") || "Logged"}
                        </p>
                      </button>

                      <button
                        type="button"
                        aria-label={`Delete logs for ${item.date}`}
                        disabled={dailySaving}
                        onClick={() => handleClearDayLogs(item.date)}
                        className="p-1.5 rounded-lg text-gray-500 hover:text-rose-400 hover:bg-gray-800 transition shrink-0"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}
          </section>
        </div>
      )}

      {/* ====================================================================
          SUB-TAB 2: WEEKLY TIMETABLE EDITOR
      ==================================================================== */}
      {subTab === "timetable" && (
        <div className="space-y-4">
          {/* Mon-Sat Day Selector */}
          <div className="grid grid-cols-6 gap-1.5">
            {ALL_WEEKDAYS.map((wd) => {
              const active = selectedWeekday === wd;
              const hrs = (timetable[wd] ?? []).reduce((s, p) => s + p.hours, 0);
              return (
                <button
                  key={wd}
                  type="button"
                  onClick={() => setSelectedWeekday(wd)}
                  className={`py-2 px-1 rounded-xl border text-center transition ${
                    active
                      ? "bg-indigo-600 text-white border-indigo-400"
                      : "bg-gray-900 text-gray-300 border-gray-800 hover:border-gray-700"
                  }`}
                >
                  <span className="block text-xs font-bold">
                    {WEEKDAY_SHORT_LABELS[wd]}
                  </span>
                  <span className="block text-[10px] opacity-75 tabular-nums">
                    {hrs}h
                  </span>
                </button>
              );
            })}
          </div>

          {/* Timetable Period Rows */}
          <section className="bg-gray-900 border border-gray-800/80 rounded-2xl p-3.5 space-y-3">
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <h3 className="text-xs font-semibold uppercase tracking-wider text-gray-300">
                  {WEEKDAY_SHORT_LABELS[selectedWeekday]} Schedule
                </h3>
                <span className="inline-flex items-center gap-1 text-[11px] text-gray-400 tabular-nums">
                  <Clock className="w-3 h-3" />
                  {draftPeriods.reduce((s, p) => s + p.hours, 0)}h total
                </span>
              </div>

              {ttDirty && (
                <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-amber-500/15 text-amber-300 border border-amber-500/30">
                  Unsaved
                </span>
              )}
              {ttSavedBanner && !ttDirty && (
                <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-emerald-500/15 text-emerald-300 border border-emerald-500/30">
                  Saved
                </span>
              )}
            </div>

            {draftPeriods.length === 0 ? (
              <p className="text-xs text-gray-500 py-4 text-center bg-gray-950/50 rounded-xl border border-dashed border-gray-800">
                No periods set for {WEEKDAY_SHORT_LABELS[selectedWeekday]}.
              </p>
            ) : (
              <div className="space-y-2">
                {draftPeriods.map((p, idx) => (
                  <div
                    key={`${selectedWeekday}-period-${idx}`}
                    className="bg-gray-800/70 border border-gray-800 rounded-xl p-2.5 space-y-2"
                  >
                    <div className="flex items-center gap-2">
                      <span className="font-mono text-xs font-bold text-indigo-300 w-6 shrink-0">
                        P{idx + 1}
                      </span>

                      <select
                        aria-label={`Period ${idx + 1} subject`}
                        value={resolveSubject(p.subjectId)?.id ?? p.subjectId}
                        onChange={(e) => handleSubjectChange(idx, e.target.value)}
                        className="flex-1 min-w-0 bg-gray-900 border border-gray-700 text-xs text-white rounded-lg px-2 py-1.5 focus:outline-none focus:ring-1 focus:ring-indigo-500"
                      >
                        {subjects.map((s) => (
                          <option key={s.id} value={s.id}>
                            {s.slotLetter ? `[${s.slotLetter}] ` : ""}
                            {s.code} — {s.name}
                          </option>
                        ))}
                      </select>

                      <select
                        aria-label={`Period ${idx + 1} hours`}
                        value={p.hours}
                        onChange={(e) =>
                          handleHoursChange(idx, parseInt(e.target.value, 10) || 1)
                        }
                        className="w-16 shrink-0 bg-gray-900 border border-gray-700 text-xs text-white rounded-lg px-1.5 py-1.5 focus:outline-none focus:ring-1 focus:ring-indigo-500"
                      >
                        {HOUR_OPTIONS.map((h) => (
                          <option key={h} value={h}>
                            {h}h
                          </option>
                        ))}
                      </select>
                    </div>

                    <div className="flex items-center justify-end gap-1.5">
                      <button
                        type="button"
                        aria-label={`Move period ${idx + 1} up`}
                        disabled={idx === 0}
                        onClick={() => handleMovePeriod(idx, -1)}
                        className="p-1.5 rounded-lg bg-gray-900/70 hover:bg-gray-700 disabled:opacity-30 text-gray-300 transition"
                      >
                        <ArrowUp className="w-3.5 h-3.5" />
                      </button>
                      <button
                        type="button"
                        aria-label={`Move period ${idx + 1} down`}
                        disabled={idx === draftPeriods.length - 1}
                        onClick={() => handleMovePeriod(idx, 1)}
                        className="p-1.5 rounded-lg bg-gray-900/70 hover:bg-gray-700 disabled:opacity-30 text-gray-300 transition"
                      >
                        <ArrowDown className="w-3.5 h-3.5" />
                      </button>
                      <button
                        type="button"
                        aria-label={`Delete period ${idx + 1}`}
                        onClick={() => handleDeletePeriod(idx)}
                        className="p-1.5 rounded-lg bg-gray-900/70 hover:bg-rose-950/70 text-gray-400 hover:text-rose-300 transition"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}

            <div className="flex gap-2 pt-1">
              <button
                type="button"
                disabled={subjects.length === 0}
                onClick={handleAddPeriod}
                className="flex-1 py-2.5 px-3 rounded-xl border border-dashed border-gray-700 hover:border-indigo-500 text-xs font-semibold text-gray-200 hover:text-indigo-300 transition flex items-center justify-center gap-1"
              >
                <Plus className="w-3.5 h-3.5" />
                Add Period
              </button>
              <button
                type="button"
                disabled={ttSaving}
                onClick={handleSaveTimetable}
                className="flex-1 py-2.5 px-3 rounded-xl bg-indigo-600 hover:bg-indigo-500 disabled:opacity-40 text-xs font-semibold text-white transition flex items-center justify-center gap-1.5"
              >
                <Save className="w-3.5 h-3.5" />
                {ttSaving ? "Saving…" : "Save Timetable"}
              </button>
            </div>
          </section>
        </div>
      )}
    </div>
  );
}

