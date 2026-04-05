import type { SupabaseClient } from "@supabase/supabase-js";
import {
  calculateRentSplit,
  updateRentLedger,
  formatSplitToast,
} from "../utils/rentCalculation";

// ─── Types ───────────────────────────────────────────────────────────────────

export type PaymentMethod = "card" | "cash" | "prepaid";

export interface CheckoutRequest {
  appointmentId: string;
  paymentMethod: PaymentMethod;
  /** Override the stored price (price adjustment at checkout). */
  priceOverride?: number;
}

export interface CheckoutResult {
  success: true;
  ownerAmount: number;
  barberAmount: number;
  rentCovered: boolean;
  toastMessage: string;
  processedVia: "edge_function" | "local_fallback";
}

/** Returned when card payment needs PaymentSheet interaction before finalizing. */
export interface CheckoutNeedsPayment {
  success: true;
  needsPaymentSheet: true;
  clientSecret: string;
  paymentIntentId: string;
  appointmentId: string;
  barberId: string;
  amount: number;
}

export interface CheckoutFailure {
  success: false;
  code:
    | "APPOINTMENT_NOT_FOUND"
    | "RENT_SPLIT_FAILED"
    | "LEDGER_UPDATE_FAILED"
    | "STATUS_UPDATE_FAILED"
    | "EDGE_FUNCTION_FAILED";
  message: string;
}

export type CheckoutOutcome = CheckoutResult | CheckoutNeedsPayment | CheckoutFailure;

export interface CheckoutDeps {
  supabase: SupabaseClient;
}

export interface CheckoutEngine {
  /** Start checkout — for card, returns client_secret for PaymentSheet. For cash/prepaid, completes directly. */
  complete(req: CheckoutRequest): Promise<CheckoutOutcome>;
  /** Finalize a card payment after PaymentSheet success. */
  finalizeCard(paymentIntentId: string, appointmentId: string, barberId: string, amount: number): Promise<CheckoutOutcome>;
}

// ─── Implementation ─────────────────────────────────────────────────────────

