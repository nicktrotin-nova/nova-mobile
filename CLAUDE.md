Nova — Claude Code Context File
Updated: March 31, 2026
For use in Cursor with Claude Code

WHAT IS NOVA
Nova is a payment and booking platform purpose-built for booth rent barbershops. Built by Nick Trotin — 10-year owner of Stallion Barbers, Maroochydore QLD, the largest independent barbershop north of Brisbane. Nick introduced the booth rent model to Queensland.
Nova is a barber product. Full stop. Every decision is made for barbers, not for "independent operators" generically. No hedging for future verticals.

THE CORE VALUE PROPOSITION
For shop owners: Rent collects itself. Never chase a barber again. See who's thriving and who's slipping before you lose them.
For barbers: See what you made, what's left after rent and costs, and feel proud of it. No mental gymnastics.
For clients: Fastest booking experience possible. Returning clients: "Welcome back Glen! The usual?" — one tap to their barber's calendar. 3-4 taps, under 5 seconds.

POSITIONING
The emotional hook is: "This app finally gets being a barber."
"Money clarity engine disguised as a booking app" is the explanation for investors/articles — NOT the tagline. The positioning must be identity-driven, not feature-driven.
The Wallet should make barbers feel proud — seeing the fruits of their labour.

PRODUCT ARCHITECTURE
Platform Strategy

iOS (React Native) — the real product. 98% of usage happens here.
Web — admin layer for owner tasks that don't make sense on a phone.
Client booking — web-based, no app download required. Shop-branded with subtle "Powered by Nova" footer.

Build Workflow

Cursor + Claude Code — where the real building happens, directly in React Native
Claude chat — strategy, architecture, design direction
Lovable — design sandbox only, not the production environment

Tech Stack

React Native / Expo — iOS app
EAS Build — cloud iOS compilation (~$15 USD/month, no Mac needed)
Supabase — database, auth, real-time subscriptions, storage
Stripe Connect — payment infrastructure (separate charges and transfers)
Tap to Pay on iPhone — native payment acceptance, no terminal hardware
PayTo — Australian real-time payment rail (via Stripe) for settlement
GitHub — github.com/nicktrotin-nova/nova-mobile


PAYMENT ARCHITECTURE (PLANNING STAGE — NOT YET BUILT)
Rent-first routing: 100% of client payments go to the shop owner's Stripe account until that barber's rent is covered for the cycle. After rent is covered, 100% goes to the barber's Nova Wallet (Stripe Connected Account balance).
Nova Wallet: Auto-deducts platform fee and SMS/marketing costs. Sweeps to barber's bank every Friday at 5pm with a push notification.
Core principle: Nova never absorbs costs on behalf of barbers, and never makes the owner absorb them either. Each barber is a micro-business — their SMS balance, their marketing spend, all flows through their own Nova Wallet.

PRICING (TENTATIVE — NOT TESTED)

Shop account: $100 AUD/month (includes owner login and use)
Per barber: $10 AUD/week
SMS: Passed through at cost via barber's own wallet balance
Philosophy: all costs upfront, no surprises, no feature gating, no hidden fees


WHAT'S BUILT AND WORKING (iOS Native App)
Barber Side (~65% complete for daily-use shell)

My Day — real Stallion appointments, real-time subscriptions, checkout flow
Wallet — take-home calculations, rent progress, payment breakdown, weekly history (needs particle effect and polish)
Calendar — full interactive calendar with appointment management, block time editing, booking creation, team strip, date strip, time grid, real-time Supabase subscription
More tab — settings hub, sign out working, menu items mostly placeholder

Needs Work (match web mobile quality)

Calendar — web mobile version is better, needs improvement
My Schedule — needs to match web mobile
My Services — needs to match web mobile
Calendar Settings — needs to match web mobile
My Profile — functional but needs UI beautification
CreateBookingSheet — functional but not premium feel

Not Built Yet

Owner glance screen / owner toggle
My Booking Link (placeholder with fake link)
Notifications (placeholder toggles)
Export My Data
Help & Support
Stripe Connect integration
Tap to Pay
Push notifications
Barber invite onboarding flow

Not Built Yet — Payment Infrastructure

Stripe Connect setup and rent-first routing
Nova Wallet with real money
Friday sweep and push notification
SMS balance and top-up


THE OWNER GLANCE SCREEN (NEXT BUILD)
Five things, one screen:

Who's in — which barbers are working today
Start time — when each one kicks off
Today's booked value — total dollar value in each barber's column
Occupancy % — time-based: available hours minus booked hours, what percentage is unfilled
Weekly revenue to date — how the week is tracking so far

This is NOT a spatial floor map. It's a performance dashboard at a glance. The screen a shop owner opens every morning.

