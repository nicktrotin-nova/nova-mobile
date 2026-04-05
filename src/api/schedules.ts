import type { SupabaseClient } from "@supabase/supabase-js";

const SCHEDULE_SELECT = "barber_id, day_of_week, start_time, end_time, is_available";

/** Fetch all weekly schedules for one or more barbers. */
export async function fetchSchedules(
  supabase: SupabaseClient,
  opts: { barberIds: string[] },
) {
  return supabase
    .from("availability_schedules")
    .select(SCHEDULE_SELECT)
    .in("barber_id", opts.barberIds);
}

/** Fetch schedule for a specific barber on a specific day of week (available only). */
export async function fetchScheduleForDay(
  supabase: SupabaseClient,
  opts: { barberId: string; dayOfWeek: number },
) {
  return supabase
    .from("availability_schedules")
    .select("start_time, end_time, is_available")
    .eq("barber_id", opts.barberId)
    .eq("day_of_week", opts.dayOfWeek)
    .eq("is_available", true)
    .maybeSingle();
}

/** Fetch non-recurring overrides in a date range. */
export async function fetchOverridesInRange(
  supabase: SupabaseClient,
  opts: { barberIds: string[]; dateFrom: string; dateTo: string },
) {
  return supabase
    .from("availability_overrides")
    .select("*")
    .in("barber_id", opts.barberIds)
    .gte("override_date", opts.dateFrom)
    .lte("override_date", opts.dateTo)
    .or("is_recurring.is.null,is_recurring.eq.false");
}

/** Fetch recurring overrides that started on or before dateEnd. */
export async function fetchRecurringOverrides(
  supabase: SupabaseClient,
  opts: { barberIds: string[]; dateTo: string },
) {
  return supabase
    .from("availability_overrides")
    .select("*")
    .in("barber_id", opts.barberIds)
    .eq("is_recurring", true)
    .lte("override_date", opts.dateTo);
}
