// ─── Appointment ─────────────────────────────────────────────────────────────

export interface EmbeddedService {
  name: string;
  duration_minutes?: number | null;
}

export interface Appointment {
  id: string;
  barber_id: string;
  client_name: string | null;
  client_phone: string | null;
  client_email: string | null;
  service_id: string;
  barber_service_id: string | null;
  appointment_date: string;
  start_time: string;
  end_time: string;
  status: string;
  price_charged: number | null;
  payment_method: string | null;
  booking_source: string | null;
  notes: string | null;
  rent_contribution?: number | null;
  services: EmbeddedService | null;
}

/** Raw row from Supabase before normalizing embedded service arrays. */
export interface RawAppointment extends Omit<Appointment, "services"> {
  services: EmbeddedService | EmbeddedService[] | null;
}

// ─── Barber ──────────────────────────────────────────────────────────────────

export interface Barber {
  id: string;
  name: string;
  display_name: string | null;
  avatar_url: string | null;
}

// ─── Schedule ────────────────────────────────────────────────────────────────

export interface Schedule {
  barber_id: string;
  day_of_week: number;
  start_time: string;
  end_time: string;
  is_available: boolean;
}

// ─── Override (block time) ─────────────────────────────────────��─────────────

export interface Override {
  id: string;
  barber_id: string;
  override_date: string;
  is_blocked: boolean;
  start_time: string | null;
  end_time: string | null;
  reason: string | null;
  is_recurring?: boolean;
  recurrence_pattern?: "daily" | "weekly" | "monthly" | null;
  allow_online_booking?: boolean;
  recurrence_days?: number[] | null;
  /** True for generated instances of recurring blocks. */
  _virtual?: boolean;
  _source_id?: string;
  _virtual_date?: string;
}

// ─── Appointment status constants ────────────────────────────────────────────

export const APPOINTMENT_STATUS = {
  CONFIRMED: "confirmed",
  COMPLETED: "completed",
  NO_SHOW: "no_show",
  CANCELLED: "cancelled",
} as const;

export type AppointmentStatus =
  (typeof APPOINTMENT_STATUS)[keyof typeof APPOINTMENT_STATUS];

// ─── Supabase query row shapes ──────────────────────────────────────────────
// These match the exact column selections used in src/api/ and inline queries.
// Supabase embedded relations return arrays — normalize before use.

/** Row from `user_roles` table (AuthContext). */
export interface UserRoleRow {
  role: string;
  shop_id: string | null;
}

/** Barber identity row — minimal columns for auth resolution. */
export interface BarberIdentityRow {
  id: string;
  shop_id: string;
}

/** Row shape for `barbers` name-only query (WalletScreen). */
export interface BarberNameRow {
  name: string;
}

/** Row shape for appointment price-only query (WalletScreen last-week delta). */
export interface AppointmentPriceRow {
  price_charged: number | null;
}

/** Shop service row from `services` table. */
export interface ShopServiceRow {
  id: string;
  name: string;
  category: string | null;
  duration_minutes: number | null;
  display_order: number | null;
}

/** Barber service row with embedded service details. */
export interface BarberServiceRow {
  id: string;
  service_id: string;
  price: number | null;
  duration_minutes: number | null;
  is_offered: boolean;
  is_in_next_available_pool: boolean | null;
  /** Embedded relation — Supabase returns array, normalize before use. */
  services: EmbeddedService | EmbeddedService[] | null;
}

/** Busy slot row — minimal for conflict detection. */
export interface BusySlotRow {
  id: string;
  start_time: string;
  end_time: string;
  status: string;
}

/** Appointment count row — for date strip busyness indicators. */
export interface AppointmentCountRow {
  id: string;
  appointment_date: string;
}

/** History appointment row — for recent-by-client lists. */
export interface HistoryAppointmentRow {
  id: string;
  appointment_date: string;
  start_time: string;
  status: string;
  price_charged: number | null;
  /** Embedded relation — Supabase returns array, normalize before use. */
  services: { name: string } | { name: string }[] | null;
}

/** Schedule day row — for single-day availability check. */
export interface ScheduleDayRow {
  start_time: string;
  end_time: string;
  is_available: boolean;
}
