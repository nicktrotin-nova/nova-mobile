import { format } from "date-fns";
import { colors } from "../../theme/colors";
import { normalizeStatus, normalizeService, formatTime12 } from "../../utils/formatters";
import type { Appointment, Barber, Override } from "../../types/domain";

// ── Calendar colour map (aliases into shared theme) ─────────────────────────
export const COLORS = {
  abyss: colors.obsidian950,
  deep: colors.obsidian900,
  ocean: colors.obsidian800,
  novaGold: colors.nova500,
  steel: colors.textPrimary,
  now: colors.now,
  mist: colors.textSecondary,
  slate: colors.textTertiary,
  warmBg: colors.calendarBody,
  unavailable: colors.calendarUnavailable,
  white: colors.white,
  cardBorder: colors.black06,
  blockBg: colors.calendarBlockBg,
  red: colors.error,
  amber: colors.warning,
};

// ── Feature flags ───────────────────────────────────────────────────────────
export const SHOW_DATE_BUSYNESS = true;

// ── Grid constants ──────────────────────────────────────────────────────────
export const GRID_START = 5;
export const GRID_END = 22;
export const DATE_STRIP_LEN = 28;
export const DATE_PAST_DAYS = 0;
export const TEAM_ITEM_APPROX_WIDTH = 84;
export const DATE_CHIP_APPROX_WIDTH = 56;
export const GUTTER_W = 48;

// ── AsyncStorage keys ───────────────────────────────────────────────────────
export const ZOOM_KEY = "nova_calendar_zoom";
export const SLOT_KEY = "nova_slot_size";
export const CELEBRATED_KEY = "nova_fully_booked_celebrated";

// ── Types ───────────────────────────────────────────────────────────────────
export interface AptLayout extends Appointment {
  startMin: number;
  endMin: number;
  col: number;
  colCount: number;
  showOverlapDot: boolean;
}

export interface BlockLayout extends Override {
  startMin: number;
  endMin: number;
}

// ── Helper functions ────────────────────────────────────────────────────────

/** Supabase embed often types `services` as an array; runtime is usually a single object. */
export function mapAppointmentRow(row: unknown): Appointment {
  const r = row as Appointment & {
    services?: { name: string } | { name: string }[] | null;
  };
  return {
    ...r,
    status: normalizeStatus(r.status),
    services: normalizeService(r.services),
  };
}

export function formatTimeRange12Short(start: string, end: string): string {
  const stripAmPm = (s: string) => s.replace(/\s*(AM|PM|am|pm)\s*$/i, "").trim();
  const s = stripAmPm(formatTime12(start));
  const e = stripAmPm(formatTime12(end));
  return `${s} - ${e}`;
}

export function hourLineLabel(hour24: number): string {
  if (hour24 === 21) return "10 PM";
  return format(new Date(2000, 0, 1, hour24, 0, 0), "h a");
}

export function iToHourTop(i: number, hourHeight: number): number {
  return i * hourHeight + 2;
}

export function firstName(b: Barber): string {
  const raw = b.display_name?.trim() || b.name.trim();
  return raw.split(/\s+/)[0] || raw;
}
