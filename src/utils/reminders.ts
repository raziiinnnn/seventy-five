/**
 * Storage persistence and .ics Calendar reminder utilities (Step 8).
 */

/**
 * Requests browser storage persistence so IndexedDB data is not evicted
 * under storage pressure. Never throws on unsupported browsers.
 */
export async function ensurePersistentStorage(): Promise<{
  supported: boolean;
  persisted: boolean;
}> {
  if (
    typeof navigator === "undefined" ||
    !navigator.storage ||
    typeof navigator.storage.persist !== "function"
  ) {
    return { supported: false, persisted: false };
  }

  try {
    const isPersisted =
      typeof navigator.storage.persisted === "function"
        ? await navigator.storage.persisted()
        : false;

    if (isPersisted) {
      return { supported: true, persisted: true };
    }

    const granted = await navigator.storage.persist();
    return { supported: true, persisted: granted };
  } catch {
    return { supported: false, persisted: false };
  }
}

/**
 * Checks current persistence status without prompting.
 */
export async function getStoragePersistenceStatus(): Promise<{
  supported: boolean;
  persisted: boolean;
}> {
  if (
    typeof navigator === "undefined" ||
    !navigator.storage ||
    typeof navigator.storage.persisted !== "function"
  ) {
    return { supported: false, persisted: false };
  }

  try {
    const persisted = await navigator.storage.persisted();
    return { supported: true, persisted };
  } catch {
    return { supported: false, persisted: false };
  }
}

/**
 * Generates an RFC 5545 .ics calendar event file set to repeat every college day
 * (Mon–Sat) at the specified local time (default 18:00 / 6:00 PM) with a 5-minute
 * alarm, and triggers a browser file download.
 */
export function downloadDailyCheckInICS(
  reminderHour24 = 18,
  reminderMinute = 0
): void {
  const pad = (n: number) => String(n).padStart(2, "0");
  const now = new Date();
  const year = now.getFullYear();
  const month = pad(now.getMonth() + 1);
  const day = pad(now.getDate());

  const hourStr = pad(reminderHour24);
  const minStr = pad(reminderMinute);

  const endHour = (reminderHour24 + (reminderMinute >= 45 ? 1 : 0)) % 24;
  const endMin = (reminderMinute + 15) % 60;
  const endHourStr = pad(endHour);
  const endMinStr = pad(endMin);

  // Floating local time format: YYYYMMDDTHHMMSS
  const dtStart = `${year}${month}${day}T${hourStr}${minStr}00`;
  const dtEnd = `${year}${month}${day}T${endHourStr}${endMinStr}00`;

  const dtStamp = `${year}${month}${day}T${pad(now.getUTCHours())}${pad(
    now.getUTCMinutes()
  )}${pad(now.getUTCSeconds())}Z`;

  const uid = `reminder-${year}${month}${day}-${hourStr}${minStr}@seventy-five.local`;

  const icsLines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//seventy-five//Attendance Tracker//EN",
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
    "BEGIN:VEVENT",
    `UID:${uid}`,
    `DTSTAMP:${dtStamp}`,
    `DTSTART:${dtStart}`,
    `DTEND:${dtEnd}`,
    "SUMMARY:Log Today's Attendance — seventy-five",
    "DESCRIPTION:Keep your 75% attendance calculations accurate. Check today's classes and log attendance on seventy-five.",
    "RRULE:FREQ=DAILY;BYDAY=MO,TU,WE,TH,FR,SA",
    "STATUS:CONFIRMED",
    "BEGIN:VALARM",
    "TRIGGER:-PT5M",
    "ACTION:DISPLAY",
    "DESCRIPTION:Log Today's Attendance — seventy-five",
    "END:VALARM",
    "END:VEVENT",
    "END:VCALENDAR",
  ];

  const icsContent = icsLines.join("\r\n");
  const blob = new Blob([icsContent], { type: "text/calendar;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = "seventy-five-6pm-reminder.ics";
  a.click();
  URL.revokeObjectURL(url);
}

