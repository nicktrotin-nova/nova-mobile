import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  View,
  Text,
  ScrollView,
  TouchableOpacity,
  TextInput,
  StyleSheet,
  Alert,
  Image,
  Dimensions,
  Animated,
  Easing,
} from "react-native";
import NovaSheet from "./NovaSheet";
import { format } from "date-fns";
import { toZonedTime } from "date-fns-tz";
import { X, ArrowLeft, ChevronRight, Scissors } from "lucide-react-native";
import { supabase } from "../lib/supabase";
import { colors, BG, NOVA_GREEN, LABEL, MUTED, DIM, CARD_BG } from "../theme/colors";
import { SHOP_TZ } from "../config/shop";
import { timeToMinutes, minutesToTime, normalizeService } from "../utils/formatters";
import { overlaps } from "../utils/availability";

export interface WalkInSheetProps {
  visible: boolean;
  onClose: () => void;
  onBooked: () => void;
  shopId: string;
  loggedInBarberId: string;
  shopTz?: string;
}

const DEFAULT_TZ = SHOP_TZ;

const CATEGORY_META: Record<string, { label: string; icon: string }> = {
  hair:      { label: "Haircuts",       icon: "scissors" },
  beard:     { label: "Beard & Face",   icon: "scissors" },
  combo:     { label: "Combos",         icon: "scissors" },
  colour:    { label: "Colour",         icon: "scissors" },
  treatment: { label: "Treatments",     icon: "scissors" },
  other:     { label: "Other",          icon: "scissors" },
};

function catKey(s: { category: string | null }): string {
  const c = (s.category ?? "other").toLowerCase().trim();
  return c in CATEGORY_META ? c : "other";
}

interface ServiceRow {
  id: string;
  name: string;
  category: string | null;
}

interface BarberRow {
  id: string;
  name: string;
  display_name: string | null;
  avatar_url: string | null;
  status: string | null;
}

interface BarberServiceRow {
  id: string;
  barber_id: string;
  service_id: string;
  price: number | null;
  duration_minutes: number | null;
  is_in_next_available_pool?: boolean | null;
  barbers: BarberRow | BarberRow[] | null;
}

interface SlotOption {
  barber: BarberRow;
  barberService: BarberServiceRow;
  slotStart: string;
  slotEnd: string;
}

interface ScheduleRow {
  start_time: string;
  end_time: string;
  is_available: boolean;
}

interface BusyApt {
  start_time: string;
  end_time: string;
}

function normalizeBarber(b: BarberRow | BarberRow[] | null): BarberRow | null {
  return normalizeService(b);
}

function barberLabel(barber: BarberRow): string {
  return barber.display_name?.trim() || barber.name?.trim() || "Barber";
}

