import {
  fetchRentStatus,
  calculateRentSplit,
  updateRentLedger,
  formatSplitToast,
} from "../rentCalculation";

// ─── Helpers to build mock Supabase client ──────────────────────────────────

type QueryResult = { data: unknown; error?: unknown };

/**
 * Build a mock SupabaseClient that intercepts .from() queries.
 * tableResponses maps table name to the { data } that maybeSingle() returns.
 */
function mockSupabase(tableResponses: Record<string, QueryResult>) {
  const updateCalls: { table: string; values: unknown; eqFilters: [string, string][] }[] = [];

  function createChain(tableName: string) {
    let eqFilters: [string, string][] = [];

    const chain: Record<string, unknown> = {
      select: () => chain,
      eq: (col: string, val: string) => {
        eqFilters.push([col, val]);
        return chain;
      },
      limit: () => chain,
      maybeSingle: () => {
        const response = tableResponses[tableName];
        return Promise.resolve(response ?? { data: null });
      },
      update: (values: unknown) => {
        const updateEntry = { table: tableName, values, eqFilters: [] as [string, string][] };
        updateCalls.push(updateEntry);
        // Return a new chain that captures eq filters for the update
        const updateChain: Record<string, unknown> = {
          eq: (col: string, val: string) => {
            updateEntry.eqFilters.push([col, val]);
            return updateChain;
          },
        };
        // Also resolve as a promise for await
        (updateChain as any).then = (resolve: (v: unknown) => void) =>
          resolve({ error: null });
        return updateChain;
      },
    };

    return chain;
  }

  const client = {
    from: (table: string) => createChain(table),
    _updateCalls: updateCalls,
  };

  return client as any;
}

// ─── formatSplitToast (pure function, no mocks) ────────────────────────────

describe("formatSplitToast", () => {
  it("shows all-to-owner when barber gets nothing", () => {
    expect(formatSplitToast(45, 0)).toBe("Rent: $45 → owner · $0 yours");
  });

  it("shows all-to-barber when rent is covered", () => {
    expect(formatSplitToast(0, 45)).toBe("$0 rent · $45 yours");
  });

  it("shows split when payment spans the boundary", () => {
    expect(formatSplitToast(20, 25)).toBe("Rent: $20 → owner · $25 yours");
  });

  it("handles zero for both (edge case)", () => {
    expect(formatSplitToast(0, 0)).toBe("$0 rent · $0 yours");
  });
});

// ─── fetchRentStatus ────────────────────────────────────────────────────────

