/**
 * QuickCalibrationDrawer — Bottom-sheet modal for manually entering
 * attendance numbers without OCR.
 *
 * Useful for a 10-second calibration: type the numbers directly from
 * the ETLAB website without taking screenshots.
 *
 * Writes to the database via saveQuickCalibration() which also retires
 * local logs on or before the asOfDate.
 */

import { useState, useEffect } from "react";
import { X, Save, AlertTriangle, Loader2 } from "lucide-react";
import { useSubjects } from "@/hooks/useAttendanceStore";
import { saveQuickCalibration } from "@/db/syncActions";
import type { CalibrationUpdate } from "@/db/syncActions";

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

interface QuickCalibrationDrawerProps {
  isOpen: boolean;
  onClose: () => void;
}

// ---------------------------------------------------------------------------
// Local state shape (one row per subject)
// ---------------------------------------------------------------------------

interface DraftRow {
  id: string;
  code: string;
  name: string;
  kind: "theory" | "lab";
  attended: number;
  total: number;
  missed: number;
  dutyLeave: number;
  leave: number;
}

function todayStr(): string {
  return new Date().toISOString().slice(0, 10);
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function QuickCalibrationDrawer({ isOpen, onClose }: QuickCalibrationDrawerProps) {
  const subjects = useSubjects();
  const [rows, setRows] = useState<DraftRow[]>([]);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  // Initialise draft when subjects load or drawer opens
  useEffect(() => {
    if (!isOpen || !subjects) return;
    setRows(
      subjects.map((s) => ({
        id: s.id,
        code: s.code,
        name: s.name,
        kind: s.kind,
        attended: s.attended,
        total: s.total,
        missed: s.missed,
        dutyLeave: s.dutyLeave,
        leave: s.leave,
      }))
    );
    setSaveError(null);
  }, [isOpen, subjects]);

  if (!isOpen) return null;

  // ---------------------------------------------------------------------------
  // Helpers
  // ---------------------------------------------------------------------------

  function updateRow(idx: number, field: keyof DraftRow, raw: string) {
    const value = parseInt(raw, 10);
    if (isNaN(value)) return;
    setRows((prev) =>
      prev.map((r, i) => {
        if (i !== idx) return r;
        const updated = { ...r, [field]: value };

        // Auto-recalculate missed = max(0, total - attended - dutyLeave - leave)
        if (
          field === "attended" ||
          field === "total" ||
          field === "dutyLeave" ||
          field === "leave"
        ) {
          updated.missed = Math.max(
            0,
            updated.total - updated.attended - updated.dutyLeave - updated.leave
          );
        }

        return updated;
      })
    );
  }

  function isRowInvalid(r: DraftRow): boolean {
    return r.attended < 0 || r.total < 0 || r.attended > r.total;
  }

  const anyInvalid = rows.some(isRowInvalid);

  // ---------------------------------------------------------------------------
  // Save
  // ---------------------------------------------------------------------------

  async function handleSave() {
    if (anyInvalid) return;
    setSaving(true);
    setSaveError(null);

    const updates: CalibrationUpdate[] = rows.map((r) => ({
      id: r.id,
      attended: r.attended,
      total: r.total,
      missed: r.missed,
      dutyLeave: r.dutyLeave,
      leave: r.leave,
    }));

    try {
      await saveQuickCalibration(updates, todayStr());
      onClose();
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : "Save failed.");
    } finally {
      setSaving(false);
    }
  }

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/70 backdrop-blur-sm">
      <div className="w-full max-w-lg max-h-[85dvh] flex flex-col bg-gray-900 rounded-t-2xl shadow-2xl overflow-hidden">

        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-gray-800 shrink-0">
          <h2 className="font-semibold text-sm text-white">Quick Calibration</h2>
          <button
            onClick={onClose}
            className="p-1 rounded-lg hover:bg-gray-800 text-gray-400 hover:text-white transition"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <p className="px-4 pt-3 text-xs text-gray-400 shrink-0">
          Type your ETLAB numbers directly. <strong className="text-gray-200">Missed</strong> is
          auto-calculated. Local logs on or before today will be retired.
        </p>

        {/* Subject list */}
        <div className="flex-1 overflow-y-auto px-4 py-3 space-y-3">
          {rows.length === 0 ? (
            <p className="text-sm text-gray-500 text-center py-8">Loading subjects…</p>
          ) : (
            rows.map((r, idx) => {
              const invalid = isRowInvalid(r);
              return (
                <div
                  key={r.id}
                  className={`bg-gray-800 rounded-xl p-3 ${invalid ? "ring-1 ring-red-500" : ""}`}
                >
                  {/* Subject label */}
                  <div className="flex items-center gap-2 mb-2">
                    <span className="font-mono text-xs text-indigo-300 font-semibold">{r.code}</span>
                    <span className="text-xs capitalize text-gray-500 bg-gray-700 px-1.5 py-0.5 rounded">
                      {r.kind}
                    </span>
                    <span className="text-xs text-gray-400 truncate">{r.name}</span>
                    {invalid && (
                      <AlertTriangle className="w-3.5 h-3.5 text-red-400 shrink-0 ml-auto" />
                    )}
                  </div>

                  {/* Input grid: Attended | Total | Duty Leave | Leave */}
                  <div className="grid grid-cols-4 gap-2 text-center">
                    {(
                      [
                        { label: "Attended", field: "attended" as const },
                        { label: "Total", field: "total" as const },
                        { label: "Duty Lv", field: "dutyLeave" as const },
                        { label: "Leave", field: "leave" as const },
                      ] as const
                    ).map(({ label, field }) => (
                      <div key={field}>
                        <p className="text-xs text-gray-500 mb-1">{label}</p>
                        <input
                          type="number"
                          min={0}
                          value={r[field]}
                          onChange={(e) => updateRow(idx, field, e.target.value)}
                          className={`w-full text-center bg-gray-700 text-white rounded-lg px-1 py-1.5 text-sm focus:outline-none focus:ring-1 ${
                            invalid && (field === "attended" || field === "total")
                              ? "ring-1 ring-red-500 focus:ring-red-400"
                              : "focus:ring-indigo-500"
                          }`}
                        />
                      </div>
                    ))}
                  </div>

                  {/* Auto-computed missed */}
                  <p className="mt-1.5 text-xs text-gray-500 text-right">
                    Missed (computed): <span className="text-gray-300">{r.missed}</span>
                  </p>
                </div>
              );
            })
          )}
        </div>

        {/* Footer */}
        <div className="shrink-0 px-4 py-3 border-t border-gray-800 space-y-2">
          {saveError && (
            <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-red-900/40 text-red-300 text-sm">
              <AlertTriangle className="w-4 h-4 shrink-0" />
              {saveError}
            </div>
          )}

          <div className="flex gap-2">
            <button
              onClick={onClose}
              className="flex-1 py-2.5 rounded-xl bg-gray-800 hover:bg-gray-700 text-gray-300 text-sm transition"
            >
              Cancel
            </button>
            <button
              onClick={handleSave}
              disabled={saving || anyInvalid || rows.length === 0}
              className="flex-1 py-2.5 rounded-xl bg-indigo-600 hover:bg-indigo-500 disabled:opacity-40 disabled:cursor-not-allowed text-white text-sm font-semibold transition flex items-center justify-center gap-2"
            >
              {saving ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" />
                  Saving…
                </>
              ) : (
                <>
                  <Save className="w-4 h-4" />
                  Save All
                </>
              )}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

