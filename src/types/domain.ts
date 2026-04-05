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
