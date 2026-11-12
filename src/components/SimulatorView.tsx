/**
 * SimulatorView — Interactive Leave Simulator ("Can I Skip?" + Weekly Habit) (Step 6).
 *
 * Sub-tab 1: Skip Upcoming Days
 *  - Builds next 14 days from `todayDate` via `getScheduledPeriodsForDate`.
 *  - Highlights top 3 safest upcoming days from `bestDaysToSkip`.
 *  - Multi-day picker + per-subject custom hours +/- stepper.
 *  - Live `simulateLeave` Verdict Card and Before -> After breakdown.
 *
 * Sub-tab 2: Weekly Habit Calculator
 *  - Weekday skip toggles (`Skip every Mon`..`Sat`) + per-subject weekly steppers.
 *  - Runs `whatIfWeekly` and shows full weeks before bottleneck drops below 75%.
 */

import { useState, useMemo } from "react";
import {
  CalendarDays,
  Repeat,
  CheckCircle2,
  AlertTriangle,
  Sparkles,
  RotateCcw,
  Plus,
  Minus,
} from "lucide-react";
import {
  isSafe,
  skipBuffer,
  recoveryNeeded,
  simulateLeave,
  bestDaysToSkip,
  whatIfWeekly,
} from "@/engine/attendance";
import type { UpcomingDay } from "@/engine/types";
import type { Weekday } from "@/engine/types2";
import {
  addDaysToDate,
  getWeekdayKey,
  getScheduledPeriodsForDate,
} from "@/engine/calendar";
import {
  useEffectiveSubjects,
  useTimetable,
  useCalendarOverrides,
} from "@/hooks/useAttendanceStore";
import { formatPctTruncated } from "@/utils/attendanceFormat";

// ---------------------------------------------------------------------------
// Formatting & Calendar Constants
// ---------------------------------------------------------------------------

interface SimulatorViewProps {
  todayDate: string;
}

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

const WEEKDAY_LABELS: Record<Weekday | "sun", string> = {
  sun: "Sun",
  mon: "Mon",
  tue: "Tue",
  wed: "Wed",
  thu: "Thu",
  fri: "Fri",
  sat: "Sat",
};

const WEEKDAY_KEYS: Weekday[] = ["mon", "tue", "wed", "thu", "fri", "sat"];

function formatShortDate(dateStr: string): string {
  const monthIdx = parseInt(dateStr.slice(5, 7), 10) - 1;
  const day = parseInt(dateStr.slice(8, 10), 10);
  return `${day} ${MONTH_NAMES[monthIdx] ?? dateStr.slice(5, 7)}`;
}

