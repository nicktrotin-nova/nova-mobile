import {
  useState,
  useEffect,
  useMemo,
  useCallback,
  useRef,
} from "react";
import {
  View,
  Text,
  ScrollView,
  TouchableOpacity,
  StyleSheet,
  LayoutAnimation,
  UIManager,
  Platform,
  ActivityIndicator,
  RefreshControl,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { format } from "date-fns";
import { toZonedTime } from "date-fns-tz";
import {
  CreditCard,
  Banknote,
  Wallet,
  WifiOff,
  Check,
  CircleCheck,
  Minus,
  Plus,
  UserX,
  Scissors,
} from "lucide-react-native";
import { LinearGradient } from "expo-linear-gradient";
import * as Haptics from "expo-haptics";

import { supabase } from "../lib/supabase";
import { useAuth } from "../contexts/AuthContext";
import { SHOP_TZ } from "../config/shop";
import { createCheckoutEngine } from "../engine/checkout";
import type { PaymentMethod, CheckoutResult } from "../engine/checkout";
import { fetchRentStatus } from "../utils/rentCalculation";
import type { RentStatus } from "../utils/rentCalculation";
import { formatTime12, normalizeService } from "../utils/formatters";
import type { Appointment, RawAppointment } from "../types/domain";
import WalkInSheet from "../components/WalkInSheet";
import {
  colors,
  BG,
  NOVA_GREEN,
  LABEL,
  MUTED,
  DIM,
  CARD_BG,
} from "../theme/colors";

// ─── Android LayoutAnimation ─────────────────────────────────────────────────

if (
  Platform.OS === "android" &&
  UIManager.setLayoutAnimationEnabledExperimental
) {
  UIManager.setLayoutAnimationEnabledExperimental(true);
}

// ─── Constants ───────────────────────────────────────────────────────────────

const OBSIDIAN_900 = colors.obsidian900;
const OBSIDIAN_800 = colors.obsidian800;
const OBSIDIAN_700 = colors.obsidian700;
const OBSIDIAN_600 = colors.obsidian600;
const TEXT_PRIMARY = colors.textPrimary;
const TEXT_SECONDARY = colors.textSecondary;
const TEXT_TERTIARY = colors.textTertiary;
const TEXT_GHOST = colors.textGhost;

const CATCH_LIGHT = "rgba(245,243,239,0.09)";
const PRICE_ADJUST_STEP = 5;

// ─── Layout Animation Config ────────────────────────────────────────────────

const EXPAND_ANIM = {
  duration: 200,
  create: { type: LayoutAnimation.Types.easeInEaseOut, property: LayoutAnimation.Properties.opacity },
  update: { type: LayoutAnimation.Types.easeInEaseOut },
  delete: { type: LayoutAnimation.Types.easeInEaseOut, property: LayoutAnimation.Properties.opacity },
};

// ─── Helpers ─────────────────────────────────────────────────────────────────

function normalizeAppointment(raw: RawAppointment): Appointment {
  return { ...raw, services: normalizeService(raw.services) };
}

function greetingLine(
  confirmedCount: number,
  bookedValue: number,
  hour: number,
): string {
  const period = hour < 12 ? "Morning" : hour < 17 ? "Afternoon" : "Evening";
  if (confirmedCount === 0) return `${period}. Nothing booked yet.`;
  const money = `$${bookedValue.toFixed(0)} on the books`;
  const clients = `${confirmedCount} client${confirmedCount !== 1 ? "s" : ""}`;
  return `${period}. ${clients} — ${money}`;
}

// ─── Component ───────────────────────────────────────────────────────────────

export default function MyDayScreen() {
  const { barberId, shopId } = useAuth();

  // ── Refs (before any early returns — React hook order is sacred) ──────────
  const scrollRef = useRef<ScrollView>(null);
  const nextUpLayoutY = useRef<number>(0);
  const checkoutEngineRef = useRef(createCheckoutEngine({ supabase }));
  const noShowPendingRef = useRef<string | null>(null);

  // ── State ─────────────────────────────────────────────────────────────────
  const [appointments, setAppointments] = useState<Appointment[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [isOffline, setIsOffline] = useState(false);

  const [rentStatus, setRentStatus] = useState<RentStatus | null>(null);

  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [priceOverrides, setPriceOverrides] = useState<Record<string, number>>({});
  const [completingId, setCompletingId] = useState<string | null>(null);
  const [justCompletedId, setJustCompletedId] = useState<string | null>(null);
  const [toastMessage, setToastMessage] = useState<string | null>(null);
  const [noShowConfirmId, setNoShowConfirmId] = useState<string | null>(null);

  const [walkInVisible, setWalkInVisible] = useState(false);

  // ── Derived ───────────────────────────────────────────────────────────────
  const shopNow = useMemo(() => toZonedTime(new Date(), SHOP_TZ), []);
  const today = useMemo(() => format(shopNow, "yyyy-MM-dd"), [shopNow]);
  const hour = shopNow.getHours();
  const cacheKey = `nova_myday_${barberId}_${today}`;

  const confirmed = useMemo(
    () => appointments.filter((a) => a.status === "confirmed"),
    [appointments],
  );

  const bookedValue = useMemo(
    () => confirmed.reduce((sum, a) => sum + Number(a.price_charged ?? 0), 0),
    [confirmed],
  );

  const nextUp = useMemo(() => {
    const nowStr = format(shopNow, "HH:mm:ss");
    return confirmed.find((a) => a.start_time >= nowStr) ?? null;
  }, [confirmed, shopNow]);

  const greeting = useMemo(
    () => greetingLine(confirmed.length, bookedValue, hour),
    [confirmed.length, bookedValue, hour],
  );

  // ── Fetch ─────────────────────────────────────────────────────────────────

  const fetchAppointments = useCallback(async () => {
    if (!barberId) return;
    const { data, error } = await supabase
      .from("appointments")
      .select(
        `id, barber_id, client_name, client_phone, client_email,
         service_id, barber_service_id, appointment_date,
         start_time, end_time, status, price_charged, payment_method,
         booking_source, notes, rent_contribution,
         services!appointments_service_id_fkey(name, duration_minutes)`,
      )
      .eq("barber_id", barberId)
      .eq("appointment_date", today)
      .in("status", ["confirmed", "completed", "no_show"])
      .order("start_time");

    if (!error && data) {
      const normalized = (data as RawAppointment[]).map(normalizeAppointment);
      setAppointments(normalized);
      setIsOffline(false);
      try {
        await AsyncStorage.setItem(cacheKey, JSON.stringify(normalized));
      } catch {
        // Non-critical
      }
    } else if (error) {
      try {
        const cached = await AsyncStorage.getItem(cacheKey);
        if (cached) {
          setAppointments(JSON.parse(cached) as Appointment[]);
          setIsOffline(true);
        }
      } catch {
        // No cache available
      }
    }
    setLoading(false);
  }, [barberId, today, cacheKey]);

  const fetchRent = useCallback(async () => {
    if (!barberId) return;
    try {
      const status = await fetchRentStatus(supabase, barberId);
      setRentStatus(status);
    } catch {
      // Non-critical — hero strip will show without rent data
    }
  }, [barberId]);

  // ── Effects ───────────────────────────────────────────────────────────────

  useEffect(() => {
    fetchAppointments();
    fetchRent();
  }, [fetchAppointments, fetchRent]);

  // Realtime subscription
  useEffect(() => {
    if (!barberId) return;
    const channel = supabase
      .channel(`myday-${barberId}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "appointments",
          filter: `barber_id=eq.${barberId}`,
        },
        () => {
          fetchAppointments();
          fetchRent();
        },
      )
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [barberId, fetchAppointments, fetchRent]);

  // Auto-scroll to next-up after initial load
  useEffect(() => {
    if (!loading && nextUp && nextUpLayoutY.current > 0) {
      // Small delay to let layout settle
      const timeout = setTimeout(() => {
        scrollRef.current?.scrollTo({
          y: Math.max(0, nextUpLayoutY.current - 16),
          animated: true,
        });
      }, 300);
      return () => clearTimeout(timeout);
    }
  }, [loading, nextUp]);

  // Toast auto-dismiss
  useEffect(() => {
    if (!toastMessage) return;
    const timeout = setTimeout(() => setToastMessage(null), 3000);
    return () => clearTimeout(timeout);
  }, [toastMessage]);

  // ── Pull-to-refresh ───────────────────────────────────────────────────────

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await Promise.all([fetchAppointments(), fetchRent()]);
    setRefreshing(false);
  }, [fetchAppointments, fetchRent]);

  // ── Card expand/collapse ──────────────────────────────────────────────────

  const toggleExpand = useCallback(
    (id: string) => {
      LayoutAnimation.configureNext(EXPAND_ANIM);
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
      if (expandedId === id) {
        setExpandedId(null);
        setNoShowConfirmId(null);
      } else {
        setExpandedId(id);
        setNoShowConfirmId(null);
        // Initialize price override from appointment
        const apt = appointments.find((a) => a.id === id);
        if (apt && priceOverrides[id] == null) {
          setPriceOverrides((prev) => ({
            ...prev,
            [id]: Number(apt.price_charged ?? 0),
          }));
        }
      }
    },
    [expandedId, appointments, priceOverrides],
  );

  // ── Price adjustment ──────────────────────────────────────────────────────

  const adjustPrice = useCallback(
    (id: string, delta: number) => {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
      setPriceOverrides((prev) => {
        const current = prev[id] ?? 0;
        return { ...prev, [id]: Math.max(0, current + delta) };
      });
    },
    [],
  );

  // ── Checkout ──────────────────────────────────────────────────────────────

  const handleCheckout = useCallback(
    async (appointmentId: string, method: PaymentMethod) => {
      setCompletingId(appointmentId);
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);

      const apt = appointments.find((a) => a.id === appointmentId);
      const overridePrice = priceOverrides[appointmentId];
      const originalPrice = Number(apt?.price_charged ?? 0);
      const needsOverride =
        overridePrice != null && overridePrice !== originalPrice
          ? overridePrice
          : undefined;

      const result = await checkoutEngineRef.current.complete({
        appointmentId,
        paymentMethod: method,
        priceOverride: needsOverride,
      });

      if (result.success && !("needsPaymentSheet" in result)) {
        const checkoutResult = result as CheckoutResult;
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);

        LayoutAnimation.configureNext(EXPAND_ANIM);
        setExpandedId(null);
        setJustCompletedId(appointmentId);
        setToastMessage(checkoutResult.toastMessage);

        // Refresh data
        fetchAppointments();
        fetchRent();

        setTimeout(() => {
          setJustCompletedId(null);
        }, 1500);
      } else if (!result.success) {
        setToastMessage(result.message);
      }

      setCompletingId(null);
    },
    [appointments, priceOverrides, fetchAppointments, fetchRent],
  );

  // ── No-show ───────────────────────────────────────────────────────────────

  const handleNoShow = useCallback(
    async (appointmentId: string) => {
      if (noShowConfirmId !== appointmentId) {
        // First tap — set confirm state
        Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
        setNoShowConfirmId(appointmentId);
        return;
      }
      // Second tap — execute
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
      const { error } = await supabase
        .from("appointments")
        .update({ status: "no_show" })
        .eq("id", appointmentId);

      if (!error) {
        LayoutAnimation.configureNext(EXPAND_ANIM);
        setExpandedId(null);
        setNoShowConfirmId(null);
        fetchAppointments();
      }
    },
    [noShowConfirmId, fetchAppointments],
  );

  // ── Walk-in handlers ──────────────────────────────────────────────────────

  const openWalkIn = useCallback(() => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    setWalkInVisible(true);
  }, []);

  const onWalkInBooked = useCallback(() => {
    fetchAppointments();
    fetchRent();
  }, [fetchAppointments, fetchRent]);

  // ── Loading state ─────────────────────────────────────────────────────────

  if (loading) {
    return (
      <SafeAreaView style={styles.container} edges={["top"]}>
        <View style={styles.loadingWrap}>
          <ActivityIndicator color={NOVA_GREEN} size="large" />
        </View>
      </SafeAreaView>
    );
  }

  // ── Rent hero strip values ────────────────────────────────────────────────

  const takeHome = rentStatus?.takeHome ?? 0;
  const rentCovered = rentStatus?.rentCovered ?? false;
  const rentRemaining = rentStatus?.remaining ?? 0;

  // ─── Render ───────────────────────────────────────────────────────────────

  return (
    <SafeAreaView style={styles.container} edges={["top"]}>
      {/* ── Hero Strip ─────────────────────────────────────────────────────── */}
      <View style={styles.heroStrip}>
        <View style={styles.heroLeft}>
          <Text style={styles.heroGreeting}>{greeting}</Text>
          {rentStatus != null && (
            <View style={styles.heroRentRow}>
              {rentCovered ? (
                <>
                  <View pointerEvents="none">
                    <CircleCheck
                      size={13}
                      color={NOVA_GREEN}
                      strokeWidth={2.5}
                    />
                  </View>
                  <Text style={styles.heroRentCovered}>Rent covered</Text>
                </>
              ) : (
                <Text style={styles.heroRentOwed}>
                  ${rentRemaining.toFixed(0)} left on rent
                </Text>
              )}
            </View>
          )}
        </View>
        <View style={styles.heroRight}>
          {rentCovered ? (
            <LinearGradient
              colors={[colors.novaGradientStart, colors.novaGradientEnd]}
              start={{ x: 0, y: 0 }}
              end={{ x: 1, y: 1 }}
              style={styles.heroGradientWrap}
            >
              <Text style={styles.heroTakeHomeGradient}>
                ${takeHome.toFixed(0)}
              </Text>
            </LinearGradient>
          ) : (
            <Text style={styles.heroTakeHome}>${takeHome.toFixed(0)}</Text>
          )}
          <Text style={styles.heroTakeHomeLabel}>yours today</Text>
        </View>
      </View>

      {/* ── Offline Banner ─────────────────────────────────────────────────── */}
      {isOffline && (
        <View style={styles.offlineBanner}>
          <View pointerEvents="none">
            <WifiOff color={TEXT_TERTIARY} size={13} />
          </View>
          <Text style={styles.offlineText}>
            Offline — showing cached data
          </Text>
        </View>
      )}

      {/* ── Section Header ─────────────────────────────────────────────────── */}
      <Text style={styles.sectionHeader}>TODAY</Text>

      {/* ── Appointment List ───────────────────────────────────────────────── */}
      <ScrollView
        ref={scrollRef}
        style={styles.scrollView}
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={onRefresh}
            tintColor={NOVA_GREEN}
            progressBackgroundColor={OBSIDIAN_800}
          />
        }
      >
        {appointments.length === 0 ? (
          <View style={styles.emptyWrap}>
            <View pointerEvents="none">
              <Scissors color={TEXT_TERTIARY} size={28} strokeWidth={1.5} />
            </View>
            <Text style={styles.emptyTitle}>Nothing booked yet</Text>
            <Text style={styles.emptySub}>
              Your booking link is live
            </Text>
          </View>
        ) : (
          appointments.map((apt) => {
            const isNext = nextUp?.id === apt.id;
            const isCompleted = apt.status === "completed";
            const isNoShow = apt.status === "no_show";
            const isDone = isCompleted || isNoShow;
            const isExpanded = expandedId === apt.id && !isDone;
            const wasJustCompleted = justCompletedId === apt.id;

            const serviceName = apt.services?.name ?? "Service";
            const price =
              priceOverrides[apt.id] ?? Number(apt.price_charged ?? 0);
            const originalPrice = Number(apt.price_charged ?? 0);
            const priceAdjusted = priceOverrides[apt.id] != null && priceOverrides[apt.id] !== originalPrice;

            return (
              <View
                key={apt.id}
                onLayout={(e) => {
                  if (isNext) {
                    nextUpLayoutY.current = e.nativeEvent.layout.y;
                  }
                }}
              >
                <TouchableOpacity
                  onPress={() => {
                    if (!isDone) toggleExpand(apt.id);
                  }}
                  activeOpacity={isDone ? 1 : 0.85}
                  delayPressIn={0}
                  style={[
                    styles.card,
                    isNext && !isExpanded && styles.cardNext,
                    isExpanded && styles.cardExpanded,
                    isDone && styles.cardDone,
                    wasJustCompleted && styles.cardFlash,
                  ]}
                >
                  {/* ── NEXT badge ────────────────────────────────────────── */}
                  {isNext && !isDone && (
                    <View style={styles.nextBadge}>
                      <Text style={styles.nextBadgeText}>NEXT</Text>
                    </View>
                  )}

                  {/* ── Main row ──────────────────────────────────────────── */}
                  <View style={styles.cardRow}>
                    <Text
                      style={[styles.cardTime, isDone && styles.textDone]}
                    >
                      {formatTime12(apt.start_time)}
                    </Text>
                    <View style={styles.cardCenter}>
                      <Text
                        style={[
                          styles.cardClient,
                          isDone && styles.textDone,
                          isNoShow && styles.textStrike,
                        ]}
                        numberOfLines={1}
                      >
                        {apt.client_name || "Walk-in"}
                      </Text>
                      <Text
                        style={[
                          styles.cardService,
                          isDone && styles.textDoneSub,
                        ]}
                        numberOfLines={1}
                      >
                        {serviceName}
                      </Text>
                    </View>
                    <View style={styles.cardPriceCol}>
                      {isDone && isCompleted && (
                        <View pointerEvents="none" style={styles.checkIcon}>
                          <Check
                            size={13}
                            color={NOVA_GREEN}
                            strokeWidth={2.5}
                          />
                        </View>
                      )}
                      <Text
                        style={[
                          styles.cardPrice,
                          isDone && styles.cardPriceDone,
                        ]}
                      >
                        ${Number(apt.price_charged ?? 0)}
                      </Text>
                    </View>
                  </View>

                  {/* ── Expanded: checkout panel ──────────────────────────── */}
                  {isExpanded && (
                    <View style={styles.checkoutPanel}>
                      {/* Price hero with +/- */}
                      <View style={styles.priceAdjustRow}>
                        <TouchableOpacity
                          onPress={() =>
                            adjustPrice(apt.id, -PRICE_ADJUST_STEP)
                          }
                          style={styles.priceBtn}
                          hitSlop={8}
                          delayPressIn={0}
                        >
                          <View pointerEvents="none">
                            <Minus
                              size={16}
                              color={TEXT_SECONDARY}
                              strokeWidth={2}
                            />
                          </View>
                        </TouchableOpacity>

                        <View style={styles.priceCenter}>
                          <Text style={styles.priceHero}>${price}</Text>
                          {priceAdjusted && (
                            <Text style={styles.priceWas}>
                              was ${originalPrice}
                            </Text>
                          )}
                        </View>

                        <TouchableOpacity
                          onPress={() =>
                            adjustPrice(apt.id, PRICE_ADJUST_STEP)
                          }
                          style={styles.priceBtn}
                          hitSlop={8}
                          delayPressIn={0}
                        >
                          <View pointerEvents="none">
                            <Plus
                              size={16}
                              color={TEXT_SECONDARY}
                              strokeWidth={2}
                            />
                          </View>
                        </TouchableOpacity>
                      </View>

                      {/* "How'd they pay?" */}
                      <Text style={styles.payPrompt}>How'd they pay?</Text>

                      {/* Payment pills */}
                      <View style={styles.payRow}>
                        {(
                          [
                            { method: "card" as PaymentMethod, Icon: CreditCard, label: "Card" },
                            { method: "cash" as PaymentMethod, Icon: Banknote, label: "Cash" },
                            { method: "prepaid" as PaymentMethod, Icon: Wallet, label: "Prepaid" },
                          ] as const
                        ).map(({ method, Icon, label }) => (
                          <TouchableOpacity
                            key={method}
                            style={[
                              styles.payPill,
                              completingId === apt.id && styles.payPillDisabled,
                            ]}
                            onPress={() => handleCheckout(apt.id, method)}
                            disabled={completingId === apt.id}
                            activeOpacity={0.8}
                            delayPressIn={0}
                          >
                            <View pointerEvents="none">
                              <Icon
                                size={16}
                                color={TEXT_PRIMARY}
                                strokeWidth={1.8}
                              />
                            </View>
                            <Text style={styles.payPillLabel}>{label}</Text>
                          </TouchableOpacity>
                        ))}
                      </View>

                      {/* No-show */}
                      <TouchableOpacity
                        onPress={() => handleNoShow(apt.id)}
                        style={styles.noShowBtn}
                        activeOpacity={0.8}
                        delayPressIn={0}
                      >
                        <View pointerEvents="none">
                          <UserX
                            size={14}
                            color={
                              noShowConfirmId === apt.id
                                ? colors.error
                                : TEXT_TERTIARY
                            }
                            strokeWidth={1.8}
                          />
                        </View>
                        <Text
                          style={[
                            styles.noShowText,
                            noShowConfirmId === apt.id &&
                              styles.noShowTextConfirm,
                          ]}
                        >
                          {noShowConfirmId === apt.id
                            ? "Tap again to confirm"
                            : "No-show"}
                        </Text>
                      </TouchableOpacity>
                    </View>
                  )}
                </TouchableOpacity>
              </View>
            );
          })
        )}
      </ScrollView>

      {/* ── Walk-in Button ─────────────────────────────────────────────────── */}
      <View style={styles.walkInContainer}>
        <TouchableOpacity
          style={styles.walkInButton}
          onPress={openWalkIn}
          activeOpacity={0.85}
          delayPressIn={0}
        >
          <Text style={styles.walkInText}>Walk-in</Text>
        </TouchableOpacity>
      </View>

      {/* ── Toast ──────────────────────────────────────────────────────────── */}
      {toastMessage != null && (
        <View style={styles.toast}>
          <Text style={styles.toastText}>{toastMessage}</Text>
        </View>
      )}

      {/* ── Walk-in Sheet ──────────────────────────────────────────────────── */}
      {shopId != null && barberId != null && (
        <WalkInSheet
          visible={walkInVisible}
          onClose={() => setWalkInVisible(false)}
          onBooked={onWalkInBooked}
          shopId={shopId}
          loggedInBarberId={barberId}
        />
      )}
    </SafeAreaView>
  );
}

// ─── Styles ──────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  // ── Container ─────────────────────────────────────────────────────────────
  container: {
    flex: 1,
    backgroundColor: OBSIDIAN_900,
  },
  loadingWrap: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
  },

  // ── Hero Strip ────────────────────────────────────────────────────────────
  heroStrip: {
    flexDirection: "row",
    alignItems: "flex-start",
    justifyContent: "space-between",
    paddingHorizontal: 20,
    paddingTop: 16,
    paddingBottom: 12,
  },
  heroLeft: {
    flex: 1,
    marginRight: 16,
  },
  heroGreeting: {
    fontFamily: "Satoshi-Regular",
    fontSize: 15,
    color: TEXT_SECONDARY,
    lineHeight: 20,
  },
  heroRentRow: {
    flexDirection: "row",
    alignItems: "center",
    marginTop: 4,
    gap: 5,
  },
  heroRentCovered: {
    fontFamily: "Satoshi-Medium",
    fontSize: 13,
    color: NOVA_GREEN,
  },
  heroRentOwed: {
    fontFamily: "Satoshi-Regular",
    fontSize: 13,
    color: TEXT_TERTIARY,
  },
  heroRight: {
    alignItems: "flex-end",
  },
  heroGradientWrap: {
    borderRadius: 4,
    paddingHorizontal: 2,
  },
  heroTakeHome: {
    fontFamily: "DMSerifText-Regular",
    fontSize: 28,
    color: NOVA_GREEN,
  },
  heroTakeHomeGradient: {
    fontFamily: "DMSerifText-Regular",
    fontSize: 32,
    color: colors.textInverse,
  },
  heroTakeHomeLabel: {
    fontFamily: "Satoshi-Regular",
    fontSize: 12,
    color: TEXT_TERTIARY,
    marginTop: 1,
  },

  // ── Offline ───────────────────────────────────────────────────────────────
  offlineBanner: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    backgroundColor: OBSIDIAN_600,
    paddingVertical: 6,
    paddingHorizontal: 14,
    marginHorizontal: 20,
    marginBottom: 8,
    borderRadius: 8,
  },
  offlineText: {
    fontFamily: "Satoshi-Regular",
    fontSize: 12,
    color: TEXT_TERTIARY,
  },

  // ── Section Header ────────────────────────────────────────────────────────
  sectionHeader: {
    fontFamily: "Satoshi-Medium",
    fontSize: 13,
    letterSpacing: 0.5,
    color: TEXT_TERTIARY,
    paddingHorizontal: 20,
    paddingBottom: 8,
  },

  // ── Scroll ────────────────────────────────────────────────────────────────
  scrollView: {
    flex: 1,
  },
  scrollContent: {
    paddingHorizontal: 16,
    paddingBottom: 100,
  },

  // ── Empty State ───────────────────────────────────────────────────────────
  emptyWrap: {
    alignItems: "center",
    justifyContent: "center",
    paddingTop: 100,
    gap: 10,
  },
  emptyTitle: {
    fontFamily: "Satoshi-Medium",
    fontSize: 16,
    color: TEXT_PRIMARY,
  },
  emptySub: {
    fontFamily: "Satoshi-Regular",
    fontSize: 14,
    color: TEXT_TERTIARY,
  },

  // ── Card ──────────────────────────────────────────────────────────────────
  card: {
    backgroundColor: OBSIDIAN_800,
    borderRadius: 10,
    borderTopWidth: 1,
    borderTopColor: CATCH_LIGHT,
    paddingVertical: 14,
    paddingHorizontal: 16,
    marginBottom: 12,
  },
  cardNext: {
    // Green glow for next-up — subtle, premium
    shadowColor: NOVA_GREEN,
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.15,
    shadowRadius: 16,
    elevation: 6,
  },
  cardExpanded: {
    backgroundColor: OBSIDIAN_700,
  },
  cardDone: {
    opacity: 0.4,
  },
  cardFlash: {
    // Momentary green glow on completion
    shadowColor: NOVA_GREEN,
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.35,
    shadowRadius: 24,
    elevation: 8,
  },

  // ── NEXT Badge ────────────────────────────────────────────────────────────
  nextBadge: {
    position: "absolute",
    top: 6,
    right: 8,
    backgroundColor: NOVA_GREEN,
    borderRadius: 4,
    paddingHorizontal: 6,
    paddingVertical: 2,
  },
  nextBadgeText: {
    fontFamily: "Satoshi-Bold",
    fontSize: 9,
    letterSpacing: 0.8,
    color: colors.textInverse,
  },

  // ── Card Row ──────────────────────────────────────────────────────────────
  cardRow: {
    flexDirection: "row",
    alignItems: "center",
  },
  cardTime: {
    fontFamily: "Satoshi-Regular",
    fontSize: 13,
    color: TEXT_TERTIARY,
    width: 68,
  },
  cardCenter: {
    flex: 1,
    marginRight: 12,
  },
  cardClient: {
    fontFamily: "Satoshi-Medium",
    fontSize: 15,
    color: TEXT_PRIMARY,
    lineHeight: 20,
  },
  cardService: {
    fontFamily: "Satoshi-Regular",
    fontSize: 13,
    color: TEXT_SECONDARY,
    marginTop: 2,
  },
  cardPriceCol: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
  },
  checkIcon: {
    marginRight: 2,
  },
  cardPrice: {
    fontFamily: "DMSerifText-Regular",
    fontSize: 16,
    color: NOVA_GREEN,
  },
  cardPriceDone: {
    color: NOVA_GREEN,
  },

  // ── Text states ───────────────────────────────────────────────────────────
  textDone: {
    color: TEXT_PRIMARY,
  },
  textDoneSub: {
    color: TEXT_SECONDARY,
  },
  textStrike: {
    textDecorationLine: "line-through",
    color: colors.error,
  },

  // ── Checkout Panel ────────────────────────────────────────────────────────
  checkoutPanel: {
    marginTop: 14,
    paddingTop: 14,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: "rgba(245,243,239,0.06)",
    alignItems: "center",
  },

  // Price adjustment
  priceAdjustRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 20,
    marginBottom: 8,
  },
  priceBtn: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: OBSIDIAN_600,
    alignItems: "center",
    justifyContent: "center",
  },
  priceCenter: {
    alignItems: "center",
    minWidth: 80,
  },
  priceHero: {
    fontFamily: "DMSerifText-Regular",
    fontSize: 32,
    color: NOVA_GREEN,
  },
  priceWas: {
    fontFamily: "Satoshi-Regular",
    fontSize: 12,
    color: TEXT_TERTIARY,
    marginTop: 1,
  },

  // Pay prompt
  payPrompt: {
    fontFamily: "Satoshi-Regular",
    fontSize: 14,
    color: TEXT_SECONDARY,
    marginBottom: 12,
  },

  // Payment pills
  payRow: {
    flexDirection: "row",
    gap: 8,
    marginBottom: 12,
  },
  payPill: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    backgroundColor: OBSIDIAN_600,
    borderRadius: 10,
    paddingVertical: 12,
  },
  payPillDisabled: {
    opacity: 0.5,
  },
  payPillLabel: {
    fontFamily: "Satoshi-Medium",
    fontSize: 14,
    color: TEXT_PRIMARY,
  },

  // No-show
  noShowBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    paddingVertical: 8,
    paddingHorizontal: 12,
    marginTop: 4,
  },
  noShowText: {
    fontFamily: "Satoshi-Regular",
    fontSize: 13,
    color: TEXT_TERTIARY,
  },
  noShowTextConfirm: {
    color: colors.error,
  },

  // ── Walk-in Button ────────────────────────────────────────────────────────
  walkInContainer: {
    paddingHorizontal: 16,
    paddingBottom: 8,
    paddingTop: 4,
  },
  walkInButton: {
    backgroundColor: NOVA_GREEN,
    borderRadius: 12,
    paddingVertical: 16,
    alignItems: "center",
    justifyContent: "center",
    // Subtle depth
    shadowColor: NOVA_GREEN,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.2,
    shadowRadius: 12,
    elevation: 6,
  },
  walkInText: {
    fontFamily: "Satoshi-Bold",
    fontSize: 16,
    color: colors.textInverse,
    letterSpacing: 0.2,
  },

  // ── Toast ─────────────────────────────────────────────────────────────────
  toast: {
    position: "absolute",
    bottom: 100,
    left: 24,
    right: 24,
    backgroundColor: OBSIDIAN_700,
    borderRadius: 10,
    borderTopWidth: 1,
    borderTopColor: CATCH_LIGHT,
    paddingVertical: 12,
    paddingHorizontal: 16,
    alignItems: "center",
    // Float above content
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.4,
    shadowRadius: 16,
    elevation: 10,
  },
  toastText: {
    fontFamily: "Satoshi-Medium",
    fontSize: 14,
    color: TEXT_PRIMARY,
    textAlign: "center",
  },
});
