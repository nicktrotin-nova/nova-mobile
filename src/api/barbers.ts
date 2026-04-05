import type { SupabaseClient } from "@supabase/supabase-js";

/** Fetch active barbers for a shop (calendar team strip, owner glance). */
export async function fetchShopBarbers(
  supabase: SupabaseClient,
  opts: { shopId: string },
) {
  return supabase
    .from("barbers")
    .select("id, name, display_name, avatar_url")
    .eq("shop_id", opts.shopId)
    .eq("status", "active")
    .order("sort_order", { ascending: true });
}

/** Fetch active shop services (walk-in, booking sheet service pickers). */
export async function fetchShopServices(
  supabase: SupabaseClient,
  opts: { shopId: string },
) {
  return supabase
    .from("services")
    .select("id, name, category, duration_minutes, display_order")
    .eq("shop_id", opts.shopId)
    .eq("is_active", true)
    .order("display_order", { ascending: true });
}

/** Fetch barber's offered services with embedded service details. */
export async function fetchBarberServices(
  supabase: SupabaseClient,
  opts: { barberId: string },
) {
  return supabase
    .from("barber_services")
    .select("id, service_id, price, duration_minutes, is_offered, is_in_next_available_pool, services(name, duration_minutes)")
    .eq("barber_id", opts.barberId)
    .eq("is_offered", true);
}
