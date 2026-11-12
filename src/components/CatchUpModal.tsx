/**
 * CatchUpModal — Interactive Lazy Catch-Up Queue Modal (Step 7).
 *
 * Steps chronologically through unlogged working days returned by
 * `useAppCatchUpQueue(todayDate)`:
 *  - Date pills at the top (oldest first)
 *  - 3 Fast Macros: "Attended All", "Absent All", "Mark as Holiday"
 *  - Per-period toggles (Present / Absent / DL / Cancelled) + "Save Day & Next"
 *  - Shows "All caught up!" confirmation once queue reaches 0.
 */

import { useState, useMemo } from "react";
import {
  X,
  CheckCircle2,
  XCircle,
  CalendarOff,
  AlertTriangle,
  Loader2,
  ArrowRight,
  Sparkles,
} from "lucide-react";
import { useAppCatchUpQueue, useSubjects } from "@/hooks/useAttendanceStore";
import { saveDayAttendanceLogs, setDateOverride } from "@/db/logActions";
import type { PeriodEvent } from "@/engine/types2";
import { formatDateWithWeekday } from "@/utils/attendanceFormat";
import { PeriodStatusPills } from "@/components/PeriodStatusPills";

interface CatchUpModalProps {
  isOpen: boolean;
  onClose: () => void;
  todayDate: string;
}

