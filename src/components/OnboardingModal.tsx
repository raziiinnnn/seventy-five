/**
 * OnboardingModal — First-Run Setup & Profile Editor (Step 8).
 *
 * Lets the student configure their Name, Department, Branch, and Semester,
 * and provides quick-start action cards to Scan ETLAB screenshots or Paste a template.
 */

import { useState, useEffect } from "react";
import {
  X,
  User,
  Camera,
  Share2,
  CheckCircle2,
  Save,
  GraduationCap,
} from "lucide-react";
import { useProfile } from "@/hooks/useAttendanceStore";
import { saveStudentProfile } from "@/db/dlActions";

interface OnboardingModalProps {
  isOpen: boolean;
  onClose: () => void;
  onOpenSyncModal?: (() => void) | undefined;
  onSwitchToSettings?: (() => void) | undefined;
}

export function OnboardingModal({
  isOpen,
  onClose,
  onOpenSyncModal,
  onSwitchToSettings,
}: OnboardingModalProps) {
  const profile = useProfile();

  const [name, setName] = useState("");
  const [department, setDepartment] = useState("Computer Science & Engineering");
  const [branch, setBranch] = useState("CSE-AI");
  const [semester, setSemester] = useState(5);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    if (profile) {
      setName(profile.name ?? "");
      setDepartment(profile.department ?? "Computer Science & Engineering");
      setBranch(profile.branch ?? "CSE-AI");
      setSemester(profile.semester ?? 5);
    }
  }, [profile]);

  if (!isOpen) return null;

  async function handleSave(e?: React.FormEvent) {
    if (e) e.preventDefault();
    setSaving(true);
    try {
      await saveStudentProfile({
        name,
        department,
        branch,
        semester,
      });
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/75 backdrop-blur-sm p-0 sm:p-4">
      <div className="w-full sm:max-w-md max-h-[90dvh] flex flex-col bg-gray-900 sm:rounded-2xl rounded-t-2xl border border-gray-800 overflow-hidden shadow-2xl">
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-gray-800 shrink-0">
          <div className="flex items-center gap-2">
            <div className="w-7 h-7 rounded-lg bg-indigo-600/20 text-indigo-400 flex items-center justify-center">
              <GraduationCap className="w-4 h-4" />
            </div>
            <div>
              <h2 className="font-semibold text-sm text-white">Student Profile</h2>
              <p className="text-[11px] text-gray-400">
                Stored offline in your browser&apos;s IndexedDB
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close profile modal"
            className="p-1.5 rounded-lg hover:bg-gray-800 text-gray-400 hover:text-white transition"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto p-4 space-y-4">
          <form onSubmit={handleSave} className="space-y-3">
            <div>
              <label className="block text-[11px] font-medium text-gray-400 mb-1">
                Your Name (Optional)
              </label>
              <input
                type="text"
                placeholder="e.g. Alex"
                value={name}
                onChange={(e) => setName(e.target.value)}
                className="w-full bg-gray-950 border border-gray-700 text-xs text-white rounded-xl px-3 py-2 focus:outline-none focus:ring-1 focus:ring-indigo-500"
              />
            </div>

            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className="block text-[11px] font-medium text-gray-400 mb-1">
                  Branch
                </label>
                <input
                  type="text"
                  placeholder="e.g. CSE-AI, ECE, ME"
                  value={branch}
                  onChange={(e) => setBranch(e.target.value)}
                  className="w-full bg-gray-950 border border-gray-700 text-xs text-white rounded-xl px-3 py-2 focus:outline-none focus:ring-1 focus:ring-indigo-500"
                />
              </div>

              <div>
                <label className="block text-[11px] font-medium text-gray-400 mb-1">
                  Semester (1–8)
                </label>
                <select
                  value={semester}
                  onChange={(e) => setSemester(Number(e.target.value))}
                  className="w-full bg-gray-950 border border-gray-700 text-xs text-white rounded-xl px-3 py-2 focus:outline-none focus:ring-1 focus:ring-indigo-500"
                >
                  {[1, 2, 3, 4, 5, 6, 7, 8].map((sem) => (
                    <option key={sem} value={sem}>
                      Semester {sem}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            <div>
              <label className="block text-[11px] font-medium text-gray-400 mb-1">
                Department
              </label>
              <input
                type="text"
                placeholder="e.g. Computer Science & Engineering"
                value={department}
                onChange={(e) => setDepartment(e.target.value)}
                className="w-full bg-gray-950 border border-gray-700 text-xs text-white rounded-xl px-3 py-2 focus:outline-none focus:ring-1 focus:ring-indigo-500"
              />
            </div>

            <button
              type="submit"
              disabled={saving}
              className="w-full py-2.5 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-semibold transition flex items-center justify-center gap-1.5"
            >
              {saved ? (
                <>
                  <CheckCircle2 className="w-4 h-4 text-emerald-300" />
                  Saved Profile!
                </>
              ) : (
                <>
                  <Save className="w-3.5 h-3.5" />
                  {saving ? "Saving…" : "Save Profile"}
                </>
              )}
            </button>
          </form>

          {/* Quick-start actions */}
          <div className="pt-2 border-t border-gray-800 space-y-2">
            <p className="text-[11px] font-semibold text-gray-400 uppercase tracking-wider">
              Quick Setup Options
            </p>

            <button
              type="button"
              onClick={() => {
                onClose();
                onOpenSyncModal?.();
              }}
              className="w-full flex items-center gap-3 p-3 rounded-xl bg-gray-800/80 hover:bg-gray-800 border border-gray-700 text-left transition"
            >
              <div className="w-8 h-8 rounded-lg bg-indigo-500/20 text-indigo-400 flex items-center justify-center shrink-0">
                <Camera className="w-4 h-4" />
              </div>
              <div className="min-w-0">
                <p className="text-xs font-semibold text-white">Scan ETLAB Screenshots</p>
                <p className="text-[11px] text-gray-400">
                  Auto-extract your courses and attendance with in-browser OCR
                </p>
              </div>
            </button>

            <button
              type="button"
              onClick={() => {
                onClose();
                onSwitchToSettings?.();
              }}
              className="w-full flex items-center gap-3 p-3 rounded-xl bg-gray-800/80 hover:bg-gray-800 border border-gray-700 text-left transition"
            >
              <div className="w-8 h-8 rounded-lg bg-purple-500/20 text-purple-400 flex items-center justify-center shrink-0">
                <Share2 className="w-4 h-4" />
              </div>
              <div className="min-w-0">
                <p className="text-xs font-semibold text-white">Paste Classmate&apos;s Template</p>
                <p className="text-[11px] text-gray-400">
                  Import subjects and timetable instantly without personal numbers
                </p>
              </div>
            </button>
          </div>
        </div>

        {/* Footer */}
        <div className="shrink-0 px-4 py-3 border-t border-gray-800 bg-gray-900/50">
          <button
            type="button"
            onClick={onClose}
            className="w-full py-2.5 rounded-xl bg-gray-800 hover:bg-gray-700 text-gray-200 text-xs font-semibold transition"
          >
            Continue with Current Data
          </button>
        </div>
      </div>
    </div>
  );
}