export default function WalkInSheet({
  visible,
  onClose,
  onBooked,
  shopId,
  loggedInBarberId,
  shopTz = DEFAULT_TZ,
}: WalkInSheetProps) {
  const sheetHeight = Math.round(Dimensions.get("window").height * 0.7);

  const [renderedStep, setRenderedStep] = useState<1 | 2 | 3>(1);
  const isStepTransitioningRef = useRef(false);
  const stepOpacity = useRef(new Animated.Value(1)).current;
  const stepTranslateY = useRef(new Animated.Value(0)).current;

  const [servicesLoading, setServicesLoading] = useState(false);
  const [services, setServices] = useState<ServiceRow[]>([]);
  const [selectedService, setSelectedService] = useState<ServiceRow | null>(null);
  const [activeCategory, setActiveCategory] = useState<string | null>(null);

  const [slotsLoading, setSlotsLoading] = useState(false);
  const [slotOptions, setSlotOptions] = useState<SlotOption[]>([]);
  const [selectedSlot, setSelectedSlot] = useState<SlotOption | null>(null);
  const slotReqIdRef = useRef(0);

  const [clientName, setClientName] = useState("");
  const [clientPhone, setClientPhone] = useState("");
  const [booking, setBooking] = useState(false);

  const pulseOpacity = useRef(new Animated.Value(0.3)).current;

  const serviceListOpacity = useRef(new Animated.Value(0)).current;
  const serviceListTranslateY = useRef(new Animated.Value(6)).current;
  const slotListOpacity = useRef(new Animated.Value(0)).current;
  const slotListTranslateY = useRef(new Animated.Value(6)).current;

  const categoryGroups = useMemo(() => {
    const groups: Record<string, ServiceRow[]> = {};
    for (const s of services) {
      const key = catKey(s);
      if (!groups[key]) groups[key] = [];
      groups[key].push(s);
    }
    return groups;
  }, [services]);

  const categoryKeys = useMemo(() => Object.keys(categoryGroups), [categoryGroups]);

  const now = toZonedTime(new Date(), shopTz);
  const todayStr = format(now, "yyyy-MM-dd");
  const dow = now.getDay();

  const transitionToStep = useCallback(
    (nextStep: 1 | 2 | 3) => {
      if (nextStep === renderedStep || isStepTransitioningRef.current) return;
      isStepTransitioningRef.current = true;
      Animated.timing(stepOpacity, {
        toValue: 0,
        duration: 150,
        easing: Easing.out(Easing.quad),
        useNativeDriver: true,
      }).start(() => {
        setRenderedStep(nextStep);
        stepOpacity.setValue(0);
        stepTranslateY.setValue(6);
        Animated.parallel([
          Animated.timing(stepOpacity, {
            toValue: 1,
            duration: 150,
            easing: Easing.out(Easing.quad),
            useNativeDriver: true,
          }),
          Animated.timing(stepTranslateY, {
            toValue: 0,
            duration: 150,
            easing: Easing.out(Easing.quad),
            useNativeDriver: true,
          }),
        ]).start(() => {
          isStepTransitioningRef.current = false;
        });
      });
    },
    [renderedStep, stepOpacity, stepTranslateY],
  );

  useEffect(() => {
    if (!visible) return;
    setRenderedStep(1);
    setSelectedService(null);
    setSelectedSlot(null);
    setActiveCategory(null);
    setClientName("");
    setClientPhone("");
    setBooking(false);
    setServices([]);
    setSlotOptions([]);
    setServicesLoading(true);
    setSlotsLoading(false);
    serviceListOpacity.setValue(0);
    serviceListTranslateY.setValue(6);
    slotListOpacity.setValue(0);
    slotListTranslateY.setValue(6);
    stepOpacity.setValue(1);
    stepTranslateY.setValue(0);

    let cancelled = false;
    void Promise.resolve(
      supabase
        .from("services")
        .select("id, name, category")
        .eq("shop_id", shopId)
        .eq("is_active", true)
        .order("display_order", { ascending: true }),
    ).then(({ data }) => {
      if (cancelled) return;
      setServices((data ?? []) as ServiceRow[]);
    }).finally(() => {
      if (cancelled) return;
      setServicesLoading(false);
    });
    return () => {
      cancelled = true;
    };
  }, [
    visible,
    shopId,
    serviceListOpacity,
    serviceListTranslateY,
    slotListOpacity,
    slotListTranslateY,
    stepOpacity,
    stepTranslateY,
  ]);

  useEffect(() => {
    if (!visible) return;
    const pulseLoop = Animated.loop(
      Animated.sequence([
        Animated.timing(pulseOpacity, {
          toValue: 0.8,
          duration: 500,
          easing: Easing.inOut(Easing.quad),
          useNativeDriver: true,
        }),
        Animated.timing(pulseOpacity, {
          toValue: 0.3,
          duration: 500,
          easing: Easing.inOut(Easing.quad),
          useNativeDriver: true,
        }),
      ]),
    );
    pulseLoop.start();
    return () => {
      pulseLoop.stop();
    };
  }, [visible, pulseOpacity]);

  useEffect(() => {
    if (!visible || renderedStep !== 1 || servicesLoading) return;
    serviceListOpacity.setValue(0);
    serviceListTranslateY.setValue(6);
    Animated.parallel([
      Animated.timing(serviceListOpacity, {
        toValue: 1,
        duration: 150,
        easing: Easing.out(Easing.quad),
        useNativeDriver: true,
      }),
      Animated.timing(serviceListTranslateY, {
        toValue: 0,
        duration: 150,
        easing: Easing.out(Easing.quad),
        useNativeDriver: true,
      }),
    ]).start();
  }, [
    visible,
    renderedStep,
    servicesLoading,
    serviceListOpacity,
    serviceListTranslateY,
  ]);

  useEffect(() => {
    if (!visible || renderedStep !== 2 || slotsLoading) return;
    slotListOpacity.setValue(0);
    slotListTranslateY.setValue(6);
    Animated.parallel([
      Animated.timing(slotListOpacity, {
        toValue: 1,
        duration: 150,
        easing: Easing.out(Easing.quad),
        useNativeDriver: true,
      }),
      Animated.timing(slotListTranslateY, {
        toValue: 0,
        duration: 150,
        easing: Easing.out(Easing.quad),
        useNativeDriver: true,
      }),
    ]).start();
  }, [visible, renderedStep, slotsLoading, slotListOpacity, slotListTranslateY]);

  const loadSlotsForService = useCallback(
    async (serviceId: string) => {
      const reqId = ++slotReqIdRef.current;
      setSlotsLoading(true);
      setSlotOptions([]);

      const withPool = await supabase
        .from("barber_services")
        .select(`
          id, barber_id, service_id, price, duration_minutes, is_in_next_available_pool,
          barbers!inner(id, name, display_name, avatar_url, status)
        `)
        .eq("service_id", serviceId)
        .eq("is_offered", true);

      let rows = withPool.data as BarberServiceRow[] | null;
      const hasPool = !withPool.error;

      if (withPool.error) {
        const fallback = await supabase
          .from("barber_services")
          .select(`
            id, barber_id, service_id, price, duration_minutes,
            barbers!inner(id, name, display_name, avatar_url, status)
          `)
          .eq("service_id", serviceId)
          .eq("is_offered", true);
        rows = fallback.data as BarberServiceRow[] | null;
      }

      const filtered = (rows ?? []).filter((row) => {
        const barber = normalizeBarber(row.barbers);
        if (!barber || barber.status !== "active") return false;
        if (!hasPool) return true;
        return row.is_in_next_available_pool !== false;
      });

      const nowAtRun = toZonedTime(new Date(), shopTz);
      const nowPlus15 = nowAtRun.getHours() * 60 + nowAtRun.getMinutes() + 15;

      const options = await Promise.all(
        filtered.map(async (bs): Promise<SlotOption | null> => {
          const barber = normalizeBarber(bs.barbers);
          if (!barber) return null;
          const duration = Math.max(10, bs.duration_minutes ?? 30);

          const [schedRes, busyRes] = await Promise.all([
            supabase
              .from("availability_schedules")
              .select("start_time, end_time, is_available")
              .eq("barber_id", barber.id)
              .eq("day_of_week", dow)
              .eq("is_available", true)
              .maybeSingle(),
            supabase
              .from("appointments")
              .select("start_time, end_time")
              .eq("shop_id", shopId)
              .eq("barber_id", barber.id)
              .eq("appointment_date", todayStr)
              .neq("status", "cancelled")
              .order("start_time", { ascending: true }),
          ]);

          const sched = schedRes.data as ScheduleRow | null;
          if (!sched?.start_time || !sched?.end_time || !sched.is_available) {
            return null;
          }

          const busy = (busyRes.data ?? []) as BusyApt[];
          const dayStart = Math.max(timeToMinutes(sched.start_time), nowPlus15);
          const dayEnd = timeToMinutes(sched.end_time);
          if (dayStart + duration > dayEnd) return null;

          for (let start = dayStart; start + duration <= dayEnd; start += 5) {
            const end = start + duration;
            const hasConflict = busy.some((b) => {
              const bStart = timeToMinutes(b.start_time);
              const bEnd = timeToMinutes(b.end_time);
              return overlaps(start, end, bStart, bEnd);
            });
            if (!hasConflict) {
              return {
                barber,
                barberService: bs,
                slotStart: minutesToTime(start),
                slotEnd: minutesToTime(end),
              };
            }
          }
          return null;
        }),
      );

      if (reqId !== slotReqIdRef.current) return;

      const valid = options.filter((v): v is SlotOption => v != null);
      valid.sort((a, b) => {
        const aMin = timeToMinutes(a.slotStart);
        const bMin = timeToMinutes(b.slotStart);
        const diff = aMin - bMin;
        if (Math.abs(diff) <= 15) {
          const aYou = a.barber.id === loggedInBarberId;
          const bYou = b.barber.id === loggedInBarberId;
          if (aYou && !bYou) return -1;
          if (!aYou && bYou) return 1;
        }
        return diff;
      });

      setSlotOptions(valid.slice(0, 6));
      setSlotsLoading(false);
    },
    [dow, loggedInBarberId, shopId, shopTz, todayStr],
  );

  const slotContext = useMemo(() => {
    if (!selectedSlot || !selectedService) return "";
    return `${barberLabel(selectedSlot.barber)} · ${
      format(new Date(`2000-01-01T${selectedSlot.slotStart}`), "h:mm a")
    } · ${selectedService.name}`;
  }, [selectedService, selectedSlot]);

  const canBook = clientName.trim().length > 0 && selectedSlot != null;

  const onBook = async () => {
    if (!canBook || !selectedSlot) return;
    setBooking(true);
    const { error } = await supabase.from("appointments").insert({
      shop_id: shopId,
      barber_id: selectedSlot.barber.id,
      service_id: selectedSlot.barberService.service_id,
      barber_service_id: selectedSlot.barberService.id,
      client_name: clientName.trim(),
      client_phone: clientPhone.trim() || null,
      client_email: null,
      appointment_date: todayStr,
      start_time: selectedSlot.slotStart,
      end_time: selectedSlot.slotEnd,
      price_charged:
        selectedSlot.barberService.price != null
          ? Number(selectedSlot.barberService.price)
          : null,
      booking_source: "walk_in",
      status: "confirmed",
      notes: null,
    });
    setBooking(false);
    if (error) {
      Alert.alert("Could not book walk-in", error.message);
      return;
    }
    onBooked();
    onClose();
  };

  const renderHeaderText = () => {
    if (renderedStep === 1) return "Book a walk-in";
    if (renderedStep === 2) return "Next available today";
    return slotContext || "Walk-in details";
  };

  return (
    <NovaSheet
      visible={visible}
      onClose={onClose}
      animation="custom"
      height={0.7}
      scrollable={false}
      renderHeader={() => null}
    >
          <Animated.View
            style={{
              flex: 1,
              opacity: stepOpacity,
              transform: [{ translateY: stepTranslateY }],
            }}
          >
            <View style={styles.headerRow}>
              <Text
                style={renderedStep === 3 ? styles.contextLine : styles.headerTitle}
                numberOfLines={2}
              >
                {renderHeaderText()}
              </Text>
              <TouchableOpacity onPress={onClose} hitSlop={12} delayPressIn={0}>
                <View pointerEvents="none">
                  <X size={20} color={MUTED} />
                </View>
              </TouchableOpacity>
            </View>

            {renderedStep === 1 ? (
              <View style={styles.stepWrap}>
                {servicesLoading ? (
                  <View style={styles.stepLoadingSpacer} />
                ) : (
                  <Animated.View
                    style={{
                      flex: 1,
                      opacity: serviceListOpacity,
                      transform: [{ translateY: serviceListTranslateY }],
                    }}
                  >
                    <ScrollView
                      style={styles.scroll}
                      contentContainerStyle={styles.scrollContent}
                      keyboardShouldPersistTaps="handled"
                      showsVerticalScrollIndicator={false}
                    >
                        {categoryKeys.map((key) => {
                        const isOpen = activeCategory === key;
                        const items = categoryGroups[key] ?? [];
                        return (
                          <View key={key} style={styles.categoryCard}>
                            <TouchableOpacity
                              style={styles.categoryHeader}
                              onPress={() => setActiveCategory(isOpen ? null : key)}
                              activeOpacity={0.85}
                              delayPressIn={0}
                            >
                              <View style={styles.categoryLeft}>
                                <View pointerEvents="none" style={styles.categoryIconWrap}>
                                  <Scissors size={16} color={NOVA_GREEN} strokeWidth={2.2} />
                                </View>
                                <View>
                                  <Text style={styles.categoryLabel}>
                                    {CATEGORY_META[key]?.label ?? key}
                                  </Text>
                                  {!isOpen ? (
                                    <Text style={styles.categoryCount}>
                                      {items.length} service{items.length !== 1 ? "s" : ""}
                                    </Text>
                                  ) : null}
                                </View>
                              </View>
                              <View pointerEvents="none">
                                <ChevronRight
                                  size={16}
                                  color={isOpen ? NOVA_GREEN : MUTED}
                                  strokeWidth={2}
                                  style={{ transform: [{ rotate: isOpen ? "90deg" : "0deg" }] }}
                                />
                              </View>
                            </TouchableOpacity>
                            {isOpen ? (
                              <View style={styles.categoryServices}>
                                {items.map((s) => (
                                  <TouchableOpacity
                                    key={s.id}
                                    style={styles.serviceItem}
                                    onPress={() => {
                                      setSelectedService(s);
                                      setSelectedSlot(null);
                                      setClientName("");
                                      setClientPhone("");
                                      transitionToStep(2);
                                      void loadSlotsForService(s.id);
                                    }}
                                    activeOpacity={0.85}
                                    delayPressIn={0}
                                  >
                                    <Text style={styles.itemTitle}>{s.name}</Text>
                                  </TouchableOpacity>
                                ))}
                              </View>
                            ) : null}
                          </View>
                        );
                      })}
                    </ScrollView>
                  </Animated.View>
                )}
              </View>
            ) : null}

            {renderedStep === 2 ? (
              <View style={styles.stepWrap}>
                {slotsLoading ? (
                  <View style={styles.findingWrap}>
                    <Animated.View style={[styles.dot, styles.dotInline, { opacity: pulseOpacity }]} />
                    <Text style={styles.findingText}>Finding the best option...</Text>
                  </View>
                ) : slotOptions.length === 0 ? (
                  <View style={styles.noneWrap}>
                    <Text style={styles.noneTitle}>No availability today</Text>
                    <TouchableOpacity
                      style={styles.closeBtn}
                      onPress={onClose}
                      activeOpacity={0.85}
                      delayPressIn={0}
                    >
                      <Text style={styles.closeBtnText}>Close</Text>
                    </TouchableOpacity>
                  </View>
                ) : (
                  <Animated.View
                    style={{
                      flex: 1,
                      opacity: slotListOpacity,
                      transform: [{ translateY: slotListTranslateY }],
                    }}
                  >
                    <ScrollView
                      style={styles.scroll}
                      contentContainerStyle={styles.scrollContent}
                      keyboardShouldPersistTaps="handled"
                      showsVerticalScrollIndicator={false}
                    >
                      {slotOptions.map((opt) => {
                        const isYou = opt.barber.id === loggedInBarberId;
                        return (
                          <TouchableOpacity
                            key={`${opt.barberService.id}-${opt.slotStart}`}
                            style={styles.slotRow}
                            onPress={() => {
                              setSelectedSlot(opt);
                              transitionToStep(3);
                            }}
                            activeOpacity={0.85}
                            delayPressIn={0}
                          >
                            <View style={styles.avatarCol}>
                              {opt.barber.avatar_url ? (
                                <Image source={{ uri: opt.barber.avatar_url }} style={styles.avatar} />
                              ) : (
                                <View style={styles.avatarFallback}>
                                  <Text style={styles.avatarFallbackText}>
                                    {(barberLabel(opt.barber)[0] || "?").toUpperCase()}
                                  </Text>
                                </View>
                              )}
                              {isYou ? <Text style={styles.youTag}>You</Text> : null}
                            </View>
                            <View style={styles.slotMid}>
                              <Text style={styles.slotBarber}>{barberLabel(opt.barber)}</Text>
                              <Text style={styles.slotTime}>
                                {format(new Date(`2000-01-01T${opt.slotStart}`), "h:mm a")}
                              </Text>
                            </View>
                            <Text style={styles.slotPrice}>
                              {opt.barberService.price != null
                                ? `$${Number(opt.barberService.price).toFixed(0)}`
                                : "—"}
                            </Text>
                          </TouchableOpacity>
                        );
                      })}
                    </ScrollView>
                  </Animated.View>
                )}
                <TouchableOpacity
                  onPress={() => {
                    setActiveCategory(null);
                    transitionToStep(1);
                  }}
                  activeOpacity={0.85}
                  delayPressIn={0}
                  style={styles.backBtn}
                >
                  <View pointerEvents="none" style={styles.backIcon}>
                    <ArrowLeft size={14} color={MUTED} />
                  </View>
                  <Text style={styles.backText}>Back</Text>
                </TouchableOpacity>
              </View>
            ) : null}

            {renderedStep === 3 ? (
              <View style={styles.stepWrap}>
                <ScrollView
                  style={styles.scroll}
                  contentContainerStyle={styles.scrollContent}
                  keyboardShouldPersistTaps="handled"
                  showsVerticalScrollIndicator={false}
                >
                  <TextInput
                    style={styles.input}
                    value={clientName}
                    onChangeText={setClientName}
                    placeholder="Name"
                    placeholderTextColor={colors.textTertiary}
                  />
                  <TextInput
                    style={[styles.input, styles.inputGap]}
                    value={clientPhone}
                    onChangeText={setClientPhone}
                    placeholder="Phone"
                    placeholderTextColor={colors.textTertiary}
                    keyboardType="phone-pad"
                  />
                  <TouchableOpacity
                    style={[styles.bookBtn, !canBook && styles.bookBtnDisabled]}
                    disabled={!canBook || booking}
                    onPress={() => void onBook()}
                    activeOpacity={0.85}
                    delayPressIn={0}
                  >
                    <Text style={[styles.bookBtnText, !canBook && styles.bookBtnTextDisabled]}>
                      {booking ? "Booking..." : "Book Walk-in"}
                    </Text>
                  </TouchableOpacity>
                </ScrollView>
                <TouchableOpacity
                  onPress={() => transitionToStep(2)}
                  activeOpacity={0.85}
                  delayPressIn={0}
                  style={styles.backBtn}
                >
                  <View pointerEvents="none" style={styles.backIcon}>
                    <ArrowLeft size={14} color={MUTED} />
                  </View>
                  <Text style={styles.backText}>Back</Text>
                </TouchableOpacity>
              </View>
            ) : null}
          </Animated.View>
    </NovaSheet>
  );
}