export function CatchUpModal({ isOpen, onClose, todayDate }: CatchUpModalProps) {
  const queue = useAppCatchUpQueue(todayDate);
  const subjects = useSubjects();

  const [selectedDate, setSelectedDate] = useState<string | null>(null);
  const [draft, setDraft] = useState<{
    date: string;
    statuses: Record<number, PeriodEvent>;
  }>({ date: "", statuses: {} });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const { subjectById, subjectByCode } = useMemo(() => {
    const byId = new Map<string, NonNullable<typeof subjects>[number]>();
    const byCode = new Map<string, NonNullable<typeof subjects>[number]>();
    for (const s of subjects ?? []) {
      byId.set(s.id, s);
      byCode.set(s.code.toUpperCase(), s);
    }
    return { subjectById: byId, subjectByCode: byCode };
  }, [subjects]);

  if (!isOpen) return null;

  const activeEntry =
    queue && queue.length > 0
      ? queue.find((entry) => entry.date === selectedDate) ?? queue[0]!
      : null;

  function resolveSubject(rawId: string) {
    return subjectById.get(rawId) ?? subjectByCode.get(rawId.toUpperCase());
  }

  function getStatus(idx: number): PeriodEvent {
    if (!activeEntry || draft.date !== activeEntry.date) return "present";
    return draft.statuses[idx] ?? "present";
  }

  function setStatus(idx: number, status: PeriodEvent) {
    if (!activeEntry) return;
    setDraft((prev) => {
      const base = prev.date === activeEntry.date ? prev.statuses : {};
      return {
        date: activeEntry.date,
        statuses: { ...base, [idx]: status },
      };
    });
  }

  function buildEntries(overrideStatus?: PeriodEvent) {
    if (!activeEntry) return [];
    return activeEntry.periods.map((p, idx) => {
      const resolved = resolveSubject(p.subjectId);
      return {
        period: p.period,
        subjectId: resolved?.id ?? p.subjectId,
        hours: p.hours,
        status: overrideStatus ?? getStatus(idx),
      };
    });
  }

  async function handleSaveCustom() {
    if (!activeEntry || saving) return;
    setSaving(true);
    setError(null);
    try {
      await saveDayAttendanceLogs(activeEntry.date, buildEntries());
      setDraft({ date: "", statuses: {} });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save logs.");
    } finally {
      setSaving(false);
    }
  }

  async function handleMacroAll(status: "present" | "absent") {
    if (!activeEntry || saving) return;
    setSaving(true);
    setError(null);
    try {
      await saveDayAttendanceLogs(activeEntry.date, buildEntries(status));
      setDraft({ date: "", statuses: {} });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save logs.");
    } finally {
      setSaving(false);
    }
  }

  async function handleMarkHoliday() {
    if (!activeEntry || saving) return;
    setSaving(true);
    setError(null);
    try {
      await setDateOverride(activeEntry.date, {
        kind: "holiday",
        reason: "Holiday",
      });
      setDraft({ date: "", statuses: {} });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not mark holiday.");
    } finally {
      setSaving(false);
    }
  }

  function handleClose() {
    setSelectedDate(null);
    setDraft({ date: "", statuses: {} });
    setError(null);
    onClose();
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/75 backdrop-blur-sm p-0 sm:p-4">
      <div className="w-full sm:max-w-lg max-h-[90dvh] flex flex-col bg-gray-900 sm:rounded-2xl rounded-t-2xl border border-gray-800 overflow-hidden shadow-2xl">
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-gray-800 shrink-0">
          <div>
            <h2 className="font-semibold text-sm text-white">Catch-Up Queue</h2>
            <p className="text-[11px] text-gray-400">
              {queue === undefined
                ? "Loading unlogged days…"
                : queue.length === 0
                ? "No pending days"
                : `${queue.length} working ${
                    queue.length === 1 ? "day" : "days"
                  } waiting`}
            </p>
          </div>
          <button
            type="button"
            onClick={handleClose}
            aria-label="Close catch-up modal"
            className="p-1.5 rounded-lg hover:bg-gray-800 text-gray-400 hover:text-white transition"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto p-4 space-y-4">
          {queue === undefined ? (
            <div className="py-12 flex flex-col items-center gap-2 text-gray-400 text-xs">
              <Loader2 className="w-6 h-6 animate-spin text-indigo-400" />
              Checking schedule…
            </div>
          ) : queue.length === 0 ? (
            <div className="py-10 flex flex-col items-center text-center space-y-3">
              <div className="w-12 h-12 rounded-full bg-emerald-500/15 border border-emerald-500/30 flex items-center justify-center">
                <Sparkles className="w-6 h-6 text-emerald-400" />
              </div>
              <div className="space-y-1">
                <h3 className="text-base font-bold text-white">All caught up!</h3>
                <p className="text-xs text-gray-400 max-w-xs">
                  Every scheduled working day after your ETLAB anchor date up to{" "}
                  <span className="font-mono text-gray-300">{todayDate}</span> is
                  accounted for.
                </p>
              </div>
            </div>
          ) : (
            <>
              {/* Queued date switcher pills (oldest first) */}
              <div className="flex items-center gap-1.5 overflow-x-auto pb-1">
                {queue.map((entry) => {
                  const isActive = activeEntry?.date === entry.date;
                  return (
                    <button
                      key={entry.date}
                      type="button"
                      onClick={() => {
                        setSelectedDate(entry.date);
                        setError(null);
                      }}
                      className={`shrink-0 px-3 py-1.5 rounded-full text-xs font-medium border transition ${
                        isActive
                          ? "bg-indigo-600 text-white border-indigo-400"
                          : "bg-gray-800 text-gray-300 border-gray-700 hover:border-gray-600"
                      }`}
                    >
                      {formatDateWithWeekday(entry.date)}
                      {entry.date === todayDate ? " · Today" : ""}
                    </button>
                  );
                })}
              </div>

              {activeEntry && (
                <>
                  {/* Active date title */}
                  <div className="flex items-center justify-between text-xs text-gray-400 px-0.5">
                    <span>
                      Logging{" "}
                      <strong className="text-white">
                        {formatDateWithWeekday(activeEntry.date)}
                      </strong>{" "}
                      <span className="font-mono text-gray-500">
                        ({activeEntry.date})
                      </span>
                    </span>
                    <span className="tabular-nums">
                      {activeEntry.periods.reduce((s, p) => s + p.hours, 0)}h
                      scheduled
                    </span>
                  </div>

                  {/* 3 Fast Macro Actions */}
                  <div className="grid grid-cols-3 gap-2">
                    <button
                      type="button"
                      disabled={saving}
                      onClick={() => handleMacroAll("present")}
                      className="flex items-center justify-center gap-1 py-2 px-2 rounded-xl bg-emerald-600/20 hover:bg-emerald-600/30 border border-emerald-500/40 text-emerald-200 text-xs font-semibold transition disabled:opacity-50"
                    >
                      <CheckCircle2 className="w-3.5 h-3.5 shrink-0" />
                      Attended All
                    </button>

                    <button
                      type="button"
                      disabled={saving}
                      onClick={() => handleMacroAll("absent")}
                      className="flex items-center justify-center gap-1 py-2 px-2 rounded-xl bg-rose-600/20 hover:bg-rose-600/30 border border-rose-500/40 text-rose-200 text-xs font-semibold transition disabled:opacity-50"
                    >
                      <XCircle className="w-3.5 h-3.5 shrink-0" />
                      Absent All
                    </button>

                    <button
                      type="button"
                      disabled={saving}
                      onClick={handleMarkHoliday}
                      className="flex items-center justify-center gap-1 py-2 px-2 rounded-xl bg-amber-600/20 hover:bg-amber-600/30 border border-amber-500/40 text-amber-200 text-xs font-semibold transition disabled:opacity-50"
                    >
                      <CalendarOff className="w-3.5 h-3.5 shrink-0" />
                      Mark as Holiday
                    </button>
                  </div>

                  {/* Period-by-Period Custom Toggles */}
                  <div className="space-y-2.5">
                    {activeEntry.periods.map((p, idx) => {
                      const subject = resolveSubject(p.subjectId);
                      return (
                        <div
                          key={`${activeEntry.date}-${p.period}-${idx}`}
                          className="bg-gray-800/75 border border-gray-800 rounded-xl p-3 space-y-2"
                        >
                          <div className="flex items-center justify-between gap-2">
                            <div className="flex items-center gap-1.5 min-w-0">
                              <span className="font-mono text-[11px] font-bold text-gray-400 shrink-0">
                                P{p.period}
                              </span>
                              {subject?.slotLetter && (
                                <span className="inline-flex items-center justify-center min-w-[18px] h-4 px-1 rounded bg-indigo-500/20 text-indigo-300 border border-indigo-500/30 font-mono text-[10px] font-bold shrink-0">
                                  {subject.slotLetter}
                                </span>
                              )}
                              <span className="text-xs font-semibold text-white truncate">
                                {subject?.name ?? p.subjectId}
                              </span>
                            </div>
                            <span className="text-[11px] font-mono text-gray-400 shrink-0">
                              {p.hours}h
                            </span>
                          </div>

                          <PeriodStatusPills
                            value={getStatus(idx)}
                            onChange={(status) => setStatus(idx, status)}
                            disabled={saving}
                          />
                        </div>
                      );
                    })}
                  </div>
                </>
              )}

              {error && (
                <div className="flex items-center gap-2 px-3 py-2 rounded-xl bg-rose-950/50 border border-rose-500/30 text-rose-200 text-xs">
                  <AlertTriangle className="w-4 h-4 shrink-0 text-rose-400" />
                  {error}
                </div>
              )}
            </>
          )}
        </div>

        {/* Footer */}
        <div className="shrink-0 px-4 py-3 border-t border-gray-800 flex gap-2">
          {queue && queue.length === 0 ? (
            <button
              type="button"
              onClick={handleClose}
              className="flex-1 py-2.5 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white text-sm font-semibold transition"
            >
              Done
            </button>
          ) : (
            <>
              <button
                type="button"
                onClick={handleClose}
                className="px-4 py-2.5 rounded-xl bg-gray-800 hover:bg-gray-700 text-gray-300 text-sm transition"
              >
                Later
              </button>
              <button
                type="button"
                disabled={saving || !activeEntry}
                onClick={handleSaveCustom}
                className="flex-1 py-2.5 rounded-xl bg-indigo-600 hover:bg-indigo-500 disabled:opacity-40 text-white text-sm font-semibold transition flex items-center justify-center gap-1.5"
              >
                {saving ? (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin" />
                    Saving…
                  </>
                ) : (
                  <>
                    Save Day &amp; Next
                    <ArrowRight className="w-4 h-4" />
                  </>
                )}
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

