/**
 * App.tsx — Mobile App Shell & Bottom Tab Navigation (Step 6).
 *
 * Responsibilities:
 *  - Seeds IndexedDB on first launch.
 *  - Constrains layout to a mobile-first shell (`max-w-lg mx-auto min-h-screen pb-24`).
 *  - Renders sticky top header with `75% / seventy-five`, Sync ETLAB, and Quick Edit.
 *  - Routes between Dashboard, Simulator, and Data & Backup via Bottom Navigation.
 */

import { useEffect, useState } from "react";
import {
  BookOpen,
  Camera,
  PenLine,
  Home,
  SlidersHorizontal,
  Database,
} from "lucide-react";
import { seedDatabase } from "@/db/seed";
import { DashboardView } from "@/components/DashboardView";
import { SimulatorView } from "@/components/SimulatorView";
import { DataBackupView } from "@/components/DataBackupView";
import { EtlSyncModal } from "@/components/EtlSyncModal";
import { QuickCalibrationDrawer } from "@/components/QuickCalibrationDrawer";

// Today's local date (derived once in UI shell, passed as ISO string to engine/views)
function localTodayIso(): string {
  const now = new Date();
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, "0");
  const d = String(now.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

const TODAY = localTodayIso();

type ActiveTab = "dashboard" | "simulator" | "data";

const NAV_ITEMS: Array<{
  id: ActiveTab;
  label: string;
  Icon: typeof Home;
}> = [
  { id: "dashboard", label: "Dashboard", Icon: Home },
  { id: "simulator", label: "Simulator", Icon: SlidersHorizontal },
  { id: "data", label: "Data & Backup", Icon: Database },
];

export default function App() {
  const [seeded, setSeeded] = useState(false);
  const [activeTab, setActiveTab] = useState<ActiveTab>("dashboard");
  const [syncModalOpen, setSyncModalOpen] = useState(false);
  const [calibOpen, setCalibOpen] = useState(false);

  useEffect(() => {
    seedDatabase()
      .then(() => setSeeded(true))
      .catch(console.error);
  }, []);

  if (!seeded) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-950 text-white">
        <p className="text-sm text-gray-400 animate-pulse">Opening database…</p>
      </div>
    );
  }

  return (
    <div className="max-w-lg mx-auto min-h-screen pb-24 bg-gray-950 text-white font-sans">
      {/* Sticky Top Header */}
      <header className="sticky top-0 z-30 bg-gray-950/90 backdrop-blur border-b border-gray-800/80 px-4 py-3 flex items-center justify-between gap-2">
        <div className="flex items-center gap-2 min-w-0">
          <BookOpen className="w-5 h-5 text-indigo-400 shrink-0" />
          <div className="leading-none">
            <h1 className="text-base font-extrabold tracking-tight">75%</h1>
            <p className="text-[10px] text-gray-500 font-medium">seventy-five</p>
          </div>
        </div>

        <div className="flex items-center gap-2 shrink-0">
          <button
            type="button"
            onClick={() => setSyncModalOpen(true)}
            className="inline-flex items-center gap-1.5 text-xs font-semibold px-3 py-1.5 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white whitespace-nowrap shrink-0 transition"
          >
            <Camera className="w-3.5 h-3.5 shrink-0" />
            Sync ETLAB
          </button>

          <button
            type="button"
            onClick={() => setCalibOpen(true)}
            className="inline-flex items-center gap-1.5 text-xs font-semibold px-3 py-1.5 rounded-lg bg-gray-800 hover:bg-gray-700 text-gray-200 whitespace-nowrap shrink-0 transition"
          >
            <PenLine className="w-3.5 h-3.5 shrink-0" />
            Quick Edit
          </button>
        </div>
      </header>

      {/* Main Content */}
      <main className="px-4 pt-4">
        {activeTab === "dashboard" && <DashboardView todayDate={TODAY} />}
        {activeTab === "simulator" && <SimulatorView todayDate={TODAY} />}
        {activeTab === "data" && <DataBackupView todayDate={TODAY} />}
      </main>

      {/* Sticky Bottom Navigation Bar */}
      <nav
        aria-label="Primary navigation"
        className="fixed bottom-0 inset-x-0 z-30 bg-gray-950/95 backdrop-blur border-t border-gray-800"
      >
        <div className="max-w-lg mx-auto grid grid-cols-3">
          {NAV_ITEMS.map(({ id, label, Icon }) => {
            const active = activeTab === id;
            return (
              <button
                key={id}
                type="button"
                onClick={() => setActiveTab(id)}
                className={`flex flex-col items-center justify-center gap-1 py-2.5 text-[11px] font-medium transition ${
                  active
                    ? "text-indigo-400"
                    : "text-gray-500 hover:text-gray-300"
                }`}
              >
                <Icon className="w-5 h-5" />
                <span>{label}</span>
              </button>
            );
          })}
        </div>
      </nav>

      {/* Modals */}
      <EtlSyncModal
        isOpen={syncModalOpen}
        onClose={() => setSyncModalOpen(false)}
      />
      <QuickCalibrationDrawer
        isOpen={calibOpen}
        onClose={() => setCalibOpen(false)}
      />
    </div>
  );
}
