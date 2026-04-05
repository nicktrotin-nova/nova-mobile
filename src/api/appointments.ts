import type { SupabaseClient } from "@supabase/supabase-js";
// Row shapes for callers to cast results: RawAppointment, BusySlotRow,
// HistoryAppointmentRow, AppointmentCountRow (see ../types/domain.ts)

// ─── Select shapes ──────────────────────────────────────────────────────────

/** Full appointment with embedded service name — used by Calendar, MyDay. */
const FULL_SELECT = `
  id, barber_id, client_name, client_phone, client_email, service_id,
  barber_service_id, appointment_date, start_time, end_time, status,
  price_charged, payment_method, booking_source, notes, rent_contribution,
  services!appointments_service_id_fkey(name, duration_minutes)
`;

/** Minimal appointment for slot conflict checks. */
const BUSY_SELECT = "id, start_time, end_time, status";

/** Appointment with service name for history lists. */
const HISTORY_SELECT = `
  id, appointment_date, start_time, status, price_charged,
  services!appointments_service_id_fkey(name)
`;

// ─── Queries ────────────────────────────────────────────────────────────────

/** Fetch all non-cancelled appointments for a barber on a specific date. */
export async function fetchDayAppointments(
  supabase: SupabaseClient,
  opts: { barberId: string; date: string },
) {
  return supabase
    .from("appointments")
    .select(FULL_SELECT)
    .eq("barber_id", opts.barberId)
    .eq("appointment_date", opts.date)
    .in("status", ["confirmed", "completed", "no_show"])
    .order("start_time", { ascending: true });
}

/** Fetch all non-cancelled appointments for a shop on a date (all barbers). */
export async function fetchShopDayAppointments(
  supabase: SupabaseClient,
  opts: { shopId: string; date: string },
) {
  return supabase
    .from("appointments")
    .select(FULL_SELECT)
    .eq("shop_id", opts.shopId)
    .eq("appointment_date", opts.date)
    .neq("status", "cancelled")
    .order("start_time", { ascending: true });
}

/** Fetch busy time slots for conflict detection (reschedule / new booking). */
export async function fetchBusySlots(
  supabase: SupabaseClient,
  opts: { shopId: string; barberId: string; date: string },
) {
  return supabase
    .from("appointments")
    .select(BUSY_SELECT)
    .eq("shop_id", opts.shopId)
    .eq("barber_id", opts.barberId)
    .eq("appointment_date", opts.date)
    .neq("status", "cancelled");
}

/** Fetch completed appointments in a date range (wallet, owner revenue). */
export async function fetchCompletedInRange(
  supabase: SupabaseClient,
  opts: { barberId: string; dateFrom: string; dateTo: string },
) {
  return supabase
    .from("appointments")
    .select(FULL_SELECT)
    .eq("barber_id", opts.barberId)
    .eq("status", "completed")
    .gte("appointment_date", opts.dateFrom)
    .lte("appointment_date", opts.dateTo)
    .order("appointment_date", { ascending: false });
}

/** Fetch recent appointments for a specific client (detail modal). */
export async function fetchRecentByClient(
  supabase: SupabaseClient,
  opts: { clientId: string; barberId: string; limit?: number },
) {
  return supabase
    .from("appointments")
    .select(HISTORY_SELECT)
    .eq("client_id", opts.clientId)
    .eq("barber_id", opts.barberId)
    .order("appointment_date", { ascending: false })
    .limit(opts.limit ?? 10);
}

/** Fetch appointment counts by date for the date strip busyness indicators. */
export async function fetchAppointmentCounts(
  supabase: SupabaseClient,
  opts: { shopId: string; barberId: string; dateFrom: string; dateTo: string },
) {
  return supabase
    .from("appointments")
    .select("id, appointment_date")
    .eq("shop_id", opts.shopId)
    .eq("barber_id", opts.barberId)
    .gte("appointment_date", opts.dateFrom)
    .lte("appointment_date", opts.dateTo)
    .neq("status", "cancelled");
}
