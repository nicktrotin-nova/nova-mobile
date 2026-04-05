import {
  createCheckoutEngine,
  CheckoutResult,
  CheckoutNeedsPayment,
  CheckoutFailure,
  CheckoutOutcome,
} from "../checkout";

// ─── Mock Supabase builder ──────────────────────────────────────────────────

interface MockConfig {
  /** Appointment to return from appointments table lookup */
  appointment?: { id: string; barber_id: string; price_charged: number } | null;
  /** Ledger row for rent calculation */
  ledger?: { id: string; rent_due: number; collected_digital: number; collected_cash_reported: number } | null;
  /** Whether the appointment update should fail */
  updateFails?: boolean;
  /** Edge function response */
  edgeFnResponse?: { data: any; error: any } | "throw";
}

function buildMockSupabase(config: MockConfig) {
  const updateCalls: { table: string; values: any }[] = [];
  const invokeCalls: { fn: string; body: any }[] = [];

  function createChain(tableName: string) {
    const chain: any = {};

    chain.select = () => chain;
    chain.eq = () => chain;
    chain.limit = () => chain;
    chain.maybeSingle = () => {
      if (tableName === "appointments") {
        return Promise.resolve({ data: config.appointment ?? null, error: null });
      }
      if (tableName === "barber_rent_ledger") {
        return Promise.resolve({ data: config.ledger ?? null, error: null });
      }
      return Promise.resolve({ data: null, error: null });
    };
    chain.update = (values: any) => {
      updateCalls.push({ table: tableName, values });
      const errorResult = config.updateFails && tableName === "appointments"
        ? { error: { message: "update failed" } }
        : { error: null };
      const updateChain: any = {
        eq: () => updateChain,
        then: (resolve: any) => resolve(errorResult),
      };
      return updateChain;
    };

    return chain;
  }

  const client = {
    from: (table: string) => createChain(table),
    functions: {
      invoke: (fn: string, opts: { body: any }) => {
        invokeCalls.push({ fn, body: opts.body });
        if (config.edgeFnResponse === "throw") {
          return Promise.reject(new Error("network error"));
        }
        if (config.edgeFnResponse) {
          return Promise.resolve(config.edgeFnResponse);
        }
        // Default: edge function not configured
        return Promise.resolve({ data: null, error: { message: "not found" } });
      },
    },
    _updateCalls: updateCalls,
    _invokeCalls: invokeCalls,
  };

  return client as any;
}

// ─── Factory ────────────────────────────────────────────────────────────────

describe("createCheckoutEngine", () => {
  it("returns an object with complete and finalizeCard methods", () => {
    const supabase = buildMockSupabase({});
    const engine = createCheckoutEngine({ supabase });
    expect(typeof engine.complete).toBe("function");
    expect(typeof engine.finalizeCard).toBe("function");
  });
});

// ─── Cash checkout ──────────────────────────────────────────────────────────

describe("checkout — cash", () => {
  it("completes successfully with all money to barber", async () => {
    const supabase = buildMockSupabase({
      appointment: { id: "apt-1", barber_id: "b-1", price_charged: 45 },
      ledger: { id: "led1", rent_due: 500, collected_digital: 200, collected_cash_reported: 0 },
    });
    const engine = createCheckoutEngine({ supabase });

    const result = await engine.complete({
      appointmentId: "apt-1",
      paymentMethod: "cash",
    });

    expect(result.success).toBe(true);
    const r = result as CheckoutResult;
    expect(r.ownerAmount).toBe(0);
    expect(r.barberAmount).toBe(45);
    expect(r.processedVia).toBe("local_fallback");
    expect(r.toastMessage).toContain("cash");
    expect(r.toastMessage).toContain("yours");
  });

  it("tracks cash in ledger for income reporting", async () => {
    const supabase = buildMockSupabase({
      appointment: { id: "apt-1", barber_id: "b-1", price_charged: 45 },
      ledger: { id: "led1", rent_due: 500, collected_digital: 200, collected_cash_reported: 100 },
    });
    const engine = createCheckoutEngine({ supabase });

    await engine.complete({
      appointmentId: "apt-1",
      paymentMethod: "cash",
    });

    // Should have updated the ledger with cash amount
    const ledgerUpdate = supabase._updateCalls.find(
      (c: any) => c.table === "barber_rent_ledger",
    );
    expect(ledgerUpdate).toBeDefined();
    expect(ledgerUpdate.values.collected_cash_reported).toBe(145); // 100 + 45
  });

  it("marks appointment as completed with cash method", async () => {
    const supabase = buildMockSupabase({
      appointment: { id: "apt-1", barber_id: "b-1", price_charged: 45 },
    });
    const engine = createCheckoutEngine({ supabase });

    await engine.complete({
      appointmentId: "apt-1",
      paymentMethod: "cash",
    });

    const aptUpdate = supabase._updateCalls.find(
      (c: any) => c.table === "appointments",
    );
    expect(aptUpdate).toBeDefined();
    expect(aptUpdate.values.status).toBe("completed");
    expect(aptUpdate.values.payment_method).toBe("cash");
  });
});

