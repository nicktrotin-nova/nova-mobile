# Session Log

## Session 34 — April 5, 2026 (Stripe Connect)

### What was done
- Grilled the Stripe Connect plan — resolved 12 architecture decisions, got 4 from Nick
- Phase 0: cash excluded from rent (4 files), DI on rentCalculation, card payments fail hard without edge function
- Phase 1: Stripe SDK installed, 3 edge functions, migration with payments table + row-locked RPC
- Phase 2: StripeOnboardingScreen, Payments row in More tab, BarberCard badges, one-step for owner-barbers
- Phase 3: Two-step PaymentSheet flow in checkout engine + process-payment edge function, Expo Go safe
- Phase 4: get-wallet-balance + cash-out edge functions, WalletScreen Stripe balance + Cash Out button
- Prepaid logic fixed (no rent impact), undo completions (long-press)
- Migration applied, 5 edge functions deployed, Stripe keys + webhook configured
- EAS dev build triggered (blocked on Apple Dev account)

### What's next
- CalendarScreen decomposition (fresh session)
- Test cash checkout + card payment once dev build installs
- Barber invite flow