WALLET HERO FEATURE
Procedurally generated particle/coin pile that grows throughout the week as appointments complete. Inspired by Up Banking Savers.
Friday share button lets barbers share their pile image to mates WITHOUT the dollar amount — pride without crass bragging. Barbers speculate: "bro that's gotta be over $2k!"
This is the viral loop. Not a referral code — a barber sharing a golden pile that makes every other barber ask "what app is that?"

RETURNING CLIENT BOOKING FLOW

Client opens booking link → Nova recognises them
"Welcome back Glen! The usual?" with one tap to their barber's calendar
Pick a day, pick a time, confirmed. 3-4 taps, under 5 seconds.
First-time clients get the full guided flow
Fresha can't do this — their marketplace model needs clients to browse


DESIGN SYSTEM
Colours (Working — Still Being Refined)

Nova Green (#00D68F / #00C896): exclusively for money — earnings, take-home, payment confirmations, completing appointments
Turquoise (#06B6D4): product-wide "active/selected/on" colour for all non-money UI elements
Secondary dark: #252B3B
Ink/dark: #1A1F2E

NOTE: The "Coastal Masculine" palette (Abyss, Deep, Ocean, Reef, Tide, Dune, Shore, Foam, Slate, Mist) from the vision brief is STALE and not in use. Use the colours above.
Colour Rules

Green dots (#00D68F) stay green on both working day and active/selected states — no turquoise on dots
Active date dot does not animate in with layoutId (dot was already present)
Dots do not appear before barber schedule loads (fallback: false)

Typography

Month label format: 3-letter uppercase watch complication shorthand (APR, MAY) with tracking-widest
Numbers deserve prominence — larger size, medium weight
Sentence case for labels. Never ALL CAPS except section headers at 11px with letter-spacing.

Design Standard
Every screen measured against: "Does this make a barber feel like they upgraded their entire business, or does it feel like software?" If software — cut it, simplify it, or hide it.
The Feeling

Tesla — powerful, minimal, inevitable
Up Banking — clear, alive, satisfying. Financial information that feels good.
Fresha — effortless, calm, no learning curve. This is the floor to beat.

Polish & Craft Goals

Glass reflections, seamless animations, easter eggs
Every pixel should feel considered
Watch mechanics as interaction reference — precision, weight, satisfying feedback
Native iOS haptic tick on month change: UIImpactFeedbackGenerator .light, once per month change (not per date) — "winding a watch" feel
Complete button stays green — completing an appointment is the money moment

What Nova Never Does

Show a barber their competitor's pricing
Send a client to a competitor's shop
Hide a fee in fine print
Make a barber feel like an employee
Overwhelm an owner with data they didn't ask for
Require an app download to book an appointment


VOICE & TONE
Nova speaks like a trusted mate who happens to be good with money. Not corporate. Not startup-cute. Direct, warm, honest.

"You're booked in." not "Your appointment has been successfully confirmed"
"This week so far" not "Revenue metrics for current billing cycle"
"Charge for no-show?" not "Initiate no-show charge"
Numbers always have context: "$1,640 — yours this week" not just "$1,640"


KEY PEOPLE

Matt — co-owner of Stallion Barbers, 35% shareholder
Dylan — owner of Genuine Club; first warm shop lead, called Nick complaining about Fresha
Keaton — owner of First Rule Barbershop; runs booth rent on Fresha
Justin Bexon — owner of Barber Collective; loyal friendship, would support Nova
Kevin Hanna — Stallion client, COO background (Deloitte Digital SF), potential help if Nick gets stuck — NOT the primary demo audience
Sam Thompson — close friend, founder of Akta Media, phase two asset for launch narrative


KNOWN iOS/REACT NATIVE GOTCHAS

flex: 1 + minHeight: "100%" inside ScrollView breaks touch handling on iOS
Lucide/SVG icons in TouchableOpacity need <View pointerEvents="none"> wrapper on iOS
pointerEvents="box-none" on containers lets taps pass through except on children
delayPressIn={0} prevents ScrollView from stealing quick taps
Supabase embedded relations return arrays — need normalizing
Expo Go caching: use npx expo start --clear when confused
FAB pattern: pointerEvents="box-none" absolute overlay + delayPressIn={0} + SVG pointer fix


BUILDING PRINCIPLES

Every session must move the needle visibly — something Nick can see and feel on his phone
Simplest possible implementation first
Payment infrastructure is the critical path — without real money flowing, Nova is a glorified diary
No artificial deadlines — passion project getting legs — but every session counts
The first real demo audience is Dylan, Keaton, Justin — shop owners who will actually switch or not


This file is a living document. Update it as Nova evolves.