describe("fetchRentStatus", () => {
  it("returns correct status when rent is partially paid", async () => {
    const supabase = mockSupabase({
      barber_rent_ledger: {
        data: { id: "led1", rent_due: 500, collected_digital: 200, collected_cash_reported: 100 },
      },
      booth_leases: {
        data: { rent_amount: 500 },
      },
    });

    const status = await fetchRentStatus(supabase, "barber-1");

    expect(status.rentDue).toBe(500);
    expect(status.collectedDigital).toBe(200);
    expect(status.collectedCash).toBe(100);
    expect(status.remaining).toBe(300); // 500 - 200 (only digital counts)
    expect(status.takeHome).toBe(100); // cash only (digital hasn't exceeded rent)
    expect(status.percentage).toBe(40); // 200/500 = 40%
    expect(status.rentCovered).toBe(false);
  });

  it("returns rentCovered=true when digital payments meet rent", async () => {
    const supabase = mockSupabase({
      barber_rent_ledger: {
        data: { id: "led1", rent_due: 500, collected_digital: 500, collected_cash_reported: 50 },
      },
      booth_leases: {
        data: { rent_amount: 500 },
      },
    });

    const status = await fetchRentStatus(supabase, "barber-1");

    expect(status.remaining).toBe(0);
    expect(status.takeHome).toBe(50); // cash + 0 digital excess
    expect(status.percentage).toBe(100);
    expect(status.rentCovered).toBe(true);
  });

  it("calculates take-home when digital exceeds rent", async () => {
    const supabase = mockSupabase({
      barber_rent_ledger: {
        data: { id: "led1", rent_due: 500, collected_digital: 700, collected_cash_reported: 100 },
      },
      booth_leases: {
        data: { rent_amount: 500 },
      },
    });

    const status = await fetchRentStatus(supabase, "barber-1");

    expect(status.remaining).toBe(0);
    expect(status.takeHome).toBe(300); // 100 cash + 200 digital excess
    expect(status.percentage).toBe(100); // capped at 100
    expect(status.rentCovered).toBe(true);
  });

  it("handles no ledger row (new barber, no cycle)", async () => {
    const supabase = mockSupabase({
      barber_rent_ledger: { data: null },
      booth_leases: { data: { rent_amount: 500 } },
    });

    const status = await fetchRentStatus(supabase, "barber-1");

    expect(status.rentDue).toBe(500); // from lease
    expect(status.collectedDigital).toBe(0);
    expect(status.collectedCash).toBe(0);
    expect(status.remaining).toBe(500);
    expect(status.takeHome).toBe(0);
  });

  it("handles no lease and no ledger (zero rent)", async () => {
    const supabase = mockSupabase({
      barber_rent_ledger: { data: null },
      booth_leases: { data: null },
    });

    const status = await fetchRentStatus(supabase, "barber-1");

    expect(status.rentDue).toBe(0);
    expect(status.remaining).toBe(0);
    expect(status.percentage).toBe(0); // 0/0 edge case
    expect(status.rentCovered).toBe(false); // rentDue=0, so never "covered"
  });

  it("cash does NOT reduce remaining rent", async () => {
    const supabase = mockSupabase({
      barber_rent_ledger: {
        data: { id: "led1", rent_due: 500, collected_digital: 0, collected_cash_reported: 500 },
      },
      booth_leases: {
        data: { rent_amount: 500 },
      },
    });

    const status = await fetchRentStatus(supabase, "barber-1");

    // Even though $500 cash was collected, rent remaining is still $500
    expect(status.remaining).toBe(500);
    expect(status.rentCovered).toBe(false);
    expect(status.takeHome).toBe(500); // all cash is barber's
  });
});

// ─── calculateRentSplit ─────────────────────────────────────────────────────

describe("calculateRentSplit", () => {
  it("sends 100% to owner when rent not yet covered", async () => {
    const supabase = mockSupabase({
      barber_rent_ledger: {
        data: { id: "led1", rent_due: 500, collected_digital: 200, collected_cash_reported: 0 },
      },
    });

    const split = await calculateRentSplit(supabase, "barber-1", 45);

    expect(split.ownerAmount).toBe(45);
    expect(split.barberAmount).toBe(0);
    expect(split.rentRemaining).toBe(300);
    expect(split.rentCovered).toBe(false);
    expect(split.ledgerId).toBe("led1");
  });

  it("sends 100% to barber when rent already covered", async () => {
    const supabase = mockSupabase({
      barber_rent_ledger: {
        data: { id: "led1", rent_due: 500, collected_digital: 500, collected_cash_reported: 0 },
      },
    });

    const split = await calculateRentSplit(supabase, "barber-1", 45);

    expect(split.ownerAmount).toBe(0);
    expect(split.barberAmount).toBe(45);
    expect(split.rentRemaining).toBe(0);
    expect(split.rentCovered).toBe(true);
  });

  it("splits payment at the rent boundary (tipping-point cut)", async () => {
    // Rent due: 500, collected: 480, payment: 45
    // Remaining = 20. Owner gets 20, barber gets 25.
    const supabase = mockSupabase({
      barber_rent_ledger: {
        data: { id: "led1", rent_due: 500, collected_digital: 480, collected_cash_reported: 0 },
      },
    });

    const split = await calculateRentSplit(supabase, "barber-1", 45);

    expect(split.ownerAmount).toBe(20);
    expect(split.barberAmount).toBe(25);
    expect(split.rentRemaining).toBe(20);
    expect(split.rentCovered).toBe(true); // 20 - 20 = 0
  });

  it("handles exact rent boundary (payment = remaining)", async () => {
    const supabase = mockSupabase({
      barber_rent_ledger: {
        data: { id: "led1", rent_due: 500, collected_digital: 460, collected_cash_reported: 0 },
      },
    });

    const split = await calculateRentSplit(supabase, "barber-1", 40);

    expect(split.ownerAmount).toBe(40);
    expect(split.barberAmount).toBe(0);
    expect(split.rentCovered).toBe(true);
  });

  it("returns all to barber when no ledger row exists", async () => {
    const supabase = mockSupabase({
      barber_rent_ledger: { data: null },
    });

    const split = await calculateRentSplit(supabase, "barber-1", 45);

    expect(split.ownerAmount).toBe(0);
    expect(split.barberAmount).toBe(45);
    expect(split.rentRemaining).toBe(0);
    expect(split.rentCovered).toBe(true);
    expect(split.ledgerId).toBeNull();
  });

  it("handles zero payment amount", async () => {
    const supabase = mockSupabase({
      barber_rent_ledger: {
        data: { id: "led1", rent_due: 500, collected_digital: 200, collected_cash_reported: 0 },
      },
    });

    const split = await calculateRentSplit(supabase, "barber-1", 0);

    expect(split.ownerAmount).toBe(0);
    expect(split.barberAmount).toBe(0);
  });

  it("ignores cash collected when calculating rent remaining", async () => {
    // $400 cash collected, $0 digital. Rent should still be $500 remaining.
    const supabase = mockSupabase({
      barber_rent_ledger: {
        data: { id: "led1", rent_due: 500, collected_digital: 0, collected_cash_reported: 400 },
      },
    });

    const split = await calculateRentSplit(supabase, "barber-1", 45);

    expect(split.ownerAmount).toBe(45); // all to owner, rent still owed
    expect(split.barberAmount).toBe(0);
    expect(split.rentRemaining).toBe(500);
  });
});

