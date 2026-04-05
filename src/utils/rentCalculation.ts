import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Rent-first payment routing: 100% goes to owner until rent is covered,
 * then 100% goes to barber. The split on each appointment is based on
 * how much rent is STILL OWED, not a flat daily prorate.
 *
 * IMPORTANT: Only digital (card/prepaid) payments count toward rent.
 * Cash is tracked separately for income reporting but does NOT reduce
 * the barber's rent obligation.
 */

export interface RentSplit {
  /** Amount from this payment that goes toward rent (to owner) */
  ownerAmount: number;
  /** Amount from this payment that goes to the barber */
  barberAmount: number;
  /** Total rent remaining BEFORE this payment */
  rentRemaining: number;
  /** Whether rent is fully covered after this payment */
  rentCovered: boolean;
  /** Ledger row ID for updating */
  ledgerId: string | null;
}

export interface RentStatus {
  rentDue: number;
  /** Digital payments collected (counts toward rent) */
  collectedDigital: number;
  /** Cash reported (income only, does NOT count toward rent) */
  collectedCash: number;
  remaining: number;
  takeHome: number;
  percentage: number;
  rentCovered: boolean;
}

interface LedgerRow {
  id: string;
  rent_due: number | null;
  collected_digital: number | null;
  collected_cash_reported: number | null;
}

interface LeaseRow {
  rent_amount: number | null;
}

/**
 * Fetch the current rent status for a barber's open cycle.
 * Only digital payments count toward rent progress.
 */
export async function fetchRentStatus(
  supabase: SupabaseClient,
  barberId: string,
): Promise<RentStatus> {
  const [{ data: ledger }, { data: lease }] = await Promise.all([
    supabase
      .from("barber_rent_ledger")
      .select("id, rent_due, collected_digital, collected_cash_reported")
      .eq("barber_id", barberId)
      .eq("status", "open")
      .limit(1)
      .maybeSingle(),
    supabase
      .from("booth_leases")
      .select("rent_amount")
      .eq("barber_id", barberId)
      .eq("status", "active")
      .limit(1)
      .maybeSingle(),
  ]);

  const row = ledger as LedgerRow | null;
  const leaseRow = lease as LeaseRow | null;
  const rentDue = Number(leaseRow?.rent_amount ?? row?.rent_due ?? 0);
  const collectedDigital = Number(row?.collected_digital ?? 0);
  const collectedCash = Number(row?.collected_cash_reported ?? 0);
  // Only digital counts toward rent
  const remaining = Math.max(0, rentDue - collectedDigital);
  const digitalTakeHome = Math.max(0, collectedDigital - rentDue);
  // Cash is always the barber's — plus whatever digital exceeds rent
  const takeHome = collectedCash + digitalTakeHome;
  const percentage = rentDue > 0 ? Math.min(1, collectedDigital / rentDue) : 0;

  return {
    rentDue,
    collectedDigital,
    collectedCash,
    remaining,
    takeHome,
    percentage: Math.round(percentage * 100),
    rentCovered: remaining <= 0 && rentDue > 0,
  };
}

/**
 * Calculate rent split for a single appointment payment.
 * This is the core rent-first routing: owner gets what's still owed,
 * barber gets the rest.
 *
 * Only digital (card/prepaid) payments count toward rent.
 * Cash payments should NOT call this — they bypass rent routing entirely.
 */
export async function calculateRentSplit(
  supabase: SupabaseClient,
  barberId: string,
  paymentAmount: number,
): Promise<RentSplit> {
  const { data: ledger } = await supabase
    .from("barber_rent_ledger")
    .select("id, rent_due, collected_digital, collected_cash_reported")
    .eq("barber_id", barberId)
    .eq("status", "open")
    .limit(1)
    .maybeSingle();

  const row = ledger as LedgerRow | null;
  if (!row) {
    return {
      ownerAmount: 0,
      barberAmount: paymentAmount,
      rentRemaining: 0,
      rentCovered: true,
      ledgerId: null,
    };
  }

  // Only digital payments count toward rent — cash is excluded
  const digitalCollected = Number(row.collected_digital ?? 0);
  const rentDue = Number(row.rent_due ?? 0);
  const rentRemaining = Math.max(0, rentDue - digitalCollected);

  const ownerAmount = Math.min(rentRemaining, paymentAmount);
  const barberAmount = Math.max(0, paymentAmount - ownerAmount);

  return {
    ownerAmount,
    barberAmount,
    rentRemaining,
    rentCovered: rentRemaining - ownerAmount <= 0,
    ledgerId: row.id,
  };
}

/**
 * Update the rent ledger after a payment. Call after completing an appointment.
 */
export async function updateRentLedger(
  supabase: SupabaseClient,
  ledgerId: string,
  amount: number,
  method: "card" | "cash" | "prepaid",
): Promise<void> {
  const { data: ledger } = await supabase
    .from("barber_rent_ledger")
    .select("collected_digital, collected_cash_reported")
    .eq("id", ledgerId)
    .maybeSingle();

  const row = ledger as {
    collected_digital: number | null;
    collected_cash_reported: number | null;
  } | null;

  if (!row) return;

  if (method === "cash") {
    await supabase
      .from("barber_rent_ledger")
      .update({
        collected_cash_reported: Number(row.collected_cash_reported ?? 0) + amount,
      })
      .eq("id", ledgerId);
  } else {
    await supabase
      .from("barber_rent_ledger")
      .update({
        collected_digital: Number(row.collected_digital ?? 0) + amount,
      })
      .eq("id", ledgerId);
  }
}

/**
 * Format a rent split into a human-readable toast message.
 */
export function formatSplitToast(ownerAmt: number, barberAmt: number): string {
  if (ownerAmt > 0 && barberAmt === 0) {
    return `Rent: $${ownerAmt.toFixed(0)} → owner · $0 yours`;
  }
  if (ownerAmt === 0) {
    return `$0 rent · $${barberAmt.toFixed(0)} yours`;
  }
  return `Rent: $${ownerAmt.toFixed(0)} → owner · $${barberAmt.toFixed(0)} yours`;
}