// ─── Prepaid checkout ───────────────────────────────────────────────────────

describe("checkout — prepaid", () => {
  it("completes with all money to barber and 'already settled' message", async () => {
    const supabase = buildMockSupabase({
      appointment: { id: "apt-1", barber_id: "b-1", price_charged: 60 },
    });
    const engine = createCheckoutEngine({ supabase });

    const result = await engine.complete({
      appointmentId: "apt-1",
      paymentMethod: "prepaid",
    });

    expect(result.success).toBe(true);
    const r = result as CheckoutResult;
    expect(r.ownerAmount).toBe(0);
    expect(r.barberAmount).toBe(60);
    expect(r.toastMessage).toContain("prepaid");
    expect(r.toastMessage).toContain("already settled");
  });

  it("does NOT update rent ledger for prepaid", async () => {
    const supabase = buildMockSupabase({
      appointment: { id: "apt-1", barber_id: "b-1", price_charged: 60 },
      ledger: { id: "led1", rent_due: 500, collected_digital: 200, collected_cash_reported: 0 },
    });
    const engine = createCheckoutEngine({ supabase });

    await engine.complete({
      appointmentId: "apt-1",
      paymentMethod: "prepaid",
    });

    // Only the appointment should be updated, not the ledger
    const ledgerUpdate = supabase._updateCalls.find(
      (c: any) => c.table === "barber_rent_ledger",
    );
    expect(ledgerUpdate).toBeUndefined();
  });
});

// ─── Card checkout ──────────────────────────────────────────────────────────

describe("checkout — card", () => {
  it("calls edge function and returns needsPaymentSheet with client_secret", async () => {
    const supabase = buildMockSupabase({
      appointment: { id: "apt-1", barber_id: "b-1", price_charged: 45 },
      edgeFnResponse: {
        data: {
          success: true,
          client_secret: "pi_secret_123",
          payment_intent_id: "pi_123",
        },
        error: null,
      },
    });
    const engine = createCheckoutEngine({ supabase });

    const result = await engine.complete({
      appointmentId: "apt-1",
      paymentMethod: "card",
    });

    expect(result.success).toBe(true);
    const r = result as CheckoutNeedsPayment;
    expect(r.needsPaymentSheet).toBe(true);
    expect(r.clientSecret).toBe("pi_secret_123");
    expect(r.paymentIntentId).toBe("pi_123");
    expect(r.amount).toBe(45);
  });

  it("returns EDGE_FUNCTION_FAILED when edge function errors", async () => {
    const supabase = buildMockSupabase({
      appointment: { id: "apt-1", barber_id: "b-1", price_charged: 45 },
      edgeFnResponse: { data: null, error: { message: "server error" } },
    });
    const engine = createCheckoutEngine({ supabase });

    const result = await engine.complete({
      appointmentId: "apt-1",
      paymentMethod: "card",
    });

    expect(result.success).toBe(false);
    expect((result as CheckoutFailure).code).toBe("EDGE_FUNCTION_FAILED");
  });

  it("returns EDGE_FUNCTION_FAILED when edge function throws", async () => {
    const supabase = buildMockSupabase({
      appointment: { id: "apt-1", barber_id: "b-1", price_charged: 45 },
      edgeFnResponse: "throw",
    });
    const engine = createCheckoutEngine({ supabase });

    const result = await engine.complete({
      appointmentId: "apt-1",
      paymentMethod: "card",
    });

    expect(result.success).toBe(false);
    expect((result as CheckoutFailure).code).toBe("EDGE_FUNCTION_FAILED");
    expect((result as CheckoutFailure).message).toContain("cash");
  });
});

// ─── finalizeCard ───────────────────────────────────────────────────────────