// ─── updateRentLedger ───────────────────────────────────────────────────────

describe("updateRentLedger", () => {
  it("increments collected_digital for card payments", async () => {
    const supabase = mockSupabase({
      barber_rent_ledger: {
        data: { collected_digital: 200, collected_cash_reported: 50 },
      },
    });

    await updateRentLedger(supabase, "led1", 45, "card");

    const updateCall = supabase._updateCalls.find(
      (c: any) => c.table === "barber_rent_ledger" && c.values.collected_digital != null,
    );
    expect(updateCall).toBeDefined();
    expect(updateCall.values.collected_digital).toBe(245); // 200 + 45
  });

  it("increments collected_digital for prepaid payments", async () => {
    const supabase = mockSupabase({
      barber_rent_ledger: {
        data: { collected_digital: 200, collected_cash_reported: 50 },
      },
    });

    await updateRentLedger(supabase, "led1", 30, "prepaid");

    const updateCall = supabase._updateCalls.find(
      (c: any) => c.table === "barber_rent_ledger" && c.values.collected_digital != null,
    );
    expect(updateCall).toBeDefined();
    expect(updateCall.values.collected_digital).toBe(230); // 200 + 30
  });

  it("increments collected_cash_reported for cash payments", async () => {
    const supabase = mockSupabase({
      barber_rent_ledger: {
        data: { collected_digital: 200, collected_cash_reported: 50 },
      },
    });

    await updateRentLedger(supabase, "led1", 40, "cash");

    const updateCall = supabase._updateCalls.find(
      (c: any) => c.table === "barber_rent_ledger" && c.values.collected_cash_reported != null,
    );
    expect(updateCall).toBeDefined();
    expect(updateCall.values.collected_cash_reported).toBe(90); // 50 + 40
  });

  it("does nothing when ledger row not found", async () => {
    const supabase = mockSupabase({
      barber_rent_ledger: { data: null },
    });

    await updateRentLedger(supabase, "led1", 45, "card");

    expect(supabase._updateCalls).toHaveLength(0);
  });

  it("handles null initial values gracefully", async () => {
    const supabase = mockSupabase({
      barber_rent_ledger: {
        data: { collected_digital: null, collected_cash_reported: null },
      },
    });

    await updateRentLedger(supabase, "led1", 45, "card");

    const updateCall = supabase._updateCalls.find(
      (c: any) => c.table === "barber_rent_ledger" && c.values.collected_digital != null,
    );
    expect(updateCall).toBeDefined();
    expect(updateCall.values.collected_digital).toBe(45); // 0 + 45
  });
});
