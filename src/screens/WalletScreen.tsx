import { useState, useEffect, useMemo, useCallback, useRef } from "react";
import {
  View,
  Text,
  ScrollView,
  StyleSheet,
  RefreshControl,
  TouchableOpacity,
  Animated,
  Easing,
  Share,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useFocusEffect } from "@react-navigation/native";
import { format, parseISO, startOfWeek, subWeeks } from "date-fns";
import { toZonedTime } from "date-fns-tz";
import {
  Scissors,
  Share2,
  TrendingUp,
  TrendingDown,
  Minus,
  CircleCheck,
  ArrowUpRight,
  Landmark,
} from "lucide-react-native";
import * as Haptics from "expo-haptics";
import ViewShot, { captureRef } from "react-native-view-shot";
import { supabase } from "../lib/supabase";
import { useAuth } from "../contexts/AuthContext";
import HoloShimmer from "../components/HoloShimmer";
import LoadingScreen from "../components/LoadingScreen";
import AppointmentCard from "../components/AppointmentCard";
import {
  colors,
  BG,
  NOVA_GREEN,
  LABEL,
  MUTED,
  DIM,
  CARD_BG,
} from "../theme/colors";
import { SHOP_TZ as TZ } from "../config/shop";
import { useRealtimeSync } from "../hooks/useRealtimeSync";
import { useScreenData } from "../hooks/useScreenData";

// ─── Types ───────────────────────────────────────────────────────────────────

interface CycleLedger {
  id: string;
  period_start: string;
  period_end: string;
  rent_due: number | null;
  collected_digital: number | null;
  collected_cash_reported: number | null;
  status: string;
}

interface CompletedAppointment {
  id: string;
  client_name: string | null;
  price_charged: number | null;
  payment_method: string | null;
  rent_contribution: number | null;
  appointment_date: string;
  start_time: string;
  services: { name: string } | { name: string }[] | null;
}

interface ActiveLease {
  rent_amount: number | null;
}

// ─── Greeting (relative to barber's own history) ─────────────────────────────

function getHeroGreeting(
  percentage: number,
  takeHome: number,
  lastWeekTotal: number,
  firstName: string | null,
): string {
  const name = firstName ? `, ${firstName}` : "";

  // If we have last week data, use relative thresholds
  if (lastWeekTotal > 0) {
    const ratio = takeHome / lastWeekTotal;
    if (percentage === 0) return `Fresh week${name}. Let's build.`;
    if (ratio >= 1.2) return `Ahead of last week${name}. Keep pushing.`;
    if (ratio >= 0.8) return `Tracking well${name}. Solid pace.`;
    if (percentage < 50) return `Building momentum${name}.`;
    if (percentage < 100) return `Getting close${name}.`;
    return `Rent covered${name}. It's all yours now.`;
  }

  // Fallback without history
  if (percentage === 0) return `Let's get started${name}.`;
  if (percentage < 50) return `Building momentum${name}.`;
  if (percentage < 100) return `Getting close${name}.`;
  if (takeHome < 200) return `Rent covered${name}. Keep going.`;
  if (takeHome < 500) return `Solid week${name}.`;
  return `You're killing it${name}.`;
}

// ─── Vibe words (barber-specific for share) ──────────────────────────────────

function getVibeWord(
  appointmentCount: number,
  collected: number,
): string {
  if (appointmentCount >= 30) return "Full books.";
  if (appointmentCount >= 20) return "Chair's been warm.";
  if (appointmentCount >= 10) return `${appointmentCount} cuts deep.`;
  if (collected > 1500) return "Friday stack.";
  if (collected > 800) return "Building.";
  if (collected > 0) return "Clipping.";
  return "New week.";
}

function formatCurrencySmart(value: number): string {
  return value % 1 === 0 ? `$${value.toFixed(0)}` : `$${value.toFixed(2)}`;
}

// ─── Component ───────────────────────────────────────────────────────────────

