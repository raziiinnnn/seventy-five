/**
 * DashboardView — Mobile-first attendance overview (Step 6).
 *
 * Shows:
 *  - Overall 75% Safety Hero Card (tabular %, 75% threshold progress bar,
 *    tightest-subject/bottleneck verdict, and toggleable Pending DL pill).
 *  - Catch-Up Queue alert derived from minimum subject `asOfDate`.
 *  - Upgraded Subject Cards with slot pills, kind/credit-wise badges,
 *    local overlay badge, 75% threshold bar, and hour/session skip buffers.
 */

import { useState, useMemo } from "react";
import { AlertTriangle, Sparkles, Clock, CalendarCheck } from "lucide-react";
import {
  isSafe,
  skipBuffer,
  recoveryNeeded,
  sessionsFromHours,
  overallOf,
  projectWithDL,
} from "@/engine/attendance";
import type { PendingDL } from "@/engine/types";
import {
  useEffectiveSubjects,
  usePendingDLs,
  useAppCatchUpQueue,
} from "@/hooks/useAttendanceStore";
import {
  formatPctTruncated,
  clampBarWidth,
  getSafetyTone,
  type SafetyTone,
} from "@/utils/attendanceFormat";

// ---------------------------------------------------------------------------
// Props & Styling Helpers
// ---------------------------------------------------------------------------

interface DashboardViewProps {
  todayDate: string;
  onOpenCatchUp?: () => void;
  onOpenSchedule?: () => void;
}

const TONE_TEXT: Record<SafetyTone, string> = {
  safe: "text-emerald-400",
  careful: "text-amber-400",
  red: "text-rose-400",
};

const TONE_BAR: Record<SafetyTone, string> = {
  safe: "bg-emerald-500",
  careful: "bg-amber-400",
  red: "bg-rose-500",
};

const TONE_BADGE: Record<SafetyTone, { label: string; cls: string }> = {
  safe: {
    label: "SAFE",
    cls: "bg-emerald-500/15 text-emerald-300 border border-emerald-500/30",
  },
  careful: {
    label: "CAREFUL",
    cls: "bg-amber-500/15 text-amber-300 border border-amber-500/30",
  },
  red: {
    label: "BELOW 75%",
    cls: "bg-rose-500/15 text-rose-300 border border-rose-500/30",
  },
};

