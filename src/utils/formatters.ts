import { format } from "date-fns";

// ─── Time ────────────────────────────────────────────────────────────────────

/** Convert "HH:MM:SS" or "HH:MM" to total minutes. */
export function timeToMinutes(t: string): number {
  const [h, m] = t.slice(0, 5).split(":").map(Number);
  return h * 60 + m;
}

/** Convert total minutes back to "HH:MM:00". */
export function minutesToTime(m: number): string {
  const h = Math.floor(m / 60) % 24;
  const mm = m % 60;
  return `${String(h).padStart(2, "0")}:${String(mm).padStart(2, "0")}:00`;
}

/** Format "HH:MM:SS" or "HH:MM" to 12-hour display ("2:30 PM"). */
export function formatTime12(timeStr: string | null): string {
  if (!timeStr) return "";
  const base =
    timeStr.length >= 8
      ? timeStr.slice(0, 8)
      : timeStr.length === 5
        ? `${timeStr}:00`
        : timeStr;
  try {
    return format(new Date(`2000-01-01T${base}`), "h:mm a");
  } catch {
    return timeStr;
  }
}

/** Compact 12-hour format without minutes when on the hour: "9am", "2:30pm". */
export function formatTime12Compact(timeStr: string): string {
  const [h, m] = timeStr.slice(0, 5).split(":").map(Number);
  const period = h >= 12 ? "pm" : "am";
  const hour = h % 12 || 12;
  return m === 0
    ? `${hour}${period}`
    : `${hour}:${m.toString().padStart(2, "0")}${period}`;
}

/** Add minutes to an "HH:MM" time string. Returns "HH:MM". */
export function addMinutesToTime(timeStr: string, mins: number): string {
  const total = timeToMinutes(timeStr) + mins;
  const h = Math.floor(total / 60) % 24;
  const m = total % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

// ─── Service normalization ──────────────────────────────────────────────────

/** Supabase embedded relations sometimes return arrays. Normalize to single object or null. */
export function normalizeService<T>(s: T | T[] | null | undefined): T | null {
  if (s == null) return null;
  if (Array.isArray(s)) return s[0] ?? null;
  return s;
}

// ─── Status normalization ───────────────────────────────────────────────────

/** Normalize legacy "noshow" to "no_show". */
export function normalizeStatus(status: string): string {
  return status === "noshow" ? "no_show" : status;
}

// ─── Client display ─────────────────────────────────────────────────────────

/** Full display name from first/last, falling back to "Client". */
export function clientDisplayName(
  first: string | null | undefined,
  last: string | null | undefined,
): string {
  const fn = (first ?? "").trim();
  const ln = (last ?? "").trim();
  return [fn, ln].filter(Boolean).join(" ") || "Client";
}

/** Two-letter initials from first/last, falling back to "?". */
export function clientInitials(
  first: string | null | undefined,
  last: string | null | undefined,
): string {
  const f = (first ?? "").trim()[0] ?? "";
  const l = (last ?? "").trim()[0] ?? "";
  return (f + l).toUpperCase() || "?";
}