const styles = StyleSheet.create({
  headerRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 16,
    paddingBottom: 12,
  },
  headerTitle: {
    fontSize: 16,
    fontWeight: "600",
    fontFamily: "Satoshi-Medium",
    color: LABEL,
  },
  contextLine: {
    flex: 1,
    marginRight: 8,
    fontSize: 13,
    fontFamily: "Satoshi-Regular",
    color: MUTED,
  },
  stepWrap: {
    flex: 1,
  },
  scroll: {
    flex: 1,
  },
  scrollContent: {
    paddingBottom: 16,
  },
  centerLoading: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
  },
  stepLoadingSpacer: {
    flex: 1,
  },
  findingWrap: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    marginTop: 30,
  },
  findingText: {
    fontSize: 14,
    fontWeight: "500",
    fontFamily: "Satoshi-Medium",
    color: MUTED,
  },
  dot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: NOVA_GREEN,
  },
  dotInline: {
    marginRight: 8,
  },
  categoryCard: {
    backgroundColor: CARD_BG,
    borderRadius: 12,
    marginBottom: 8,
    marginHorizontal: 16,
    overflow: "hidden",
  },
  categoryHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingVertical: 16,
    paddingHorizontal: 16,
  },
  categoryLeft: {
    flexDirection: "row",
    alignItems: "center",
    flex: 1,
  },
  categoryIconWrap: {
    width: 36,
    height: 36,
    borderRadius: 10,
    backgroundColor: "rgba(0,214,143,0.10)",
    alignItems: "center",
    justifyContent: "center",
    marginRight: 12,
  },
  categoryLabel: {
    fontSize: 15,
    fontWeight: "500",
    fontFamily: "Satoshi-Medium",
    color: LABEL,
  },
  categoryCount: {
    fontSize: 12,
    fontFamily: "Satoshi-Regular",
    color: MUTED,
    marginTop: 2,
  },
  categoryServices: {
    borderTopWidth: 1,
    borderTopColor: colors.border,
    paddingBottom: 4,
  },
  serviceItem: {
    paddingVertical: 12,
    paddingHorizontal: 16,
    paddingLeft: 64,
  },
  itemRow: {
    backgroundColor: CARD_BG,
    borderRadius: 12,
    paddingVertical: 14,
    paddingHorizontal: 16,
    marginBottom: 6,
    marginHorizontal: 16,
  },
  itemTitle: {
    fontSize: 14,
    fontWeight: "500",
    fontFamily: "Satoshi-Medium",
    color: LABEL,
  },
  slotRow: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: CARD_BG,
    borderRadius: 12,
    paddingVertical: 12,
    paddingHorizontal: 16,
    marginBottom: 6,
    marginHorizontal: 16,
  },
  avatarCol: {
    width: 48,
    alignItems: "center",
    marginRight: 10,
  },
  avatar: {
    width: 36,
    height: 36,
    borderRadius: 18,
  },
  avatarFallback: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: colors.obsidian600,
    alignItems: "center",
    justifyContent: "center",
  },
  avatarFallbackText: {
    fontSize: 12,
    fontWeight: "600",
    fontFamily: "Satoshi-Medium",
    color: LABEL,
  },
  youTag: {
    marginTop: 3,
    fontSize: 10,
    fontWeight: "600",
    fontFamily: "Satoshi-Medium",
    color: NOVA_GREEN,
  },
  slotMid: {
    flex: 1,
    marginRight: 8,
  },
  slotBarber: {
    fontSize: 14,
    fontWeight: "500",
    fontFamily: "Satoshi-Medium",
    color: LABEL,
  },
  slotTime: {
    marginTop: 2,
    fontSize: 12,
    fontFamily: "Satoshi-Regular",
    color: MUTED,
  },
  slotPrice: {
    fontSize: 14,
    fontWeight: "600",
    fontFamily: "Satoshi-Medium",
    color: NOVA_GREEN,
  },
  noneWrap: {
    alignItems: "center",
    marginTop: 20,
    paddingHorizontal: 20,
  },
  noneTitle: {
    fontSize: 14,
    fontFamily: "Satoshi-Regular",
    color: MUTED,
  },
  closeBtn: {
    marginTop: 12,
    backgroundColor: "rgba(255,255,255,0.08)",
    borderRadius: 10,
    paddingVertical: 10,
    paddingHorizontal: 16,
  },
  closeBtnText: {
    fontSize: 13,
    fontWeight: "600",
    fontFamily: "Satoshi-Medium",
    color: LABEL,
  },
  backBtn: {
    flexDirection: "row",
    alignItems: "center",
    marginHorizontal: 16,
    paddingVertical: 10,
  },
  backIcon: {
    marginRight: 6,
  },
  backText: {
    fontSize: 13,
    color: MUTED,
    fontWeight: "500",
    fontFamily: "Satoshi-Medium",
  },
  input: {
    height: 48,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.10)",
    backgroundColor: "rgba(255,255,255,0.06)",
    color: LABEL,
    fontSize: 14,
    paddingHorizontal: 14,
    marginHorizontal: 16,
  },
  inputGap: {
    marginTop: 10,
  },
  bookBtn: {
    marginTop: 12,
    marginHorizontal: 16,
    borderRadius: 10,
    paddingVertical: 12,
    alignItems: "center",
    backgroundColor: NOVA_GREEN,
  },
  bookBtnDisabled: {
    backgroundColor: "rgba(255,255,255,0.06)",
  },
  bookBtnText: {
    fontSize: 14,
    fontWeight: "600",
    fontFamily: "Satoshi-Medium",
    color: BG,
  },
  bookBtnTextDisabled: {
    color: DIM,
  },
});