function ThresholdProgressBar({
  attended,
  total,
  tone,
}: {
  attended: number;
  total: number;
  tone: SafetyTone;
}) {
  const widthPct = clampBarWidth(attended, total);

  return (
    <div
      className="relative h-2.5 flex items-center"
      aria-label={`Attendance ${formatPctTruncated(attended, total)}%, 75% threshold marker`}
    >
      <div className="h-2 w-full rounded-full bg-gray-800 overflow-hidden">
        <div
          className={`h-full rounded-full transition-all duration-300 ${TONE_BAR[tone]}`}
          style={{ width: `${widthPct.toFixed(1)}%` }}
        />
      </div>
      {/* Vertical 75% threshold marker */}
      <div
        className="absolute top-0 bottom-0 left-[75%] w-0.5 -translate-x-1/2 bg-white/80 rounded-full pointer-events-none"
        title="75% minimum threshold"
      />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function DashboardView({
  todayDate,
  onOpenCatchUp,
  onOpenSchedule,
}: DashboardViewProps) {
  const subjects = useEffectiveSubjects();
  const pendingDLs = usePendingDLs();
  const catchUp = useAppCatchUpQueue(todayDate);
  const [showDlPreview, setShowDlPreview] = useState(false);

  // Build PendingDL payload clamped cleanly so partial/stale records never throw
  const { totalPendingDLHours, dlProjection } = useMemo(() => {
    if (!subjects || !pendingDLs || pendingDLs.length === 0) {
      return { totalPendingDLHours: 0, dlProjection: null };
    }

    const bySubject = new Map<string, number>();
    for (const dl of pendingDLs) {
      bySubject.set(dl.subjectId, (bySubject.get(dl.subjectId) ?? 0) + dl.hours);
    }

    const sanitized: PendingDL[] = [];
    for (const s of subjects) {
      const hrs = bySubject.get(s.id) ?? 0;
      const clamped = Math.min(hrs, Math.max(0, s.total - s.attended));
      if (clamped > 0) {
        sanitized.push({ subjectId: s.id, hours: clamped });
      }
    }

    const totalHrs = sanitized.reduce((sum, d) => sum + d.hours, 0);
    if (totalHrs === 0) {
      return { totalPendingDLHours: 0, dlProjection: null };
    }

    return {
      totalPendingDLHours: totalHrs,
      dlProjection: projectWithDL(subjects, sanitized),
    };
  }, [subjects, pendingDLs]);

  if (!subjects) {
    return (
      <div className="space-y-3 py-6">
        <div className="h-36 rounded-2xl bg-gray-900 animate-pulse" />
        <div className="h-24 rounded-2xl bg-gray-900 animate-pulse" />
        <div className="h-24 rounded-2xl bg-gray-900 animate-pulse" />
      </div>
    );
  }

  // Apply DL projection override to view when toggled on
  const dlProjectedMap = new Map(
    dlProjection?.subjects.map((p) => [p.subjectId, p.projected]) ?? []
  );
  const viewSubjects = subjects.map((s) => {
    if (!showDlPreview) return s;
    const proj = dlProjectedMap.get(s.id);
    return proj ? { ...s, attended: proj.attended, total: proj.total } : s;
  });

  const overall = overallOf(viewSubjects);
  const overallSafe = isSafe(overall.attended, overall.total);
  const overallBuf = skipBuffer(overall.attended, overall.total);
  const overallRec = recoveryNeeded(overall.attended, overall.total);
  const overallPct = formatPctTruncated(overall.attended, overall.total);
  const overallTone = getSafetyTone(overallSafe, overallBuf, overall.total);

  const unsafeSubjects = viewSubjects.filter((s) => !isSafe(s.attended, s.total));
  const tightestSubject =
    viewSubjects.length > 0
      ? viewSubjects
          .map((s) => ({
            subject: s,
            buffer: skipBuffer(s.attended, s.total),
          }))
          .sort((a, b) => a.buffer - b.buffer)[0]!
      : null;

  return (
    <div className="space-y-4">
      {/* Overall 75% Safety Hero Card */}
      <section className="bg-gray-900 border border-gray-800/80 rounded-2xl p-4 sm:p-5 space-y-3">
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="text-[11px] font-medium text-gray-400 uppercase tracking-widest">
              Overall Attendance
            </p>
            <div className="flex items-baseline gap-2.5 mt-1">
              <span
                className={`text-4xl sm:text-5xl font-black tabular-nums tracking-tight ${TONE_TEXT[overallTone]}`}
              >
                {overallPct}%
              </span>
              <span className="text-sm text-gray-400 tabular-nums whitespace-nowrap">
                {overall.attended} / {overall.total} hrs
              </span>
            </div>
          </div>

          <span
            className={`text-[11px] font-bold px-2.5 py-1 rounded-full tracking-wide whitespace-nowrap shrink-0 ${TONE_BADGE[overallTone].cls}`}
          >
            {TONE_BADGE[overallTone].label}
          </span>
        </div>

        {/* 0-100% progress bar with 75% tick */}
        <div className="space-y-1">
          <ThresholdProgressBar
            attended={overall.attended}
            total={overall.total}
            tone={overallTone}
          />
          <div className="relative text-[10px] text-gray-500 h-3.5">
            <span className="absolute left-0">0%</span>
            <span className="absolute left-[75%] -translate-x-1/2 text-gray-400 font-medium">
              75% min
            </span>
            <span className="absolute right-0">100%</span>
          </div>
        </div>

        {/* Plain-English Verdict */}
        {viewSubjects.length === 0 ? (
          <p className="text-xs text-gray-400">
            No subjects yet. Use Sync ETLAB or Quick Edit to add courses.
          </p>
        ) : !overallSafe ? (
          <div className="rounded-xl bg-rose-950/50 border border-rose-500/30 px-3 py-2 text-xs text-rose-200">
            Overall is below 75% — attend next{" "}
            <span className="font-bold text-rose-100">{overallRec}h</span> consecutively
            to reach 75%.
          </div>
        ) : unsafeSubjects.length > 0 ? (
          <div className="rounded-xl bg-amber-950/40 border border-amber-500/30 px-3 py-2 text-xs text-amber-200 space-y-1">
            <p className="font-medium">
              Overall is {overallPct}% (+{overallBuf}h), but {unsafeSubjects.length}{" "}
              {unsafeSubjects.length === 1 ? "subject is" : "subjects are"} below 75%!
            </p>
            <p className="text-[11px] text-amber-300/90">
              Below 75%:{" "}
              {unsafeSubjects
                .map(
                  (u) =>
                    `${u.name} (${formatPctTruncated(u.attended, u.total)}%)`
                )
                .join(", ")}
            </p>
          </div>
        ) : tightestSubject ? (
          <div className="rounded-xl bg-emerald-950/40 border border-emerald-500/25 px-3 py-2 text-xs text-emerald-200">
            You can skip up to{" "}
            <span className="font-bold">{overallBuf}h</span> overall, limited by{" "}
            <span className="font-semibold">{tightestSubject.subject.name}</span> (
            {tightestSubject.buffer}h buffer).
          </div>
        ) : null}

        {/* Pending DL Projection Pill */}
        {dlProjection && totalPendingDLHours > 0 && (
          <div className="pt-0.5">
            <button
              type="button"
              onClick={() => setShowDlPreview((v) => !v)}
              className={`inline-flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-full border transition ${
                showDlPreview
                  ? "bg-indigo-600/30 border-indigo-400 text-indigo-200"
                  : "bg-gray-800/80 border-gray-700 text-gray-300 hover:border-indigo-500/60"
              }`}
            >
              <Sparkles className="w-3.5 h-3.5 text-indigo-400 shrink-0" />
              <span>
                With Pending DL (+{totalPendingDLHours}h):{" "}
                <strong className="tabular-nums">
                  {dlProjection.projected.percentage}%
                </strong>
              </span>
              <span className="text-[10px] opacity-75 ml-0.5">
                {showDlPreview ? "(Showing)" : "(Tap to preview)"}
              </span>
            </button>
          </div>
        )}
      </section>

      {/* Catch-Up Queue Alert / Subtle Log Today's Classes CTA */}
      {catchUp && catchUp.length > 0 ? (
        <button
          type="button"
          onClick={onOpenCatchUp}
          className="w-full flex items-center justify-between gap-2.5 px-3.5 py-2.5 bg-amber-950/40 hover:bg-amber-950/60 border border-amber-500/35 rounded-xl text-amber-200 text-xs text-left transition"
        >
          <span className="flex items-center gap-2 min-w-0">
            <AlertTriangle className="w-4 h-4 text-amber-400 shrink-0" />
            <span className="truncate">
              <strong>{catchUp.length}</strong>{" "}
              {catchUp.length === 1 ? "day needs" : "days need"} attendance logging
              (oldest: <span className="font-mono">{catchUp[0]?.date}</span>)
            </span>
          </span>
          <span className="font-semibold text-amber-300 whitespace-nowrap shrink-0">
            Log Now →
          </span>
        </button>
      ) : (
        catchUp && (
          <div className="flex justify-end">
            <button
              type="button"
              onClick={onOpenSchedule ?? onOpenCatchUp}
              className="inline-flex items-center gap-1.5 text-xs text-gray-300 hover:text-white px-3 py-1.5 rounded-xl bg-gray-900 hover:bg-gray-800 border border-gray-800 transition"
            >
              <CalendarCheck className="w-3.5 h-3.5 text-indigo-400 shrink-0" />
              Log Today&apos;s Classes
            </button>
          </div>
        )
      )}

      {/* Upgraded Subject Cards List */}
      <section className="space-y-2.5">
        <div className="flex items-center justify-between px-0.5">
          <h2 className="text-[11px] font-semibold text-gray-400 uppercase tracking-widest">
            Subjects ({viewSubjects.length})
          </h2>
          {showDlPreview && totalPendingDLHours > 0 && (
            <span className="text-[11px] text-indigo-300 font-medium">
              Previewing Pending DLs
            </span>
          )}
        </div>

        <ul className="space-y-2.5">
          {viewSubjects.map((s) => {
            const subSafe = isSafe(s.attended, s.total);
            const subBuf = skipBuffer(s.attended, s.total);
            const subRec = recoveryNeeded(s.attended, s.total);
            const subPct = formatPctTruncated(s.attended, s.total);
            const tone = getSafetyTone(subSafe, subBuf, s.total);
            const sessions =
              s.kind === "lab"
                ? sessionsFromHours(subBuf, Math.max(1, s.hoursPerSession))
                : subBuf;

            return (
              <li
                key={s.id}
                className="bg-gray-900 border border-gray-800/80 rounded-2xl p-3.5 space-y-2.5"
              >
                {/* Top Row: Badges + Title vs. Percentage + Fraction */}
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0 flex-1 space-y-1">
                    <div className="flex items-center gap-1.5 flex-wrap">
                      {s.slotLetter && (
                        <span className="inline-flex items-center justify-center min-w-[20px] h-5 px-1.5 rounded bg-indigo-500/20 text-indigo-300 border border-indigo-500/30 font-mono text-[11px] font-bold">
                          {s.slotLetter}
                        </span>
                      )}
                      <span className="font-mono text-xs font-semibold text-gray-300">
                        {s.code}
                      </span>
                      {s.kind === "lab" && (
                        <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded bg-purple-500/15 text-purple-300 border border-purple-500/25">
                          Lab {s.hoursPerSession}h
                        </span>
                      )}
                      {s.creditWise && (
                        <span className="text-[10px] px-1.5 py-0.5 rounded bg-gray-800 text-gray-400">
                          Credit-wise: {s.creditWise}
                        </span>
                      )}
                    </div>

                    <p className="text-sm font-semibold text-white leading-snug break-words">
                      {s.name}
                    </p>
                  </div>

                  {/* Right Side Stats (never wraps) */}
                  <div className="text-right whitespace-nowrap shrink-0">
                    <p
                      className={`text-lg font-extrabold tabular-nums leading-tight ${TONE_TEXT[tone]}`}
                    >
                      {subPct}%
                    </p>
                    <p className="text-xs text-gray-400 tabular-nums">
                      {s.attended}/{s.total} hrs
                    </p>
                    {s.overlayTotal > 0 && (
                      <span className="inline-block mt-0.5 text-[10px] font-medium px-1.5 py-0.5 rounded bg-sky-500/15 text-sky-300 border border-sky-500/25">
                        +{s.overlayTotal}h local
                      </span>
                    )}
                  </div>
                </div>

                {/* 75% Threshold Progress Bar */}
                <ThresholdProgressBar
                  attended={s.attended}
                  total={s.total}
                  tone={tone}
                />

                {/* Bottom Footer Row */}
                <div className="flex items-center justify-between gap-2 text-[11px]">
                  <span className="inline-flex items-center gap-1 text-gray-500 truncate">
                    <Clock className="w-3 h-3 shrink-0" />
                    ETLAB as of {s.asOfDate}
                  </span>

                  <div className="whitespace-nowrap shrink-0">
                    {!subSafe ? (
                      <span className="inline-flex items-center px-2 py-0.5 rounded-full bg-rose-500/15 text-rose-300 border border-rose-500/30 font-semibold">
                        Attend next {subRec}h to hit 75%
                      </span>
                    ) : s.total === 0 ? (
                      <span className="text-gray-500 font-medium">No classes yet</span>
                    ) : s.kind === "lab" ? (
                      <span className="text-gray-300 font-medium">
                        Can skip {sessions} {sessions === 1 ? "session" : "sessions"} (
                        {subBuf}h)
                      </span>
                    ) : (
                      <span className="text-gray-300 font-medium">
                        Can skip {subBuf}h
                      </span>
                    )}
                  </div>
                </div>
              </li>
            );
          })}
        </ul>
      </section>
    </div>
  );
}

