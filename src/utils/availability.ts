import { timeToMinutes, minutesToTime } from "./formatters";

// ─── Types ───────────────────────────────────────────────────────────────────

export interface BusySlot {
  startMin: number;
  endMin: number;
}

// ─── Core ────────────────────────────────────────────────────────────────────

/** Check if two time ranges overlap (exclusive endpoints). */
export function overlaps(
  aStart: number,
  aEnd: number,
  bStart: number,
  bEnd: number,
): boolean {
  return aStart < bEnd && bStart < aEnd;
}

/**
 * Generate available time slots given a work window and busy periods.
 * Returns "HH:MM" strings (e.g. "09:00", "09:15").
 *
 * @param workStart - schedule start time, "HH:MM:SS" or "HH:MM"
 * @param workEnd   - schedule end time
 * @param durationMin - appointment duration in minutes
 * @param busy      - array of busy periods in minutes
 * @param stepMin   - slot increment (default 15)
 * @param earliestMin - optional floor (e.g. current time + buffer for walk-ins)
 */
export function generateSlots(
  workStart: string,
  workEnd: string,
  durationMin: number,
  busy: BusySlot[],
  stepMin = 15,
  earliestMin?: number,
): string[] {
  const ws = Math.max(timeToMinutes(workStart), earliestMin ?? 0);
  const we = timeToMinutes(workEnd);
  const slots: string[] = [];

  for (let m = ws; m + durationMin <= we; m += stepMin) {
    const endM = m + durationMin;
    const isFree = !busy.some((b) => overlaps(m, endM, b.startMin, b.endMin));
    if (isFree) {
      slots.push(minutesToTime(m).slice(0, 5));
    }
  }

  return slots;
}

/**
 * Convert raw appointment rows into BusySlot array for slot generation.
 * Filters out cancelled appointments.
 */
export function toBusySlots(
  appts: { start_time: string; end_time: string; status?: string; id?: string }[],
  excludeId?: string,
): BusySlot[] {
  return appts
    .filter((a) => a.id !== excludeId)
    .map((a) => ({
      startMin: timeToMinutes(a.start_time),
      endMin: timeToMinutes(a.end_time),
    }));
}