describe("finalizeCard", () => {
  it("calls edge function with finalize action and returns rent split", async () => {
    const supabase = buildMockSupabase({
      edgeFnResponse: {
        data: {
          success: true,
          owner_amount: 30,
          barber_amount: 15,
          rent_covered: false,
        },
        error: null,
      },
    });
    const engine = createCheckoutEngine({ supabase });

    const result = await engine.finalizeCard("pi_123", "apt-1", "b-1", 45);

    expect(result.success).toBe(true);
    const r = result as CheckoutResult;
    expect(r.ownerAmount).toBe(30);
    expect(r.barberAmount).toBe(15);
    expect(r.rentCovered).toBe(false);
    expect(r.processedVia).toBe("edge_function");
    expect(r.toastMessage).toContain("owner");

    // Verify edge function was called with correct body
    expect(supabase._invokeCalls[0].body.action).toBe("finalize");
    expect(supabase._invokeCalls[0].body.payment_intent_id).toBe("pi_123");
  });

  it("returns failure when finalize edge function errors", async () => {
    const supabase = buildMockSupabase({
      edgeFnResponse: "throw",
    });
    const engine = createCheckoutEngine({ supabase });

    const result = await engine.finalizeCard("pi_123", "apt-1", "b-1", 45);

    expect(result.success).toBe(false);
    expect((result as CheckoutFailure).code).toBe("EDGE_FUNCTION_FAILED");
  });
});

// ─── Appointment not found ──────────────────────────────────────────────────

describe("checkout — appointment not found", () => {
  it("returns APPOINTMENT_NOT_FOUND error", async () => {
    const supabase = buildMockSupabase({
      appointment: null,
    });
    const engine = createCheckoutEngine({ supabase });

    const result = await engine.complete({
      appointmentId: "nonexistent",
      paymentMethod: "cash",
    });

    expect(result.success).toBe(false);
    expect((result as CheckoutFailure).code).toBe("APPOINTMENT_NOT_FOUND");
  });
});

// ─── Price override ─────────────────────────────────────────────────────────

describe("checkout — priceOverride", () => {
  it("uses overridden price instead of stored price for cash", async () => {
    const supabase = buildMockSupabase({
      appointment: { id: "apt-1", barber_id: "b-1", price_charged: 45 },
    });
    const engine = createCheckoutEngine({ supabase });

    const result = await engine.complete({
      appointmentId: "apt-1",
      paymentMethod: "cash",
      priceOverride: 55,
    });

    expect(result.success).toBe(true);
    const r = result as CheckoutResult;
    expect(r.barberAmount).toBe(55); // uses override, not 45

    // Should persist the price override
    const priceUpdate = supabase._updateCalls.find(
      (c: any) => c.table === "appointments" && c.values.price_charged != null,
    );
    expect(priceUpdate).toBeDefined();
    expect(priceUpdate.values.price_charged).toBe(55);
  });

  it("does NOT persist price when override matches stored price", async () => {
    const supabase = buildMockSupabase({
      appointment: { id: "apt-1", barber_id: "b-1", price_charged: 45 },
    });
    const engine = createCheckoutEngine({ supabase });

    await engine.complete({
      appointmentId: "apt-1",
      paymentMethod: "cash",
      priceOverride: 45,
    });

    // Should not have a price_charged update (only status update)
    const priceUpdate = supabase._updateCalls.find(
      (c: any) => c.table === "appointments" && c.values.price_charged != null,
    );
    expect(priceUpdate).toBeUndefined();
  });

  it("uses overridden price for card edge function call", async () => {
    const supabase = buildMockSupabase({
      appointment: { id: "apt-1", barber_id: "b-1", price_charged: 45 },
      edgeFnResponse: {
        data: {
          success: true,
          client_secret: "pi_secret_123",
          payment_intent_id: "pi_123",
        },
        error: null,
      },
    });
    const engine = createCheckoutEngine({ supabase });

    const result = await engine.complete({
      appointmentId: "apt-1",
      paymentMethod: "card",
      priceOverride: 60,
    });

    expect(result.success).toBe(true);
    const r = result as CheckoutNeedsPayment;
    expect(r.amount).toBe(60);

    // Edge function should receive the overridden amount
    expect(supabase._invokeCalls[0].body.amount).toBe(60);
  });
});

// ─── Status update failure ──────────────────────────────────────────────────

describe("checkout — status update failure", () => {
  it("returns STATUS_UPDATE_FAILED when appointment update fails", async () => {
    const supabase = buildMockSupabase({
      appointment: { id: "apt-1", barber_id: "b-1", price_charged: 45 },
      updateFails: true,
    });
    const engine = createCheckoutEngine({ supabase });

    const result = await engine.complete({
      appointmentId: "apt-1",
      paymentMethod: "cash",
    });

    expect(result.success).toBe(false);
    expect((result as CheckoutFailure).code).toBe("STATUS_UPDATE_FAILED");
  });
});
