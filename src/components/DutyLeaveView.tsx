/**
 * DutyLeaveView — Duty Leave (DL) Vault (Step 8).
 *
 * Responsibilities:
 *  - DL Projection Impact Card (projectWithDL actual vs projected, safe recovery highlights).
 *  - Add New Duty Leave Form / Drawer (event name, subject dropdown, hours stepper, date(s), status).
 *  - Tracked DL Claims List (lifecycle selector, applied_not_reflected warnings, delete).
 */

import { useState, useMemo } from "react";
import {
  Award,
  Plus,
  Trash2,
  AlertTriangle,
  CheckCircle2,
  Sparkles,
  Calendar,
  Clock,
  ArrowRight,
  TrendingUp,
} from "lucide-react";
import {
  useEffectiveSubjects,
  usePendingDLs,
  useDLRecords,
  useDailyLogs,
} from "@/hooks/useAttendanceStore";
import {
  createDLRecord,
  updateDLRecordStatus,
  deleteDLRecord,
} from "@/db/dlActions";
import { projectWithDL, isSafe } from "@/engine/attendance";
import type { DLStatus } from "@/engine/types2";
import type { PendingDL } from "@/engine/types";
import { formatDateWithWeekday } from "@/utils/attendanceFormat";

interface DutyLeaveViewProps {
  todayDate: string;
}

const LIFECYCLE_STAGES: Array<{ status: DLStatus; label: string }> = [
  { status: "logged", label: "Logged" },
  { status: "certificate_received", label: "Cert Received" },
  { status: "applied", label: "Applied" },
  { status: "reflected", label: "Reflected" },
];