interface UpcomingWorkingDay {
  dateStr: string;
  weekdayLabel: string;
  shortDate: string;
  isToday: boolean;
  totalHours: number;
  day: UpcomingDay;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function SimulatorView({ todayDate }: SimulatorViewProps) {
  const subjects = useEffectiveSubjects();
  const timetable = useTimetable();
  const overrides = useCalendarOverrides();

  const [subTab, setSubTab] = useState<"days" | "weekly">("days");
  const [selectedDates, setSelectedDates] = useState<string[]>([]);
  const [customHours, setCustomHours] = useState<Record<string, number>>({});
  const [habitWeekdays, setHabitWeekdays] = useState<Weekday[]>([]);
  const [habitCustomHours, setHabitCustomHours] = useState<Record<string, number>>({});

  // Subject lookup maps (by id and fallback by code)
  const { subjectById, subjectByCode } = useMemo(() => {
    const byId = new Map<string, NonNullable<typeof subjects>[number]>();
    const byCode = new Map<string, NonNullable<typeof subjects>[number]>();
    for (const s of subjects ?? []) {
      byId.set(s.id, s);
      byCode.set(s.code.toUpperCase(), s);
    }
    return { subjectById: byId, subjectByCode: byCode };
  }, [subjects]);

  // Next 14 calendar days starting from todayDate -> working days with scheduled hours
  const workingDays = useMemo<UpcomingWorkingDay[]>(() => {
    if (!subjects || !timetable || !overrides) return [];

    const list: UpcomingWorkingDay[] = [];
    for (let offset = 0; offset < 14; offset++) {
      const dateStr = addDaysToDate(todayDate, offset);
      const periods = getScheduledPeriodsForDate(dateStr, timetable, overrides);
      if (periods.length === 0) continue;

      const missedHours: Record<string, number> = {};
      let totalHours = 0;

      for (const p of periods) {
        const resolvedId = subjectById.has(p.subjectId)
          ? p.subjectId
          : subjectByCode.get(p.subjectId.toUpperCase())?.id;
        if (!resolvedId) continue;

        missedHours[resolvedId] = (missedHours[resolvedId] ?? 0) + p.hours;
        totalHours += p.hours;
      }

      if (totalHours === 0) continue;

      const weekday = WEEKDAY_LABELS[getWeekdayKey(dateStr)];
      const shortDate = formatShortDate(dateStr);

      list.push({
        dateStr,
        weekdayLabel: weekday,
        shortDate,
        isToday: offset === 0,
        totalHours,
        day: {
          label: `${weekday}, ${shortDate} (${dateStr})`,
          missedHours,
        },
      });
    }
    return list;
  }, [subjects, timetable, overrides, todayDate, subjectById, subjectByCode]);

  const workingDayByLabel = useMemo(() => {
    const map = new Map<string, UpcomingWorkingDay>();
    for (const wd of workingDays) {
      map.set(wd.day.label, wd);
    }
    return map;
  }, [workingDays]);

  // Top 3 safest upcoming working days via Step 1's bestDaysToSkip
  const bestRankedDays = useMemo(() => {
    if (!subjects || workingDays.length === 0) return [];
    return bestDaysToSkip(
      subjects,
      workingDays.map((w) => w.day),
      3
    );
  }, [subjects, workingDays]);

  // Lowest-impact fallback days when at least one subject is already < 75%
  const zeroBottleneckImpactDays = useMemo(() => {
    if (!subjects || bestRankedDays.length > 0) return [];
    const unsafeIds = new Set(
      subjects.filter((s) => !isSafe(s.attended, s.total)).map((s) => s.id)
    );
    if (unsafeIds.size === 0) return [];

    return workingDays
      .filter((w) =>
        Object.entries(w.day.missedHours).every(
          ([sid, hrs]) => !unsafeIds.has(sid) || hrs === 0
        )
      )
      .slice(0, 3);
  }, [subjects, workingDays, bestRankedDays]);

  // Combined missed hours for selected days + custom per-subject adjustments
  const combinedMissedHours = useMemo(() => {
    const map: Record<string, number> = {};
    const selectedSet = new Set(selectedDates);

    for (const wd of workingDays) {
      if (!selectedSet.has(wd.dateStr)) continue;
      for (const [sid, hrs] of Object.entries(wd.day.missedHours)) {
        map[sid] = (map[sid] ?? 0) + hrs;
      }
    }

    for (const [sid, hrs] of Object.entries(customHours)) {
      if (hrs > 0) {
        map[sid] = (map[sid] ?? 0) + hrs;
      }
    }

    return map;
  }, [workingDays, selectedDates, customHours]);

  // Live simulateLeave verdict
  const leaveSimResult = useMemo(() => {
    if (!subjects) return null;
    return simulateLeave(subjects, combinedMissedHours);
  }, [subjects, combinedMissedHours]);

  // Weekly habit combined hours
  const weeklyMissedHours = useMemo(() => {
    const map: Record<string, number> = {};
    if (timetable) {
      for (const wd of habitWeekdays) {
        const periods = timetable[wd] ?? [];
        for (const p of periods) {
          const resolvedId = subjectById.has(p.subjectId)
            ? p.subjectId
            : subjectByCode.get(p.subjectId.toUpperCase())?.id;
          if (!resolvedId) continue;
          map[resolvedId] = (map[resolvedId] ?? 0) + p.hours;
        }
      }
    }
    for (const [sid, hrs] of Object.entries(habitCustomHours)) {
      if (hrs > 0) {
        map[sid] = (map[sid] ?? 0) + hrs;
      }
    }
    return map;
  }, [timetable, habitWeekdays, habitCustomHours, subjectById, subjectByCode]);

  const weeklyResult = useMemo(() => {
    if (!subjects) return null;
    return whatIfWeekly(subjects, weeklyMissedHours);
  }, [subjects, weeklyMissedHours]);

  if (!subjects || !timetable || !overrides || !leaveSimResult || !weeklyResult) {
    return (
      <div className="space-y-3 py-6">
        <div className="h-24 rounded-2xl bg-gray-900 animate-pulse" />
        <div className="h-44 rounded-2xl bg-gray-900 animate-pulse" />
      </div>
    );
  }

  // ---------------------------------------------------------------------------
  // Handlers
  // ---------------------------------------------------------------------------

  function toggleDate(dateStr: string) {
    setSelectedDates((prev) =>
      prev.includes(dateStr) ? prev.filter((d) => d !== dateStr) : [...prev, dateStr]
    );
  }

  function stepCustomHour(subjectId: string, delta: number) {
    setCustomHours((prev) => {
      const next = Math.max(0, (prev[subjectId] ?? 0) + delta);
      return { ...prev, [subjectId]: next };
    });
  }

  function resetSkipSimulation() {
    setSelectedDates([]);
    setCustomHours({});
  }

  function toggleHabitWeekday(wd: Weekday) {
    setHabitWeekdays((prev) =>
      prev.includes(wd) ? prev.filter((d) => d !== wd) : [...prev, wd]
    );
  }

  function stepHabitHour(subjectId: string, delta: number) {
    setHabitCustomHours((prev) => {
      const next = Math.max(0, (prev[subjectId] ?? 0) + delta);
      return { ...prev, [subjectId]: next };
    });
  }

  function resetWeeklyHabit() {
    setHabitWeekdays([]);
    setHabitCustomHours({});
  }

  // Derived UI summaries for Leave Simulation
  const totalSimulatedMissed = Object.values(combinedMissedHours).reduce(
    (sum, h) => sum + h,
    0
  );
  const overallBeforeAtt = subjects.reduce((s, x) => s + x.attended, 0);
  const overallBeforeTot = subjects.reduce((s, x) => s + x.total, 0);
  const overallBeforePct = formatPctTruncated(overallBeforeAtt, overallBeforeTot);
  const overallBeforeBuf = skipBuffer(overallBeforeAtt, overallBeforeTot);

  const failingSubjects = leaveSimResult.subjects
    .filter((r) => !r.safe)
    .map((r) => subjectById.get(r.subjectId)?.name ?? r.subjectId);

  const affectedSubjects = subjects.filter(
    (s) => (combinedMissedHours[s.id] ?? 0) > 0 || !isSafe(s.attended, s.total)
  );
  const simResultById = new Map(leaveSimResult.subjects.map((r) => [r.subjectId, r]));

  // Derived UI summaries for Weekly Habit
  const totalWeeklyMissed = Object.values(weeklyMissedHours).reduce(
    (sum, h) => sum + h,
    0
  );
  const bottleneckName =
    weeklyResult.failsAt === "overall"
      ? "Overall"
      : subjectById.get(weeklyResult.failsAt)?.name ?? weeklyResult.failsAt;

  return (
    <div className="space-y-4">
      {/* Sub-tab Switcher */}
      <div className="grid grid-cols-2 gap-1.5 bg-gray-900 p-1 rounded-xl border border-gray-800/80">
        <button
          type="button"
          onClick={() => setSubTab("days")}
          className={`flex items-center justify-center gap-1.5 py-2 px-3 rounded-lg text-xs font-semibold transition ${
            subTab === "days"
              ? "bg-indigo-600 text-white shadow-sm"
              : "text-gray-400 hover:text-gray-200"
          }`}
        >
          <CalendarDays className="w-3.5 h-3.5 shrink-0" />
          Skip Upcoming Days
        </button>
        <button
          type="button"
          onClick={() => setSubTab("weekly")}
          className={`flex items-center justify-center gap-1.5 py-2 px-3 rounded-lg text-xs font-semibold transition ${
            subTab === "weekly"
              ? "bg-indigo-600 text-white shadow-sm"
              : "text-gray-400 hover:text-gray-200"
          }`}
        >
          <Repeat className="w-3.5 h-3.5 shrink-0" />
          Weekly Habit
        </button>
      </div>

      {/* ====================================================================
          SECTION 1: SKIP UPCOMING DAYS
      ==================================================================== */}
      {subTab === "days" && (
        <div className="space-y-4">
          {/* Live simulateLeave Verdict Card */}
          <section
            className={`rounded-2xl p-4 border space-y-3 ${
              leaveSimResult.planOk
                ? "bg-emerald-950/35 border-emerald-500/35"
                : "bg-rose-950/35 border-rose-500/35"
            }`}
          >
            <div className="flex items-start justify-between gap-2">
              <div className="flex items-start gap-2.5">
                {leaveSimResult.planOk ? (
                  <CheckCircle2 className="w-5 h-5 text-emerald-400 shrink-0 mt-0.5" />
                ) : (
                  <AlertTriangle className="w-5 h-5 text-rose-400 shrink-0 mt-0.5" />
                )}
                <div>
                  <p
                    className={`text-sm font-bold ${
                      leaveSimResult.planOk ? "text-emerald-200" : "text-rose-200"
                    }`}
                  >
                    {leaveSimResult.planOk
                      ? "Plan is SAFE — All subjects stay >= 75%"
                      : `UNSAFE — ${
                          failingSubjects.length > 0
                            ? failingSubjects.join(", ")
                            : "Overall"
                        } drop below 75%`}
                  </p>
                  <p className="text-xs text-gray-300 mt-0.5 tabular-nums">
                    {totalSimulatedMissed > 0
                      ? `Simulating ${totalSimulatedMissed}h missed: Overall ${overallBeforePct}% (buf ${overallBeforeBuf}h) → ${leaveSimResult.overall.percentage}% (buf ${leaveSimResult.overall.buffer}h)`
                      : "Select upcoming working days or add custom hours to simulate taking leave."}
                  </p>
                </div>
              </div>

              {(selectedDates.length > 0 || totalSimulatedMissed > 0) && (
                <button
                  type="button"
                  onClick={resetSkipSimulation}
                  className="inline-flex items-center gap-1 text-[11px] px-2 py-1 rounded-lg bg-gray-900/70 hover:bg-gray-800 text-gray-300 shrink-0 transition"
                >
                  <RotateCcw className="w-3 h-3" />
                  Clear
                </button>
              )}
            </div>

            {/* Before -> After Table for affected subjects */}
            {affectedSubjects.length > 0 && (
              <div className="bg-gray-950/60 rounded-xl border border-gray-800/80 divide-y divide-gray-800/70">
                {affectedSubjects.map((s) => {
                  const missed = combinedMissedHours[s.id] ?? 0;
                  const after = simResultById.get(s.id);
                  if (!after) return null;

                  const beforePct = formatPctTruncated(s.attended, s.total);
                  const beforeSafe = isSafe(s.attended, s.total);
                  const beforeStatus = beforeSafe
                    ? `buf ${skipBuffer(s.attended, s.total)}h`
                    : `need ${recoveryNeeded(s.attended, s.total)}h`;
                  const afterStatus = after.safe
                    ? `buf ${after.buffer}h`
                    : `need ${recoveryNeeded(after.attended, after.total)}h`;

                  return (
                    <div
                      key={s.id}
                      className="flex items-center justify-between gap-2 px-3 py-2 text-xs"
                    >
                      <div className="min-w-0">
                        <p className="font-medium text-gray-200 truncate">{s.name}</p>
                        <p className="text-[11px] text-gray-500">
                          {s.code}
                          {missed > 0 ? ` · -${missed}h simulated` : " · already < 75%"}
                        </p>
                      </div>
                      <div className="text-right tabular-nums whitespace-nowrap shrink-0">
                        <span className="text-gray-400">
                          {beforePct}% ({beforeStatus})
                        </span>
                        <span className="mx-1 text-gray-600">→</span>
                        <span
                          className={`font-semibold ${
                            after.safe
                              ? after.status === "careful"
                                ? "text-amber-300"
                                : "text-emerald-300"
                              : "text-rose-300"
                          }`}
                        >
                          {after.percentage}% ({afterStatus})
                        </span>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </section>

          {/* Best Days to Skip Next (top 3 via bestDaysToSkip) */}
          <section className="bg-gray-900 border border-gray-800/80 rounded-2xl p-4 space-y-2.5">
            <div className="flex items-center justify-between">
              <h3 className="text-xs font-semibold uppercase tracking-wider text-gray-300 flex items-center gap-1.5">
                <Sparkles className="w-3.5 h-3.5 text-indigo-400" />
                Best Days to Skip Next
              </h3>
              <span className="text-[11px] text-gray-500">Next 14 days</span>
            </div>

            {bestRankedDays.length > 0 ? (
              <div className="space-y-2">
                {bestRankedDays.map((ranked, i) => {
                  const wd = workingDayByLabel.get(ranked.day.label);
                  const isSelected = wd ? selectedDates.includes(wd.dateStr) : false;

                  return (
                    <button
                      key={ranked.day.label}
                      type="button"
                      onClick={() => wd && toggleDate(wd.dateStr)}
                      className={`w-full text-left rounded-xl p-3 border transition ${
                        isSelected
                          ? "bg-indigo-600/20 border-indigo-400"
                          : "bg-gray-800/60 border-gray-800 hover:border-gray-700"
                      }`}
                    >
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-xs font-semibold text-white">
                          #{i + 1} · {wd ? `${wd.weekdayLabel}, ${wd.shortDate}` : ranked.day.label}
                        </span>
                        <span className="text-[11px] font-medium px-2 py-0.5 rounded-full bg-emerald-500/15 text-emerald-300 border border-emerald-500/25 whitespace-nowrap">
                          Safe · {ranked.totalHoursLost}h lost
                        </span>
                      </div>
                      <p className="text-[11px] text-gray-400 mt-1">{ranked.reason}</p>
                    </button>
                  );
                })}
              </div>
            ) : (
              <div className="space-y-2">
                <p className="text-xs text-amber-300/90 bg-amber-950/30 border border-amber-500/25 rounded-xl px-3 py-2">
                  No upcoming day leaves every subject ≥ 75% right now because{" "}
                  {subjects
                    .filter((s) => !isSafe(s.attended, s.total))
                    .map((s) => s.name)
                    .join(", ") || "overall"}{" "}
                  already needs recovery.
                </p>

                {zeroBottleneckImpactDays.length > 0 && (
                  <div className="space-y-1.5">
                    <p className="text-[11px] text-gray-400">
                      Days without any &lt;75% subjects scheduled (lowest risk if unavoidable):
                    </p>
                    <div className="flex flex-wrap gap-1.5">
                      {zeroBottleneckImpactDays.map((wd) => {
                        const isSelected = selectedDates.includes(wd.dateStr);
                        return (
                          <button
                            key={wd.dateStr}
                            type="button"
                            onClick={() => toggleDate(wd.dateStr)}
                            className={`text-xs px-2.5 py-1 rounded-lg border transition ${
                              isSelected
                                ? "bg-indigo-600/25 border-indigo-400 text-indigo-200"
                                : "bg-gray-800 border-gray-700 text-gray-300 hover:border-gray-600"
                            }`}
                          >
                            {wd.weekdayLabel} {wd.shortDate} ({wd.totalHours}h)
                          </button>
                        );
                      })}
                    </div>
                  </div>
                )}
              </div>
            )}
          </section>

          {/* 14-Day Working Calendar Picker */}
          <section className="bg-gray-900 border border-gray-800/80 rounded-2xl p-4 space-y-2.5">
            <div className="flex items-center justify-between">
              <h3 className="text-xs font-semibold uppercase tracking-wider text-gray-300">
                Tap Working Days to Skip
              </h3>
              <span className="text-[11px] text-gray-500">
                {selectedDates.length} selected
              </span>
            </div>

            {workingDays.length === 0 ? (
              <p className="text-xs text-gray-500 py-2">
                No scheduled classes found in the next 14 days. Check your timetable.
              </p>
            ) : (
              <div className="grid grid-cols-2 gap-2">
                {workingDays.map((wd) => {
                  const isSelected = selectedDates.includes(wd.dateStr);
                  const subjectCodes = Object.keys(wd.day.missedHours)
                    .map((sid) => subjectById.get(sid)?.slotLetter || subjectById.get(sid)?.code)
                    .filter(Boolean)
                    .join(" · ");

                  return (
                    <button
                      key={wd.dateStr}
                      type="button"
                      onClick={() => toggleDate(wd.dateStr)}
                      className={`text-left rounded-xl p-2.5 border transition ${
                        isSelected
                          ? "bg-indigo-600/25 border-indigo-400 text-white"
                          : "bg-gray-800/60 border-gray-800 text-gray-300 hover:border-gray-700"
                      }`}
                    >
                      <div className="flex items-center justify-between gap-1">
                        <span className="text-xs font-semibold">
                          {wd.weekdayLabel}, {wd.shortDate}
                        </span>
                        <span className="text-[11px] font-mono text-indigo-300 shrink-0">
                          {wd.totalHours}h
                        </span>
                      </div>
                      <p className="text-[10px] text-gray-400 truncate mt-0.5">
                        {wd.isToday ? "Today · " : ""}
                        {subjectCodes}
                      </p>
                    </button>
                  );
                })}
              </div>
            )}
          </section>

          {/* Custom +/- Hours Per Subject */}
          <section className="bg-gray-900 border border-gray-800/80 rounded-2xl p-4 space-y-2.5">
            <h3 className="text-xs font-semibold uppercase tracking-wider text-gray-300">
              Custom Hours Per Subject
            </h3>

            <div className="space-y-2">
              {subjects.map((s) => {
                const extra = customHours[s.id] ?? 0;
                return (
                  <div
                    key={s.id}
                    className="flex items-center justify-between gap-2 bg-gray-800/50 rounded-xl px-3 py-2"
                  >
                    <div className="min-w-0">
                      <p className="text-xs font-medium text-gray-200 truncate">
                        {s.name}
                      </p>
                      <p className="text-[10px] text-gray-500">
                        {s.code} · {s.attended}/{s.total}h
                      </p>
                    </div>
                    <div className="flex items-center gap-1.5 shrink-0">
                      <button
                        type="button"
                        onClick={() => stepCustomHour(s.id, -1)}
                        disabled={extra === 0}
                        aria-label={`Decrease missed hours for ${s.name}`}
                        className="w-7 h-7 rounded-lg bg-gray-800 hover:bg-gray-700 disabled:opacity-35 flex items-center justify-center text-gray-300 transition"
                      >
                        <Minus className="w-3.5 h-3.5" />
                      </button>
                      <span className="w-9 text-center text-xs font-mono tabular-nums text-white">
                        {extra}h
                      </span>
                      <button
                        type="button"
                        onClick={() => stepCustomHour(s.id, 1)}
                        aria-label={`Increase missed hours for ${s.name}`}
                        className="w-7 h-7 rounded-lg bg-gray-800 hover:bg-gray-700 flex items-center justify-center text-gray-300 transition"
                      >
                        <Plus className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          </section>
        </div>
      )}

      {/* ====================================================================
          SECTION 2: WEEKLY HABIT CALCULATOR
      ==================================================================== */}
      {subTab === "weekly" && (
        <div className="space-y-4">
          {/* Weekly Verdict Card */}
          <section
            className={`rounded-2xl p-4 border space-y-2 ${
              totalWeeklyMissed === 0
                ? "bg-gray-900 border-gray-800/80"
                : weeklyResult.safeWeeks > 0
                ? "bg-emerald-950/35 border-emerald-500/35"
                : "bg-rose-950/35 border-rose-500/35"
            }`}
          >
            <div className="flex items-start justify-between gap-2">
              <div className="space-y-1">
                <p className="text-[11px] uppercase tracking-wider font-semibold text-gray-400">
                  Weekly Habit Projection
                </p>
                {totalWeeklyMissed === 0 ? (
                  <p className="text-sm font-medium text-gray-300">
                    Pick a repeating weekday pattern or add sessions per week below.
                  </p>
                ) : (
                  <p
                    className={`text-sm font-bold ${
                      weeklyResult.safeWeeks > 0 ? "text-emerald-200" : "text-rose-200"
                    }`}
                  >
                    You can repeat this for{" "}
                    <span className="underline decoration-dotted">
                      {weeklyResult.safeWeeks}
                    </span>{" "}
                    full {weeklyResult.safeWeeks === 1 ? "week" : "weeks"} before{" "}
                    {bottleneckName} drops below 75%.
                  </p>
                )}
              </div>

              {(habitWeekdays.length > 0 || totalWeeklyMissed > 0) && (
                <button
                  type="button"
                  onClick={resetWeeklyHabit}
                  className="inline-flex items-center gap-1 text-[11px] px-2 py-1 rounded-lg bg-gray-900/70 hover:bg-gray-800 text-gray-300 shrink-0 transition"
                >
                  <RotateCcw className="w-3 h-3" />
                  Reset
                </button>
              )}
            </div>

            {totalWeeklyMissed > 0 && (
              <p className="text-xs text-gray-300">
                Skipping <strong className="tabular-nums">{totalWeeklyMissed}h/week</strong>{" "}
                across{" "}
                {Object.entries(weeklyMissedHours)
                  .filter(([, h]) => h > 0)
                  .map(
                    ([sid, h]) =>
                      `${subjectById.get(sid)?.slotLetter || subjectById.get(sid)?.code} (${h}h)`
                  )
                  .join(", ")}
              </p>
            )}
          </section>

          {/* Weekday Preset Pattern Picker */}
          <section className="bg-gray-900 border border-gray-800/80 rounded-2xl p-4 space-y-2.5">
            <h3 className="text-xs font-semibold uppercase tracking-wider text-gray-300">
              Skip Every Weekday
            </h3>
            <div className="grid grid-cols-3 gap-2">
              {WEEKDAY_KEYS.map((wd) => {
                const periods = timetable[wd] ?? [];
                const hrs = periods.reduce((s, p) => s + p.hours, 0);
                const active = habitWeekdays.includes(wd);

                return (
                  <button
                    key={wd}
                    type="button"
                    disabled={hrs === 0}
                    onClick={() => toggleHabitWeekday(wd)}
                    className={`rounded-xl px-2.5 py-2 border text-xs font-medium transition disabled:opacity-40 ${
                      active
                        ? "bg-indigo-600/25 border-indigo-400 text-white"
                        : "bg-gray-800/60 border-gray-800 text-gray-300 hover:border-gray-700"
                    }`}
                  >
                    <span>Every {WEEKDAY_LABELS[wd]}</span>
                    <span className="block text-[10px] text-gray-400 mt-0.5 tabular-nums">
                      {hrs}h/wk
                    </span>
                  </button>
                );
              })}
            </div>
          </section>

          {/* Per-Subject Weekly Session / Hour Stepper */}
          <section className="bg-gray-900 border border-gray-800/80 rounded-2xl p-4 space-y-2.5">
            <h3 className="text-xs font-semibold uppercase tracking-wider text-gray-300">
              Add Subject Sessions / Week
            </h3>
            <div className="space-y-2">
              {subjects.map((s) => {
                const customWk = habitCustomHours[s.id] ?? 0;
                const totalWk = weeklyMissedHours[s.id] ?? 0;
                const step = Math.max(1, s.hoursPerSession);

                return (
                  <div
                    key={s.id}
                    className="flex items-center justify-between gap-2 bg-gray-800/50 rounded-xl px-3 py-2"
                  >
                    <div className="min-w-0">
                      <p className="text-xs font-medium text-gray-200 truncate">
                        {s.name}
                      </p>
                      <p className="text-[10px] text-gray-500">
                        {s.code} · {s.kind === "lab" ? `${step}h/session` : "1h/session"}
                        {totalWk > 0 ? ` · Total: ${totalWk}h/wk` : ""}
                      </p>
                    </div>
                    <div className="flex items-center gap-1.5 shrink-0">
                      <button
                        type="button"
                        onClick={() => stepHabitHour(s.id, -step)}
                        disabled={customWk === 0}
                        aria-label={`Decrease weekly hours for ${s.name}`}
                        className="w-7 h-7 rounded-lg bg-gray-800 hover:bg-gray-700 disabled:opacity-35 flex items-center justify-center text-gray-300 transition"
                      >
                        <Minus className="w-3.5 h-3.5" />
                      </button>
                      <span className="w-10 text-center text-xs font-mono tabular-nums text-white">
                        +{customWk}h
                      </span>
                      <button
                        type="button"
                        onClick={() => stepHabitHour(s.id, step)}
                        aria-label={`Increase weekly hours for ${s.name}`}
                        className="w-7 h-7 rounded-lg bg-gray-800 hover:bg-gray-700 flex items-center justify-center text-gray-300 transition"
                      >
                        <Plus className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          </section>
        </div>
      )}
    </div>
  );
}