export default function WalletScreen() {
  const { barberId } = useAuth();

  const [ledger, setLedger] = useState<CycleLedger | null>(null);
  const [appointments, setAppointments] = useState<CompletedAppointment[]>([]);
  const [activeLease, setActiveLease] = useState<ActiveLease | null>(null);
  const [barberFirstName, setBarberFirstName] = useState<string | null>(null);
  const [lastWeekTotal, setLastWeekTotal] = useState(0);
  const [isSharing, setIsSharing] = useState(false);
  const heroRef = useRef<ViewShot>(null);
  const [heroCardWidth, setHeroCardWidth] = useState(0);
  const [heroCardHeight, setHeroCardHeight] = useState(0);

  // ── Stripe wallet balance ──
  const [stripeBalance, setStripeBalance] = useState<{
    connected: boolean;
    available: number;
    pending: number;
  } | null>(null);
  const [cashingOut, setCashingOut] = useState(false);
  const [stripeError, setStripeError] = useState(false);

  const progressAnim = useRef(new Animated.Value(0)).current;
  const countUpAnim = useRef(new Animated.Value(0)).current;
  const [displayedAmount, setDisplayedAmount] = useState(0);

  // ── Data fetching ──
  const fetchData = useCallback(async () => {
    if (!barberId) return;

    const now = toZonedTime(new Date(), TZ);
    const weekStart = format(
      startOfWeek(now, { weekStartsOn: 1 }),
      "yyyy-MM-dd",
    );
    const today = format(now, "yyyy-MM-dd");
    const lastWeekStart = format(
      startOfWeek(subWeeks(now, 1), { weekStartsOn: 1 }),
      "yyyy-MM-dd",
    );
    const lastWeekEnd = format(
      subWeeks(startOfWeek(now, { weekStartsOn: 1 }), 0),
      "yyyy-MM-dd",
    );

    const [ledgerRes, apptRes, leaseRes, barberRes, lastWeekRes] =
      await Promise.all([
        supabase
          .from("barber_rent_ledger")
          .select(
            "id, period_start, period_end, rent_due, collected_digital, collected_cash_reported, status",
          )
          .eq("barber_id", barberId)
          .eq("status", "open")
          .order("period_start", { ascending: false })
          .limit(1)
          .maybeSingle(),
        supabase
          .from("appointments")
          .select(
            `id, client_name, price_charged, payment_method,
           rent_contribution, appointment_date, start_time,
           services!appointments_service_id_fkey(name)`,
          )
          .eq("barber_id", barberId)
          .eq("status", "completed")
          .gte("appointment_date", weekStart)
          .lte("appointment_date", today)
          .order("appointment_date", { ascending: false })
          .order("start_time", { ascending: false }),
        supabase
          .from("booth_leases")
          .select("rent_amount")
          .eq("barber_id", barberId)
          .eq("status", "active")
          .limit(1)
          .maybeSingle(),
        supabase
          .from("barbers")
          .select("name")
          .eq("id", barberId)
          .limit(1)
          .maybeSingle(),
        // Last week's completed appointments for delta
        supabase
          .from("appointments")
          .select("price_charged")
          .eq("barber_id", barberId)
          .eq("status", "completed")
          .gte("appointment_date", lastWeekStart)
          .lt("appointment_date", lastWeekEnd),
      ]);

    setLedger((ledgerRes.data ?? null) as CycleLedger | null);
    setAppointments((apptRes.data ?? []) as CompletedAppointment[]);
    setActiveLease((leaseRes.data ?? null) as ActiveLease | null);

    // Extract first name
    const barberData = barberRes.data as { name: string } | null;
    const fullName = barberData?.name ?? null;
    if (fullName) {
      setBarberFirstName(fullName.split(" ")[0] ?? null);
    }

    // Sum last week
    const lastWeekData = (lastWeekRes.data ?? []) as { price_charged: number | null }[];
    const lwTotal = lastWeekData.reduce(
      (sum, a) => sum + Number(a.price_charged ?? 0),
      0,
    );
    setLastWeekTotal(lwTotal);

    // Fetch Stripe balance (non-blocking — wallet works without it)
    setStripeError(false);
    supabase.functions
      .invoke("get-wallet-balance", { body: { barber_id: barberId } })
      .then(({ data }) => {
        if (data?.success) {
          setStripeBalance({
            connected: data.connected ?? false,
            available: Number(data.available ?? 0),
            pending: Number(data.pending ?? 0),
          });
        }
      })
      .catch(() => {
        setStripeError(true);
      });
  }, [barberId]);

  const handleCashOut = async () => {
    if (!barberId || !stripeBalance?.available || cashingOut) return;
    setCashingOut(true);
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);

    const { data, error } = await supabase.functions.invoke("cash-out", {
      body: { barber_id: barberId },
    });

    if (!error && data?.success) {
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      setStripeBalance((prev) =>
        prev ? { ...prev, available: 0, pending: prev.pending + prev.available } : prev,
      );
    }

    setCashingOut(false);
  };

  const { loading, refreshing, onRefresh, refetch } = useScreenData(
    fetchData,
    [fetchData],
    !!barberId,
  );

  const walletTables = useMemo(
    () => [
      { table: "appointments", filter: `barber_id=eq.${barberId}` },
      {
        table: "barber_rent_ledger",
        event: "UPDATE" as const,
        filter: `barber_id=eq.${barberId}`,
      },
    ],
    [barberId],
  );
  useRealtimeSync({
    channelName: "wallet",
    key: barberId,
    tables: walletTables,
    onSync: refetch,
  });

  useFocusEffect(
    useCallback(() => {
      void refetch();
    }, [refetch]),
  );

  // ── Computed ──
  // Split by payment method: only digital counts toward rent, cash is always the barber's
  const { digitalCollected, cashCollected, collected } = useMemo(() => {
    let digital = 0;
    let cash = 0;
    for (const a of appointments) {
      const amount = Number(a.price_charged ?? 0);
      if (a.payment_method === "cash") {
        cash += amount;
      } else {
        digital += amount;
      }
    }
    return { digitalCollected: digital, cashCollected: cash, collected: digital + cash };
  }, [appointments]);
  const rentDue = Number(activeLease?.rent_amount ?? ledger?.rent_due ?? 0);
  // Take-home = all cash (always theirs) + whatever digital exceeds rent
  const takeHome = cashCollected + Math.max(0, digitalCollected - rentDue);
  // Rent progress: only digital payments
  const rentPct = rentDue > 0 ? Math.min(1, digitalCollected / rentDue) : 0;
  const percentage = Math.round(rentPct * 100);
  const rentRemaining = Math.max(0, rentDue - digitalCollected);
  const rentCovered = rentRemaining <= 0 && rentDue > 0;
  const hasRent = rentDue > 0;

  // Week-over-week delta (simplified — assumes similar cash/digital mix)
  const lastWeekTakeHome = Math.max(0, lastWeekTotal - rentDue);
  const delta = takeHome - lastWeekTakeHome;
  const deltaAbs = Math.abs(delta);
  const hasDelta = lastWeekTotal > 0 && collected > 0;

  const heroGreeting = getHeroGreeting(
    percentage,
    takeHome,
    lastWeekTotal,
    barberFirstName,
  );

  // Unique clients for jewel count
  const newClientCount = useMemo(() => {
    const names = new Set<string>();
    for (const a of appointments) {
      const n = a.client_name?.trim().toLowerCase();
      if (n) names.add(n);
    }
    return names.size;
  }, [appointments]);

  // ── Animations ──
  useEffect(() => {
    Animated.timing(progressAnim, {
      toValue: rentPct,
      duration: 800,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: false,
    }).start();
  }, [rentPct, progressAnim]);

  useEffect(() => {
    countUpAnim.setValue(0);
    setDisplayedAmount(0);
    const listener = countUpAnim.addListener(({ value }) => {
      setDisplayedAmount(Math.round(value * 100) / 100);
    });
    Animated.timing(countUpAnim, {
      toValue: takeHome,
      duration: 1200,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: false,
    }).start();
    return () => countUpAnim.removeListener(listener);
  }, [takeHome, countUpAnim]);

  const progressWidth = progressAnim.interpolate({
    inputRange: [0, 1],
    outputRange: ["0%", "100%"],
  });

  // ── Share ──
  const handleShare = useCallback(async () => {
    if (!heroRef.current) return;
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    setIsSharing(true);
    await new Promise((r) => setTimeout(r, 100));
    try {
      const uri = await captureRef(heroRef, {
        format: "png",
        quality: 1,
        result: "tmpfile",
      });
      await Share.share({
        url: uri,
        message: "This week's grind on Nova.",
      });
    } catch {
      // User dismissed or capture failed
    } finally {
      setIsSharing(false);
    }
  }, []);

  // ── Loading ──
  if (loading) {
    return (
      <SafeAreaView style={styles.safe} edges={["top"]}>
        <LoadingScreen />
      </SafeAreaView>
    );
  }

  // ── Delta indicator ──
  const renderDelta = () => {
    if (!hasDelta) return null;
    const isUp = delta > 0;
    const isFlat = deltaAbs < 10;
    const DeltaIcon = isFlat ? Minus : isUp ? TrendingUp : TrendingDown;
    const deltaColor = isFlat ? MUTED : isUp ? NOVA_GREEN : colors.error;

    return (
      <View style={styles.deltaRow}>
        <View pointerEvents="none">
          <DeltaIcon size={12} color={deltaColor} strokeWidth={2.5} />
        </View>
        <Text style={[styles.deltaText, { color: deltaColor }]}>
          {isFlat
            ? "Same as last week"
            : `${formatCurrencySmart(deltaAbs)} ${isUp ? "more" : "less"} than last week`}
        </Text>
      </View>
    );
  };

  return (
    <SafeAreaView style={styles.safe} edges={["top"]}>
      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.scrollContent}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={onRefresh}
            tintColor={NOVA_GREEN}
          />
        }
      >
        <ViewShot ref={heroRef} options={{ format: "png", quality: 1 }}>
          <View
            style={[styles.heroCard, rentCovered && styles.heroCardGlow]}
            onLayout={(e) => {
              setHeroCardWidth(e.nativeEvent.layout.width);
              setHeroCardHeight(e.nativeEvent.layout.height);
            }}
          >
            {/* Holographic shimmer */}
            {heroCardWidth > 0 && (
              <HoloShimmer width={heroCardWidth} height={heroCardHeight} />
            )}

            {/* Greeting — inside card, part of the emotional unit */}
            {!isSharing && (
              <Text style={styles.heroGreeting}>{heroGreeting}</Text>
            )}

            <Text style={styles.heroLabel}>
              {isSharing ? "THIS WEEK'S GRIND" : "yours this week"}
            </Text>

            {/* Hero amount */}
            {isSharing ? (
              <Text style={styles.heroAmountHidden}>
                {getVibeWord(appointments.length, collected)}
              </Text>
            ) : (
              <Text style={styles.heroAmount}>
                {formatCurrencySmart(displayedAmount)}
              </Text>
            )}

            {/* Week-over-week delta */}
            {!isSharing && renderDelta()}

            {/* Gross / Rent breakdown */}
            {!isSharing && (
              <View style={styles.grRow}>
                <View style={styles.grCol}>
                  <Text style={styles.grLabel}>Gross</Text>
                  <Text style={styles.grValueGreen}>
                    {formatCurrencySmart(collected)}
                  </Text>
                </View>
                <Text style={styles.grDot}>·</Text>
                <View style={styles.grCol}>
                  <Text style={styles.grLabel}>Rent</Text>
                  <Text style={styles.grValueMuted}>
                    {formatCurrencySmart(rentDue)}
                  </Text>
                </View>
              </View>
            )}

            {/* Progress bar */}
            {hasRent ? (
              <>
                <View style={styles.progressWrap}>
                  <View style={styles.progressTrack}>
                    <Animated.View
                      style={[styles.progressFill, { width: progressWidth }]}
                    />
                  </View>
                </View>
                {!isSharing &&
                  (rentCovered ? (
                    <View style={styles.rentCoveredRow}>
                      <View pointerEvents="none">
                        <CircleCheck
                          size={13}
                          color={NOVA_GREEN}
                          strokeWidth={2.5}
                        />
                      </View>
                      <Text style={styles.rentCoveredText}>Rent covered</Text>
                    </View>
                  ) : (
                    <Text style={styles.rentRemainingText}>
                      {formatCurrencySmart(rentRemaining)} left
                    </Text>
                  ))}
              </>
            ) : null}

            {/* Share pill — prominent, below progress */}
            {!isSharing && (
              <TouchableOpacity
                style={styles.sharePill}
                activeOpacity={0.8}
                delayPressIn={0}
                onPress={() => void handleShare()}
              >
                <View pointerEvents="none">
                  <Share2 size={14} color={MUTED} strokeWidth={2.2} />
                </View>
                <Text style={styles.sharePillText}>Share your stack</Text>
              </TouchableOpacity>
            )}

            {/* Nova branding — only during capture */}
            {isSharing && <Text style={styles.shareBranding}>Nova</Text>}
          </View>
        </ViewShot>

        {/* ── Stripe Wallet Balance ── */}
        {stripeError && !isSharing && (
          <View style={[styles.stripeCard, { alignItems: "center", paddingVertical: 14 }]}>
            <Text style={{ color: "#F5F3EF99", fontSize: 13, fontFamily: "Satoshi-Regular" }}>
              Couldn't load wallet balance — pull to refresh
            </Text>
          </View>
        )}
        {stripeBalance?.connected && !isSharing && (
          <View style={styles.stripeCard}>
            <View style={styles.stripeBalanceRow}>
              <View style={styles.stripeBalanceCol}>
                <Text style={styles.stripeBalanceLabel}>Available</Text>
                <Text style={styles.stripeBalanceAmount}>
                  {formatCurrencySmart(stripeBalance.available)}
                </Text>
              </View>
              {stripeBalance.pending > 0 && (
                <View style={styles.stripeBalanceCol}>
                  <Text style={styles.stripeBalanceLabel}>Pending</Text>
                  <Text style={styles.stripeBalancePending}>
                    {formatCurrencySmart(stripeBalance.pending)}
                  </Text>
                </View>
              )}
            </View>
            {stripeBalance.available > 0 && (
              <TouchableOpacity
                style={styles.cashOutBtn}
                onPress={handleCashOut}
                activeOpacity={0.85}
                delayPressIn={0}
                disabled={cashingOut}
              >
                <View pointerEvents="none">
                  <ArrowUpRight size={16} color={colors.textInverse} strokeWidth={2.5} />
                </View>
                <Text style={styles.cashOutText}>
                  {cashingOut ? "Sending..." : "Cash Out"}
                </Text>
              </TouchableOpacity>
            )}
            {stripeBalance.available === 0 && stripeBalance.pending === 0 && (
              <View style={styles.stripEmptyRow}>
                <View pointerEvents="none">
                  <Landmark size={16} color={DIM} strokeWidth={2} />
                </View>
                <Text style={styles.stripeEmptyText}>
                  Earnings arrive after card payments
                </Text>
              </View>
            )}
          </View>
        )}

        {/* ── Appointments ── */}
        <View style={styles.sectionWrap}>
          <Text style={styles.sectionHeader}>This week</Text>
          {appointments.length === 0 ? (
            <View style={styles.emptyCycleWrap}>
              <View pointerEvents="none">
                <Scissors size={32} color={NOVA_GREEN} />
              </View>
              <Text style={styles.emptyCycleText}>
                Complete your first cut and watch the pile grow.
              </Text>
            </View>
          ) : (
            appointments.map((apt) => (
              <AppointmentCard
                key={apt.id}
                appointment={apt}
                variant="transaction"
                meta={format(parseISO(apt.appointment_date), "EEE")}
                dimCompleted={false}
              />
            ))
          )}
        </View>

        {/* Summary footer */}
        {appointments.length > 0 && (
          <View style={styles.summaryFooter}>
            <Text style={styles.summaryText}>
              {appointments.length} cut{appointments.length === 1 ? "" : "s"} ·{" "}
              {newClientCount} client{newClientCount === 1 ? "" : "s"}
            </Text>
          </View>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

// ─── Styles ──────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: BG },
  scroll: { flex: 1, backgroundColor: BG },
  scrollContent: { paddingBottom: 110 },

  // ── Hero ──
  heroCard: {
    marginHorizontal: 16,
    marginTop: 12,
    borderRadius: 24,
    paddingVertical: 28,
    paddingHorizontal: 28,
    backgroundColor: colors.obsidian800,
    borderWidth: 1,
    borderColor: colors.borderMedium,
    overflow: "hidden",
    position: "relative",
  },
  heroCardGlow: {
    shadowColor: NOVA_GREEN,
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.25,
    shadowRadius: 24,
    elevation: 8,
  },

  heroGreeting: {
    fontSize: 15,
    fontWeight: "500",
    fontFamily: "Satoshi-Medium",
    color: LABEL,
    textAlign: "center",
    marginBottom: 16,
  },
  heroLabel: {
    fontSize: 12,
    fontWeight: "500",
    fontFamily: "Satoshi-Medium",
    color: MUTED,
    textAlign: "center",
    letterSpacing: 0.5,
    textTransform: "uppercase",
  },
  heroAmount: {
    marginVertical: 8,
    fontSize: 56,
    lineHeight: 64,
    color: NOVA_GREEN,
    textAlign: "center",
    fontFamily: "DMSerifText-Regular",
  },
  heroAmountHidden: {
    marginVertical: 12,
    fontSize: 32,
    lineHeight: 40,
    color: NOVA_GREEN,
    textAlign: "center",
    fontFamily: "DMSerifText-Regular",
    letterSpacing: 1,
  },

  // ── Delta ──
  deltaRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 5,
    marginBottom: 8,
  },
  deltaText: {
    fontSize: 12,
    fontFamily: "Satoshi-Regular",
    color: MUTED,
  },

  // ── Breakdown ──
  grRow: {
    marginTop: 4,
    flexDirection: "row",
    justifyContent: "center",
    alignItems: "center",
  },
  grCol: { alignItems: "center", minWidth: 90 },
  grLabel: { fontSize: 11, fontFamily: "Satoshi-Regular", color: MUTED },
  grValueGreen: {
    marginTop: 2,
    fontSize: 16,
    fontWeight: "500",
    fontFamily: "Satoshi-Medium",
    color: LABEL,
  },
  grValueMuted: {
    marginTop: 2,
    fontSize: 16,
    fontWeight: "500",
    fontFamily: "Satoshi-Medium",
    color: MUTED,
  },
  grDot: {
    fontSize: 11,
    color: colors.textGhost,
    marginHorizontal: 8,
  },

  // ── Progress ──
  progressWrap: { marginTop: 20, paddingHorizontal: 0 },
  progressTrack: {
    height: 4,
    borderRadius: 2,
    backgroundColor: colors.obsidian600,
    overflow: "hidden",
  },
  progressFill: {
    position: "absolute",
    left: 0,
    top: 0,
    bottom: 0,
    height: 4,
    borderRadius: 2,
    backgroundColor: NOVA_GREEN,
  },
  rentCoveredRow: {
    marginTop: 8,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 5,
  },
  rentCoveredText: {
    fontSize: 13,
    fontWeight: "600",
    fontFamily: "Satoshi-Medium",
    color: NOVA_GREEN,
  },
  rentRemainingText: {
    marginTop: 8,
    textAlign: "center",
    fontSize: 13,
    fontWeight: "500",
    fontFamily: "Satoshi-Medium",
    color: MUTED,
  },

  // ── Share pill ──
  sharePill: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    alignSelf: "center",
    gap: 6,
    marginTop: 20,
    paddingVertical: 10,
    paddingHorizontal: 20,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: colors.borderMedium,
    backgroundColor: colors.warmWhite04,
  },
  sharePillText: {
    fontSize: 13,
    fontWeight: "500",
    fontFamily: "Satoshi-Medium",
    color: MUTED,
  },
  shareBranding: {
    marginTop: 16,
    fontSize: 16,
    fontFamily: "DMSerifText-Regular",
    color: NOVA_GREEN,
    textAlign: "center",
    letterSpacing: 1,
    opacity: 0.7,
  },

  // ── Appointments ──
  sectionWrap: {
    marginTop: 28,
    paddingTop: 16,
    borderTopWidth: 1,
    borderTopColor: CARD_BG,
  },
  sectionHeader: {
    fontSize: 13,
    fontWeight: "500",
    fontFamily: "Satoshi-Medium",
    color: DIM,
    paddingHorizontal: 16,
    marginBottom: 8,
    letterSpacing: 0.5,
    textTransform: "uppercase",
  },
  emptyCycleWrap: {
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 30,
    paddingTop: 24,
    paddingBottom: 16,
  },
  emptyCycleText: {
    marginTop: 10,
    textAlign: "center",
    fontSize: 14,
    fontFamily: "Satoshi-Regular",
    color: DIM,
  },

  // ── Summary ──
  summaryFooter: {
    marginTop: 8,
    paddingHorizontal: 16,
    alignItems: "center",
  },
  summaryText: {
    fontSize: 12,
    fontFamily: "Satoshi-Regular",
    color: DIM,
  },

  // ── Stripe Wallet ──
  stripeCard: {
    marginHorizontal: 16,
    marginTop: 12,
    borderRadius: 16,
    paddingVertical: 16,
    paddingHorizontal: 20,
    backgroundColor: colors.obsidian800,
    borderWidth: 1,
    borderColor: colors.borderLight,
  },
  stripeBalanceRow: {
    flexDirection: "row",
    justifyContent: "space-around",
  },
  stripeBalanceCol: {
    alignItems: "center",
  },
  stripeBalanceLabel: {
    fontSize: 11,
    fontFamily: "Satoshi-Medium",
    color: DIM,
    letterSpacing: 0.5,
    textTransform: "uppercase" as const,
  },
  stripeBalanceAmount: {
    marginTop: 4,
    fontSize: 22,
    fontFamily: "DMSerifText-Regular",
    color: NOVA_GREEN,
  },
  stripeBalancePending: {
    marginTop: 4,
    fontSize: 22,
    fontFamily: "DMSerifText-Regular",
    color: MUTED,
  },
  cashOutBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    marginTop: 14,
    paddingVertical: 12,
    borderRadius: 12,
    backgroundColor: NOVA_GREEN,
  },
  cashOutText: {
    fontSize: 15,
    fontFamily: "Satoshi-Bold",
    color: colors.textInverse,
  },
  stripEmptyRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    marginTop: 8,
  },
  stripeEmptyText: {
    fontSize: 13,
    fontFamily: "Satoshi-Regular",
    color: DIM,
  },
});
