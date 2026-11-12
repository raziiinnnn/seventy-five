/**
 * Shared 4-state period status pill selector (`present | absent | dl | cancelled`)
 * used by CatchUpModal and ScheduleView.
 */

import type { PeriodEvent } from "@/engine/types2";

export const PERIOD_STATUS_OPTIONS: ReadonlyArray<{
  value: PeriodEvent;
  label: string;
  activeClass: string;
}> = [
  {
    value: "present",
    label: "Present",
    activeClass: "bg-emerald-600 text-white border-emerald-400",
  },
  {
    value: "absent",
    label: "Absent",
    activeClass: "bg-rose-600 text-white border-rose-400",
  },
  {
    value: "dl",
    label: "DL",
    activeClass: "bg-indigo-600 text-white border-indigo-400",
  },
  {
    value: "cancelled",
    label: "Cancelled",
    activeClass: "bg-gray-600 text-white border-gray-400",
  },
];

export function PeriodStatusPills({
  value,
  onChange,
  disabled = false,
}: {
  value: PeriodEvent;
  onChange: (next: PeriodEvent) => void;
  disabled?: boolean;
}) {
  return (
    <div className="grid grid-cols-4 gap-1.5">
      {PERIOD_STATUS_OPTIONS.map((opt) => {
        const active = value === opt.value;
        return (
          <button
            key={opt.value}
            type="button"
            disabled={disabled}
            onClick={() => onChange(opt.value)}
            className={`py-1.5 px-1 rounded-lg text-[11px] font-semibold border transition disabled:opacity-50 ${
              active
                ? opt.activeClass
                : "bg-gray-900/70 text-gray-400 border-gray-700/80 hover:text-gray-200 hover:border-gray-600"
            }`}
          >
            {opt.label}
          </button>
        );
      })}
    </div>
  );
}