export function DutyLeaveView({ todayDate }: DutyLeaveViewProps) {
  const subjects = useEffectiveSubjects();
  const pendingDLs = usePendingDLs();
  const allDLRecords = useDLRecords();
  const dailyLogs = useDailyLogs();

  // Form states
  const [showAddForm, setShowAddForm] = useState(false);
  const [eventName, setEventName] = useState("");
  const [subjectId, setSubjectId] = useState("");
  const [hours, setHours] = useState(1);
  const [selectedDate, setSelectedDate] = useState(todayDate);
  const [status, setStatus] = useState<DLStatus>("logged");
  const [formError, setFormError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

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

  // Find recent dates where student logged a "dl" period
  const loggedDLDates = useMemo(() => {
    if (!dailyLogs) return [];
    const dates = new Set<string>();
    for (const log of dailyLogs) {
      if (log.status === "dl" && !log.retired) {
        dates.add(log.date);
      }
    }
    return Array.from(dates).sort().reverse();
  }, [dailyLogs]);

  // DL Projection Calculation
  const { totalPendingHours, dlProjection, recoveredSubjects } = useMemo(() => {
    if (!subjects || !pendingDLs || pendingDLs.length === 0) {
      return { totalPendingHours: 0, dlProjection: null, recoveredSubjects: [] };
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
      return { totalPendingHours: 0, dlProjection: null, recoveredSubjects: [] };
    }

    try {
      const proj = projectWithDL(subjects, sanitized);
      const recovered = proj.subjects
        .filter((sub) => !sub.actual.safe && sub.projected.safe)
        .map((sub) => {
          const s = resolveSubject(sub.subjectId);
          return {
            name: s?.name ?? sub.subjectId,
            actualPct: sub.actual.percentage,
            projectedPct: sub.projected.percentage,
          };
        });

      return {
        totalPendingHours: totalHrs,
        dlProjection: proj,
        recoveredSubjects: recovered,
      };
    } catch {
      return { totalPendingHours: totalHrs, dlProjection: null, recoveredSubjects: [] };
    }
  }, [subjects, pendingDLs]);

  // Handle Create DL Record
  async function handleCreateDL(e: React.FormEvent) {
    e.preventDefault();
    if (!eventName.trim()) {
      setFormError("Please enter an event or activity name.");
      return;
    }
    const targetSubjectId = subjectId || subjects?.[0]?.id;
    if (!targetSubjectId) {
      setFormError("Please select a subject.");
      return;
    }

    setSubmitting(true);
    setFormError(null);
    try {
      await createDLRecord({
        eventName: eventName.trim(),
        subjectId: targetSubjectId,
        hours,
        logDates: [selectedDate],
        status,
      });

      // Reset form
      setEventName("");
      setHours(1);
      setShowAddForm(false);
    } catch (err) {
      setFormError(err instanceof Error ? err.message : "Failed to create DL record.");
    } finally {
      setSubmitting(false);
    }
  }

  async function handleStatusChange(id: string, newStatus: DLStatus) {
    try {
      await updateDLRecordStatus(id, newStatus);
    } catch (err) {
      console.error("Failed to update status", err);
    }
  }

  async function handleDelete(id: string) {
    if (!window.confirm("Delete this Duty Leave record?")) return;
    try {
      await deleteDLRecord(id);
    } catch (err) {
      console.error("Failed to delete record", err);
    }
  }

  if (!subjects) {
    return (
      <div className="space-y-3 py-6">
        <div className="h-32 rounded-2xl bg-gray-900 animate-pulse" />
        <div className="h-48 rounded-2xl bg-gray-900 animate-pulse" />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* 1. DL Projection Impact Card */}
      <section className="bg-gray-900 border border-gray-800/80 rounded-2xl p-4 sm:p-5 space-y-3.5">
        <div className="flex items-start justify-between gap-3">
          <div>
            <div className="flex items-center gap-1.5">
              <Award className="w-4 h-4 text-indigo-400" />
              <h2 className="text-[11px] font-semibold text-gray-400 uppercase tracking-widest">
                Duty Leave Projection
              </h2>
            </div>
            <p className="text-xs text-gray-400 mt-1">
              Duty Leave recovers missed hours once certificates are approved on ETLAB.
            </p>
          </div>
          <span className="text-xs font-semibold px-2.5 py-1 rounded-full bg-indigo-500/15 border border-indigo-500/30 text-indigo-300 tabular-nums shrink-0">
            +{totalPendingHours}h Pending
          </span>
        </div>

        {dlProjection ? (
          <div className="space-y-3">
            <div className="grid grid-cols-2 gap-2 bg-gray-950/60 rounded-xl p-3 border border-gray-800/80">
              <div>
                <p className="text-[11px] text-gray-500 font-medium">Actual Overall</p>
                <p className="text-2xl font-black text-white tabular-nums mt-0.5">
                  {dlProjection.actual.percentage}%
                </p>
                <p className="text-[11px] text-gray-400">
                  {dlProjection.actual.attended} / {dlProjection.actual.total} hrs
                </p>
              </div>

              <div className="border-l border-gray-800/80 pl-3">
                <p className="text-[11px] text-indigo-400 font-medium flex items-center gap-1">
                  <TrendingUp className="w-3 h-3" />
                  Projected with DL
                </p>
                <p className="text-2xl font-black text-emerald-400 tabular-nums mt-0.5">
                  {dlProjection.projected.percentage}%
                </p>
                <p className="text-[11px] text-gray-400">
                  {dlProjection.projected.attended} / {dlProjection.projected.total} hrs
                </p>
              </div>
            </div>

            {/* Recovery Highlights */}
            {recoveredSubjects.length > 0 && (
              <div className="rounded-xl bg-emerald-950/40 border border-emerald-500/30 p-3 text-xs text-emerald-200 space-y-1">
                <div className="flex items-center gap-1.5 font-semibold text-emerald-300">
                  <Sparkles className="w-4 h-4 text-emerald-400" />
                  <span>Will cross 75% once approved!</span>
                </div>
                {recoveredSubjects.map((sub, i) => (
                  <p key={i} className="text-[11px] text-emerald-200/90 pl-5">
                    • <strong>{sub.name}</strong> moves from {sub.actualPct}% to{" "}
                    <strong>{sub.projectedPct}%</strong> (Safe)
                  </p>
                ))}
              </div>
            )}
          </div>
        ) : (
          <div className="p-3 bg-gray-950/40 rounded-xl border border-gray-800/80 text-xs text-gray-400 text-center">
            No active pending Duty Leaves. Add an event below to project your attendance.
          </div>
        )}
      </section>

      {/* 2. Add New Duty Leave Toggle / Form */}
      <section className="bg-gray-900 border border-gray-800/80 rounded-2xl p-4 space-y-3">
        <div className="flex items-center justify-between">
          <h3 className="text-xs font-semibold uppercase tracking-wider text-gray-300">
            Duty Leave Claims
          </h3>
          <button
            type="button"
            onClick={() => setShowAddForm((v) => !v)}
            className="inline-flex items-center gap-1 text-xs font-semibold px-3 py-1.5 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white transition"
          >
            <Plus className="w-3.5 h-3.5" />
            {showAddForm ? "Cancel" : "Add Claim"}
          </button>
        </div>

        {showAddForm && (
          <form
            onSubmit={handleCreateDL}
            className="bg-gray-950/70 border border-gray-800 rounded-xl p-3.5 space-y-3"
          >
            <p className="text-xs font-semibold text-white">New Duty Leave Claim</p>

            {formError && (
              <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-rose-950/50 border border-rose-500/30 text-rose-200 text-xs">
                <AlertTriangle className="w-3.5 h-3.5 shrink-0 text-rose-400" />
                <span>{formError}</span>
              </div>
            )}

            {/* Event Name */}
            <div>
              <label className="block text-[11px] font-medium text-gray-400 mb-1">
                Event or Activity Name
              </label>
              <input
                type="text"
                placeholder="e.g. IEEE Hackathon, Arts Fest, Sports Meet"
                value={eventName}
                onChange={(e) => setEventName(e.target.value)}
                className="w-full bg-gray-900 border border-gray-700 text-xs text-white rounded-lg px-3 py-2 focus:outline-none focus:ring-1 focus:ring-indigo-500"
              />
            </div>

            {/* Subject Dropdown & Hours */}
            <div className="grid grid-cols-3 gap-2">
              <div className="col-span-2">
                <label className="block text-[11px] font-medium text-gray-400 mb-1">
                  Subject
                </label>
                <select
                  value={subjectId || subjects[0]?.id}
                  onChange={(e) => {
                    const nextId = e.target.value;
                    setSubjectId(nextId);
                    const s = resolveSubject(nextId);
                    if (s) setHours(Math.max(1, s.hoursPerSession));
                  }}
                  className="w-full bg-gray-900 border border-gray-700 text-xs text-white rounded-lg px-2.5 py-2 focus:outline-none focus:ring-1 focus:ring-indigo-500"
                >
                  {subjects.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.slotLetter ? `[${s.slotLetter}] ` : ""}
                      {s.code} — {s.name}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-[11px] font-medium text-gray-400 mb-1">
                  Hours (1–6)
                </label>
                <div className="flex items-center bg-gray-900 border border-gray-700 rounded-lg overflow-hidden">
                  <button
                    type="button"
                    onClick={() => setHours((h) => Math.max(1, h - 1))}
                    className="px-2.5 py-2 text-gray-300 hover:bg-gray-800 text-xs"
                  >
                    -
                  </button>
                  <span className="flex-1 text-center text-xs font-mono font-bold text-white">
                    {hours}h
                  </span>
                  <button
                    type="button"
                    onClick={() => setHours((h) => Math.min(6, h + 1))}
                    className="px-2.5 py-2 text-gray-300 hover:bg-gray-800 text-xs"
                  >
                    +
                  </button>
                </div>
              </div>
            </div>

            {/* Date Picker & Quick Chips */}
            <div>
              <label className="block text-[11px] font-medium text-gray-400 mb-1">
                Absence Date
              </label>
              <input
                type="date"
                value={selectedDate}
                onChange={(e) => setSelectedDate(e.target.value)}
                className="w-full bg-gray-900 border border-gray-700 text-xs text-white rounded-lg px-3 py-1.5 focus:outline-none focus:ring-1 focus:ring-indigo-500"
              />

              {loggedDLDates.length > 0 && (
                <div className="mt-1.5 flex items-center gap-1.5 flex-wrap">
                  <span className="text-[10px] text-gray-500">From logged DL:</span>
                  {loggedDLDates.slice(0, 3).map((d) => (
                    <button
                      key={d}
                      type="button"
                      onClick={() => setSelectedDate(d)}
                      className={`text-[10px] px-2 py-0.5 rounded-full border transition ${
                        selectedDate === d
                          ? "bg-indigo-600/30 border-indigo-400 text-indigo-200"
                          : "bg-gray-800 text-gray-400 border-gray-700"
                      }`}
                    >
                      {d}
                    </button>
                  ))}
                </div>
              )}
            </div>

            {/* Initial Status */}
            <div>
              <label className="block text-[11px] font-medium text-gray-400 mb-1">
                Initial Status
              </label>
              <div className="grid grid-cols-3 gap-1.5">
                {(
                  [
                    { status: "logged", label: "Logged (Draft)" },
                    { status: "certificate_received", label: "Cert Received" },
                    { status: "applied", label: "Applied" },
                  ] as const
                ).map((opt) => (
                  <button
                    key={opt.status}
                    type="button"
                    onClick={() => setStatus(opt.status)}
                    className={`py-1.5 px-1 rounded-lg text-[11px] font-semibold border transition ${
                      status === opt.status
                        ? "bg-indigo-600 text-white border-indigo-400"
                        : "bg-gray-900 text-gray-400 border-gray-800 hover:border-gray-700"
                    }`}
                  >
                    {opt.label}
                  </button>
                ))}
              </div>
            </div>

            <button
              type="submit"
              disabled={submitting}
              className="w-full py-2 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-semibold transition"
            >
              {submitting ? "Saving Claim…" : "Save Duty Leave Claim"}
            </button>
          </form>
        )}

        {/* 3. Tracked DL Claims List */}
        <div className="space-y-2.5">
          {allDLRecords === undefined ? (
            <p className="text-xs text-gray-500 py-3 text-center">Loading DL records…</p>
          ) : allDLRecords.length === 0 ? (
            <p className="text-xs text-gray-500 py-6 text-center bg-gray-950/40 rounded-xl border border-dashed border-gray-800">
              No Duty Leave records tracked yet. Tap &ldquo;Add Claim&rdquo; above.
            </p>
          ) : (
            allDLRecords.map((record) => {
              const subject = resolveSubject(record.subjectId);
              const isUnreflectedAlert = record.status === "applied_not_reflected";

              return (
                <div
                  key={record.id}
                  className={`bg-gray-800/80 border rounded-xl p-3.5 space-y-2.5 transition ${
                    isUnreflectedAlert
                      ? "border-amber-500/40 bg-amber-950/20"
                      : record.status === "reflected"
                      ? "border-emerald-500/30 bg-emerald-950/10"
                      : "border-gray-800"
                  }`}
                >
                  {/* Card Header: Event Name + Subject + Hours */}
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <div className="flex items-center gap-1.5 flex-wrap">
                        <span className="text-xs font-bold text-white truncate">
                          {record.eventName}
                        </span>
                        <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-indigo-500/20 text-indigo-300 border border-indigo-500/30 font-mono">
                          +{record.hours}h
                        </span>
                      </div>
                      <p className="text-[11px] text-gray-400 mt-0.5 truncate">
                        {subject?.slotLetter ? `[${subject.slotLetter}] ` : ""}
                        {subject?.code} — {subject?.name ?? record.subjectId}
                      </p>
                      {record.logDates.length > 0 && (
                        <p className="text-[10px] text-gray-500 flex items-center gap-1 mt-0.5">
                          <Calendar className="w-3 h-3" />
                          {record.logDates.join(", ")}
                        </p>
                      )}
                    </div>

                    <button
                      type="button"
                      aria-label="Delete Duty Leave claim"
                      onClick={() => handleDelete(record.id)}
                      className="p-1 rounded-lg text-gray-500 hover:text-rose-400 hover:bg-gray-700/60 transition shrink-0"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>

                  {/* Warning banner for applied_not_reflected */}
                  {isUnreflectedAlert && (
                    <div className="flex items-start gap-2 px-3 py-2 rounded-lg bg-amber-950/50 border border-amber-500/40 text-amber-200 text-[11px] leading-snug">
                      <AlertTriangle className="w-4 h-4 text-amber-400 shrink-0 mt-0.5" />
                      <span>
                        Applied, but last ETLAB sync did not show a Duty Leave increase
                        for this subject — follow up with your faculty advisor!
                      </span>
                    </div>
                  )}

                  {/* 4-Stage Lifecycle Stepper */}
                  <div className="pt-1">
                    <p className="text-[10px] uppercase font-semibold text-gray-500 mb-1 tracking-wider">
                      Lifecycle Status:
                    </p>
                    <div className="grid grid-cols-4 gap-1">
                      {LIFECYCLE_STAGES.map(({ status: stageStatus, label }) => {
                        const isCurrent = record.status === stageStatus;
                        return (
                          <button
                            key={stageStatus}
                            type="button"
                            onClick={() => handleStatusChange(record.id, stageStatus)}
                            className={`py-1.5 px-0.5 rounded-lg text-[10px] font-semibold border text-center transition ${
                              isCurrent
                                ? stageStatus === "reflected"
                                  ? "bg-emerald-600 text-white border-emerald-400"
                                  : "bg-indigo-600 text-white border-indigo-400"
                                : "bg-gray-900/60 text-gray-400 border-gray-700/60 hover:text-gray-200"
                            }`}
                          >
                            {label}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                </div>
              );
            })
          )}
        </div>
      </section>
    </div>
  );
}