export function createCheckoutEngine(deps: CheckoutDeps): CheckoutEngine {
  const { supabase } = deps;

  async function resolveAppointment(appointmentId: string) {
    const { data, error } = await supabase
      .from("appointments")
      .select("id, barber_id, price_charged")
      .eq("id", appointmentId)
      .maybeSingle();

    if (error || !data) return null;
    return {
      id: data.id as string,
      barberId: data.barber_id as string,
      price: Number(data.price_charged ?? 0),
    };
  }

  /** Create a PaymentIntent for card payments — returns client_secret for PaymentSheet. */
  async function createCardIntent(
    appointmentId: string,
    barberId: string,
    amount: number,
  ): Promise<CheckoutNeedsPayment | CheckoutFailure> {
    try {
      const { data, error } = await supabase.functions.invoke(
        "process-payment",
        {
          body: {
            action: "create_intent",
            appointment_id: appointmentId,
            barber_id: barberId,
            amount,
            payment_method: "card",
          },
        },
      );

      if (!error && data?.success && data.client_secret) {
        return {
          success: true,
          needsPaymentSheet: true,
          clientSecret: data.client_secret,
          paymentIntentId: data.payment_intent_id,
          appointmentId,
          barberId,
          amount,
        };
      }

      return {
        success: false,
        code: "EDGE_FUNCTION_FAILED",
        message: data?.error ?? "Could not create card payment",
      };
    } catch {
      return {
        success: false,
        code: "EDGE_FUNCTION_FAILED",
        message: "Card payment unavailable — try again or use cash",
      };
    }
  }

  /** Finalize a card payment after PaymentSheet success — rent split + transfers. */
  async function finalizeCardPayment(
    paymentIntentId: string,
    appointmentId: string,
    barberId: string,
    amount: number,
  ): Promise<CheckoutResult | CheckoutFailure> {
    try {
      const { data, error } = await supabase.functions.invoke(
        "process-payment",
        {
          body: {
            action: "finalize",
            appointment_id: appointmentId,
            barber_id: barberId,
            amount,
            payment_method: "card",
            payment_intent_id: paymentIntentId,
          },
        },
      );

      if (!error && data?.success) {
        const ownerAmount = Number(data.owner_amount ?? 0);
        const barberAmount = Number(data.barber_amount ?? 0);
        return {
          success: true,
          ownerAmount,
          barberAmount,
          rentCovered: data.rent_covered ?? false,
          toastMessage: formatSplitToast(ownerAmount, barberAmount),
          processedVia: "edge_function",
        };
      }

      return {
        success: false,
        code: "EDGE_FUNCTION_FAILED",
        message: data?.error ?? "Could not finalize payment",
      };
    } catch {
      return {
        success: false,
        code: "EDGE_FUNCTION_FAILED",
        message: "Could not finalize payment — contact support",
      };
    }
  }

  async function localComplete(
    appointmentId: string,
    barberId: string,
    price: number,
    method: PaymentMethod,
  ): Promise<CheckoutOutcome> {
    // Prepaid = money already collected elsewhere. No rent impact, no ledger update.
    // Cash = physical money, doesn't count toward rent.
    // Both just mark the appointment complete.
    if (method === "prepaid" || method === "cash") {
      const { error: updateError } = await supabase
        .from("appointments")
        .update({ status: "completed", payment_method: method })
        .eq("id", appointmentId);

      if (updateError) {
        return {
          success: false,
          code: "STATUS_UPDATE_FAILED",
          message: "Could not complete appointment",
        };
      }

      // Cash: still track in ledger for income reporting (not rent)
      if (method === "cash") {
        try {
          const { data: ledger } = await supabase
            .from("barber_rent_ledger")
            .select("id, collected_cash_reported")
            .eq("barber_id", barberId)
            .eq("status", "open")
            .limit(1)
            .maybeSingle();
          if (ledger) {
            await supabase
              .from("barber_rent_ledger")
              .update({
                collected_cash_reported: Number(ledger.collected_cash_reported ?? 0) + price,
              })
              .eq("id", ledger.id);
          }
        } catch (err) {
          // Non-critical — ledger will reconcile, but log for visibility
          console.error("[Checkout] Cash ledger update failed:", err);
        }
      }

      return {
        success: true,
        ownerAmount: 0,
        barberAmount: price,
        rentCovered: false,
        toastMessage: method === "cash"
          ? `$${price.toFixed(0)} cash — yours`
          : `$${price.toFixed(0)} prepaid — already settled`,
        processedVia: "local_fallback",
      };
    }

    // Card payments should never reach here (they go through edge function)
    // This is a safety fallback for unexpected cases
    let split;
    try {
      split = await calculateRentSplit(supabase, barberId, price);
    } catch {
      return {
        success: false,
        code: "RENT_SPLIT_FAILED",
        message: "Could not calculate rent split",
      };
    }

    const { error: updateError } = await supabase
      .from("appointments")
      .update({
        status: "completed",
        payment_method: method,
        rent_contribution: split.ownerAmount > 0 ? split.ownerAmount : null,
      })
      .eq("id", appointmentId);

    if (updateError) {
      return {
        success: false,
        code: "STATUS_UPDATE_FAILED",
        message: "Could not complete appointment",
      };
    }

    if (split.ledgerId && split.ownerAmount > 0) {
      try {
        await updateRentLedger(supabase, split.ledgerId, split.ownerAmount, method);
      } catch (err) {
        // Appointment is already marked complete — don't fail the checkout,
        // but surface a warning so the barber knows rent tracking may be off
        console.error("[Checkout] Rent ledger update failed:", err);
        return {
          success: true,
          ownerAmount: split.ownerAmount,
          barberAmount: split.barberAmount,
          rentCovered: split.rentCovered,
          toastMessage: `${formatSplitToast(split.ownerAmount, split.barberAmount)} (rent tracking may be delayed)`,
          processedVia: "local_fallback" as const,
        };
      }
    }

    return {
      success: true,
      ownerAmount: split.ownerAmount,
      barberAmount: split.barberAmount,
      rentCovered: split.rentCovered,
      toastMessage: formatSplitToast(split.ownerAmount, split.barberAmount),
      processedVia: "local_fallback",
    };
  }

  return {
    async complete(req: CheckoutRequest): Promise<CheckoutOutcome> {
      // Resolve appointment from DB
      const apt = await resolveAppointment(req.appointmentId);
      if (!apt) {
        return {
          success: false,
          code: "APPOINTMENT_NOT_FOUND",
          message: "Appointment not found",
        };
      }

      const finalPrice = req.priceOverride ?? apt.price;

      // If price was adjusted, persist it before completing
      if (req.priceOverride != null && req.priceOverride !== apt.price) {
        await supabase
          .from("appointments")
          .update({ price_charged: req.priceOverride })
          .eq("id", apt.id);
      }

      // Card payments: create PaymentIntent, return client_secret for PaymentSheet.
      // Caller must present PaymentSheet then call finalizeCard() on success.
      if (req.paymentMethod === "card") {
        return createCardIntent(apt.id, apt.barberId, finalPrice);
      }

      // Cash/prepaid: local path (no Stripe charge needed)
      return localComplete(apt.id, apt.barberId, finalPrice, req.paymentMethod);
    },

    async finalizeCard(
      paymentIntentId: string,
      appointmentId: string,
      barberId: string,
      amount: number,
    ): Promise<CheckoutOutcome> {
      return finalizeCardPayment(paymentIntentId, appointmentId, barberId, amount);
    },
  };
}
