/**
 * DataBackupView — Local backup, class-template sharing, and demo reset tab (Step 6).
 */

import { useState, useRef } from "react";
import {
  Download,
  Upload,
  Copy,
  Check,
  Share2,
  RotateCcw,
  AlertTriangle,
  CheckCircle2,
} from "lucide-react";
import { db } from "@/db/database";
import { seedDatabase } from "@/db/seed";
import {
  useSubjects,
  useTimetableRows,
  useProfile,
} from "@/hooks/useAttendanceStore";
import {
  exportAppDataJSON,
  importAppDataJSON,
  generateClassTemplateString,
  importClassTemplate,
} from "@/utils/backup";

interface DataBackupViewProps {
  todayDate: string;
}

export function DataBackupView({ todayDate }: DataBackupViewProps) {
  const profile = useProfile();
  const subjectRows = useSubjects();
  const timetableRows = useTimetableRows();

  const [status, setStatus] = useState<{
    kind: "idle" | "ok" | "error";
    msg: string;
  }>({ kind: "idle", msg: "" });
  const [copiedTemplate, setCopiedTemplate] = useState(false);
  const [templateInput, setTemplateInput] = useState("");
  const fileRef = useRef<HTMLInputElement>(null);

  // ---------------------------------------------------------------------------
  // Full JSON Backup
  // ---------------------------------------------------------------------------

  async function handleExport() {
    try {
      const json = await exportAppDataJSON();
      const blob = new Blob([json], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `75pct-backup-${todayDate}.json`;
      a.click();
      URL.revokeObjectURL(url);
      setStatus({ kind: "ok", msg: "JSON backup downloaded." });
    } catch (err) {
      setStatus({
        kind: "error",
        msg: err instanceof Error ? err.message : "Export failed.",
      });
    }
  }

  async function handleImport(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const text = await file.text();
      await importAppDataJSON(text);
      setStatus({ kind: "ok", msg: "Backup restored successfully." });
    } catch (err) {
      setStatus({
        kind: "error",
        msg: err instanceof Error ? err.message : "Import failed.",
      });
    }
    if (fileRef.current) fileRef.current.value = "";
  }

  // ---------------------------------------------------------------------------
  // Class Template Sharing
  // ---------------------------------------------------------------------------

  async function handleCopyTemplate() {
    if (!subjectRows || !timetableRows) return;
    const str = generateClassTemplateString(subjectRows, timetableRows);
    try {
      await navigator.clipboard.writeText(str);
      setCopiedTemplate(true);
      setTimeout(() => setCopiedTemplate(false), 2000);
      setStatus({
        kind: "ok",
        msg: "Class template string copied to clipboard (personal numbers excluded).",
      });
    } catch {
      setTemplateInput(str);
      setStatus({
        kind: "error",
        msg: "Clipboard blocked — template placed in the box below so you can copy it.",
      });
    }
  }

  async function handleImportTemplate() {
    const raw = templateInput.trim();
    if (!raw) return;
    try {
      await importClassTemplate(raw);
      setTemplateInput("");
      setStatus({
        kind: "ok",
        msg: "Class template imported — subjects and timetable updated.",
      });
    } catch (err) {
      setStatus({
        kind: "error",
        msg: err instanceof Error ? err.message : "Invalid class template string.",
      });
    }
  }

  // ---------------------------------------------------------------------------
  // Reset Demo Data
  // ---------------------------------------------------------------------------

  async function handleResetDemo() {
    if (
      !window.confirm(
        "Reset all data and reload the S5 CSE-AI demo? This cannot be undone."
      )
    ) {
      return;
    }

    try {
      await db.transaction(
        "rw",
        [
          db.profile,
          db.subjects,
          db.timetable,
          db.calendarOverrides,
          db.dailyLogs,
          db.dlRecords,
        ],
        async () => {
          await Promise.all([
            db.profile.clear(),
            db.subjects.clear(),
            db.timetable.clear(),
            db.calendarOverrides.clear(),
            db.dailyLogs.clear(),
            db.dlRecords.clear(),
          ]);
        }
      );
      await seedDatabase();
      setStatus({ kind: "ok", msg: "Demo data reset to S5 CSE-AI defaults." });
    } catch (err) {
      setStatus({
        kind: "error",
        msg: err instanceof Error ? err.message : "Reset failed.",
      });
    }
  }

  return (
    <div className="space-y-4">
      {/* Feedback Banner */}
      {status.kind !== "idle" && (
        <div
          className={`flex items-center gap-2 p-3 rounded-xl text-xs border ${
            status.kind === "ok"
              ? "bg-emerald-950/50 border-emerald-500/30 text-emerald-200"
              : "bg-rose-950/50 border-rose-500/30 text-rose-200"
          }`}
        >
          {status.kind === "ok" ? (
            <CheckCircle2 className="w-4 h-4 shrink-0 text-emerald-400" />
          ) : (
            <AlertTriangle className="w-4 h-4 shrink-0 text-rose-400" />
          )}
          <span>{status.msg}</span>
        </div>
      )}

      {/* Local Profile Summary */}
      {profile && (
        <section className="bg-gray-900 border border-gray-800/80 rounded-2xl p-4 space-y-1">
          <p className="text-[11px] uppercase tracking-wider font-semibold text-gray-400">
            Local Storage Profile
          </p>
          <p className="text-sm font-semibold text-white">
            {profile.branch} · Semester {profile.semester}
          </p>
          <p className="text-xs text-gray-400">{profile.department}</p>
          <p className="text-[11px] text-gray-500 pt-1">
            100% offline in browser IndexedDB — screenshots never leave this device.
          </p>
        </section>
      )}

      {/* Full JSON Backup */}
      <section className="bg-gray-900 border border-gray-800/80 rounded-2xl p-4 space-y-3">
        <div>
          <h2 className="text-sm font-semibold text-white">Full App Backup (JSON)</h2>
          <p className="text-xs text-gray-400 mt-0.5">
            Save or restore all subjects, timetable slots, logs, overrides, and DLs.
          </p>
        </div>

        <div className="grid grid-cols-2 gap-2.5">
          <button
            type="button"
            onClick={handleExport}
            className="flex items-center justify-center gap-1.5 py-2.5 px-3 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-semibold transition"
          >
            <Download className="w-4 h-4 shrink-0" />
            Export JSON
          </button>

          <label className="flex items-center justify-center gap-1.5 py-2.5 px-3 rounded-xl bg-gray-800 hover:bg-gray-700 text-gray-200 text-xs font-semibold transition cursor-pointer">
            <Upload className="w-4 h-4 shrink-0" />
            Import JSON
            <input
              ref={fileRef}
              type="file"
              accept=".json"
              className="sr-only"
              onChange={handleImport}
            />
          </label>
        </div>
      </section>

      {/* Class Template Sharing */}
      <section className="bg-gray-900 border border-gray-800/80 rounded-2xl p-4 space-y-3">
        <div>
          <h2 className="text-sm font-semibold text-white flex items-center gap-1.5">
            <Share2 className="w-4 h-4 text-indigo-400" />
            Class Template Sharing
          </h2>
          <p className="text-xs text-gray-400 mt-0.5">
            Share subjects and timetable with classmates without sharing your attendance numbers.
          </p>
        </div>

        <button
          type="button"
          onClick={handleCopyTemplate}
          disabled={!subjectRows || !timetableRows}
          className="w-full flex items-center justify-center gap-1.5 py-2.5 px-3 rounded-xl bg-gray-800 hover:bg-gray-700 disabled:opacity-40 text-gray-200 text-xs font-semibold transition"
        >
          {copiedTemplate ? (
            <>
              <Check className="w-4 h-4 text-emerald-400 shrink-0" />
              Copied Class Template
            </>
          ) : (
            <>
              <Copy className="w-4 h-4 shrink-0" />
              Copy Class Template String
            </>
          )}
        </button>

        <div className="space-y-2 pt-1">
          <textarea
            rows={3}
            value={templateInput}
            onChange={(e) => setTemplateInput(e.target.value)}
            placeholder="Paste classmate's template JSON here…"
            className="w-full rounded-xl bg-gray-950 border border-gray-800 px-3 py-2 text-xs font-mono text-gray-200 placeholder:text-gray-600 focus:outline-none focus:ring-1 focus:ring-indigo-500"
          />
          <button
            type="button"
            onClick={handleImportTemplate}
            disabled={!templateInput.trim()}
            className="w-full py-2 px-3 rounded-xl bg-gray-800 hover:bg-gray-700 disabled:opacity-40 text-xs font-semibold text-gray-200 transition"
          >
            Import Class Template
          </button>
        </div>
      </section>

      {/* Danger Zone: Reset Demo Data */}
      <section className="bg-gray-900 border border-rose-500/20 rounded-2xl p-4 space-y-2.5">
        <div>
          <h2 className="text-sm font-semibold text-rose-300">Reset Demo Data</h2>
          <p className="text-xs text-gray-400 mt-0.5">
            Clears IndexedDB tables and restores the default S5 CSE-AI dataset.
          </p>
        </div>
        <button
          type="button"
          onClick={handleResetDemo}
          className="w-full flex items-center justify-center gap-1.5 py-2.5 px-3 rounded-xl bg-rose-950/60 hover:bg-rose-900/60 border border-rose-500/30 text-rose-200 text-xs font-semibold transition"
        >
          <RotateCcw className="w-3.5 h-3.5 shrink-0" />
          Reset Demo Data
        </button>
      </section>
    </div>
  );
}

