/**
 * App.tsx — Root component (Step 3 scaffold only).
 *
 * Responsibilities:
 *  - Seeds the database on first launch.
 *  - Shows the overall attendance summary from IndexedDB (live-reactive).
 *  - Renders the Catch-Up Queue badge.
 *  - Provides Export and Import backup buttons.
 *
 * Full screen UI is built in Step 4+. This shell is enough to verify
 * the database, hooks, and backup utilities all wire together correctly.
 */

import { useEffect, useState, useRef } from "react";
import { Download, Upload, BookOpen, AlertTriangle, CheckCircle2 } from "lucide-react";
import { seedDatabase } from "@/db/seed";
import { useEffectiveSubjects, useOverallAttendance, useCatchUpQueue } from "@/hooks/useAttendanceStore";
import { exportAppDataJSON, importAppDataJSON } from "@/utils/backup";
import { isSafe, skipBuffer } from "@/engine/attendance";

// ---------------------------------------------------------------------------
// Today's date — derived once at render time, never from new Date() in engine
// ---------------------------------------------------------------------------
const TODAY = new Date().toISOString().slice(0, 10);
// A simple "last checked" fallback — in Step 4 this will come from the profile
const LAST_CHECKED = new Date(Date.now() - 7 * 86_400_000).toISOString().slice(0, 10);

// ---------------------------------------------------------------------------
// Root App
// ---------------------------------------------------------------------------

export default function App() {
  const [seeded, setSeeded] = useState(false);
  const [importStatus, setImportStatus] = useState<"idle" | "ok" | "error">("idle");
  const [importMsg, setImportMsg] = useState("");
  const fileRef = useRef<HTMLInputElement>(null);

  // Seed on first mount
  useEffect(() => {
    seedDatabase()
      .then(() => setSeeded(true))
      .catch(console.error);
  }, []);

  const overall = useOverallAttendance();
  const subjects = useEffectiveSubjects();
  const catchUp = useCatchUpQueue(LAST_CHECKED, TODAY);

  // ---------------------------------------------------------------------------
  // Backup handlers
  // ---------------------------------------------------------------------------

  async function handleExport() {
    const json = await exportAppDataJSON();
    const blob = new Blob([json], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `75pct-backup-${TODAY}.json`;
    a.click();
    URL.revokeObjectURL(url);
  }

  async function handleImport(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const text = await file.text();
      await importAppDataJSON(text);
      setImportStatus("ok");
      setImportMsg("Backup restored successfully.");
    } catch (err) {
      setImportStatus("error");
      setImportMsg(err instanceof Error ? err.message : "Unknown error.");
    }
    // Reset input so the same file can be re-selected
    if (fileRef.current) fileRef.current.value = "";
  }

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------

  if (!seeded) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-950 text-white">
        <p className="text-gray-400 animate-pulse">Opening database…</p>
      </div>
    );
  }

  const safe = overall ? isSafe(overall.attended, overall.total) : true;
  const buffer = overall ? skipBuffer(overall.attended, overall.total) : 0;
  const pct =
    overall && overall.total > 0
      ? Math.floor((overall.attended * 1000) / overall.total) / 10
      : 0;

  return (
    <div className="min-h-screen bg-gray-950 text-white p-4 font-sans">
      {/* Header */}
      <header className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-2">
          <BookOpen className="w-6 h-6 text-indigo-400" />
          <h1 className="text-xl font-bold tracking-tight">75%</h1>
        </div>
        <div className="flex gap-2">
          <button
            onClick={handleExport}
            className="flex items-center gap-1 text-sm px-3 py-1.5 rounded-lg bg-gray-800 hover:bg-gray-700 transition"
          >
            <Download className="w-4 h-4" />
            Export
          </button>
          <label className="flex items-center gap-1 text-sm px-3 py-1.5 rounded-lg bg-gray-800 hover:bg-gray-700 transition cursor-pointer">
            <Upload className="w-4 h-4" />
            Import
            <input
              ref={fileRef}
              type="file"
              accept=".json"
              className="sr-only"
              onChange={handleImport}
            />
          </label>
        </div>
      </header>

      {/* Import status */}
      {importStatus !== "idle" && (
        <div
          className={`flex items-center gap-2 mb-4 p-3 rounded-lg text-sm ${
            importStatus === "ok"
              ? "bg-green-900/50 text-green-300"
              : "bg-red-900/50 text-red-300"
          }`}
        >
          {importStatus === "ok" ? (
            <CheckCircle2 className="w-4 h-4 shrink-0" />
          ) : (
            <AlertTriangle className="w-4 h-4 shrink-0" />
          )}
          {importMsg}
        </div>
      )}

      {/* Overall card */}
      <section className="bg-gray-900 rounded-2xl p-5 mb-4">
        <p className="text-xs text-gray-500 uppercase tracking-widest mb-1">Overall</p>
        <div className="flex items-end gap-2">
          <span
            className={`text-5xl font-black tabular-nums ${
              safe ? "text-white" : "text-red-400"
            }`}
          >
            {pct.toFixed(1)}%
          </span>
          <span className="text-gray-400 text-sm mb-1">
            {overall?.attended ?? 0}/{overall?.total ?? 0} hrs
          </span>
        </div>
        <p className={`mt-2 text-sm ${safe ? "text-green-400" : "text-red-400"}`}>
          {safe
            ? `You can skip ${buffer}h more and stay safe.`
            : `Attend ${overall ? 3 * overall.total - 4 * overall.attended : 0}h to recover.`}
        </p>
      </section>

      {/* Catch-up queue badge */}
      {catchUp && catchUp.length > 0 && (
        <div className="flex items-center gap-2 mb-4 p-3 bg-amber-900/40 rounded-xl text-amber-300 text-sm">
          <AlertTriangle className="w-4 h-4 shrink-0" />
          {catchUp.length} day{catchUp.length > 1 ? "s" : ""} need attendance logging
          (oldest: {catchUp[0]?.date})
        </div>
      )}

      {/* Subject list */}
      <section>
        <h2 className="text-xs text-gray-500 uppercase tracking-widest mb-2">Subjects</h2>
        <ul className="space-y-2">
          {subjects?.map((s) => {
            const subSafe = isSafe(s.attended, s.total);
            const subBuf = skipBuffer(s.attended, s.total);
            const subPct =
              s.total > 0 ? Math.floor((s.attended * 1000) / s.total) / 10 : 0;
            return (
              <li
                key={s.id}
                className="flex items-center justify-between bg-gray-900 rounded-xl px-4 py-3"
              >
                <div>
                  <p className="font-medium text-sm">{s.name}</p>
                  <p className="text-xs text-gray-500">{s.code}</p>
                </div>
                <div className="text-right">
                  <p
                    className={`font-bold tabular-nums ${
                      subSafe ? "text-white" : "text-red-400"
                    }`}
                  >
                    {subPct.toFixed(1)}%
                  </p>
                  <p className="text-xs text-gray-500">
                    {s.attended}/{s.total} · buf {subBuf}h
                  </p>
                </div>
              </li>
            );
          })}
        </ul>
      </section>
    </div>
  );
}

