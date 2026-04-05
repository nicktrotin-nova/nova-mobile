import { useState, useEffect, useCallback, useMemo, useRef } from "react";
import {
  View,
  Text,
  ScrollView,
  TouchableOpacity,
  TextInput,
  StyleSheet,
  Dimensions,
  ActivityIndicator,
  Alert,
  Animated,
  Easing,
} from "react-native";
import NovaSheet from "./NovaSheet";
import { format, addDays, parse } from "date-fns";
import { toZonedTime } from "date-fns-tz";
import {
  X,
  Search,
  ArrowLeft,
  User,
  Scissors,
  Calendar,
  Clock,
  ChevronRight,
} from "lucide-react-native";
import { supabase } from "../lib/supabase";
import { colors, BG, NOVA_GREEN, LABEL, MUTED, DIM, CARD_BG } from "../theme/colors";
import {
  timeToMinutes,
  minutesToTime,
  formatTime12,
} from "../utils/formatters";
import { generateSlots, toBusySlots } from "../utils/availability";
import { fetchBusySlots } from "../api/appointments";
import { fetchScheduleForDay } from "../api/schedules";
import { fetchBarberServices } from "../api/barbers";
import { SHOP_TZ } from "../config/shop";

export interface CreateBookingSheetProps {
  visible: boolean;
  onClose: () => void;
  onBookingCreated: () => void;
  shopId: string;
  barberId: string;
  defaultDate?: string;
  defaultTime?: string;
  initialClientName?: string;
  initialClientPhone?: string;
  shopTz?: string;
}

const DEFAULT_TZ = SHOP_TZ;

interface ClientRow {
  id: string;
  first_name: string | null;
  last_name: string | null;
  phone: string | null;
}

interface ServiceOption {
  id: string;
  service_id: string;
  price: number | null;
  services: {
    name: string;
    duration_minutes: number | null;
  } | null;
}

/**
 * Adaptive booking flow:
 * - "Quick mode" when date+time are pre-filled (calendar slot tap): single screen
 * - "Guided mode" when nothing pre-filled (FAB): 2-step wizard
 *
 * Returning client auto-selects their last service.
 */

type Step = 1 | 2;



function sanitizeIlike(q: string): string {
  return q.replace(/%/g, "").replace(/,/g, "").trim();
}

export default function CreateBookingSheet({
  visible,
  onClose,
  onBookingCreated,
  shopId,
  barberId,
  defaultDate,
  defaultTime,
  initialClientName,
  initialClientPhone,
  shopTz = DEFAULT_TZ,
}: CreateBookingSheetProps) {
  const sheetMaxH = Dimensions.get("window").height * 0.9;

  const stepOpacity = useRef(new Animated.Value(1)).current;
  const stepTranslateY = useRef(new Animated.Value(0)).current;
  const isTransitioning = useRef(false);

  const todayStr = useMemo(
    () => format(toZonedTime(new Date(), shopTz), "yyyy-MM-dd"),
    [shopTz],
  );

  // Quick mode: date + time already known (calendar slot tap)
  const isQuickMode = !!(defaultDate && defaultTime);

  // ── State ──
  const [step, setStep] = useState<Step>(1);

  // Client
  const [clientName, setClientName] = useState("");
  const [clientPhone, setClientPhone] = useState("");
  const [clientSuggestions, setClientSuggestions] = useState<ClientRow[]>([]);
  const [showClientDropdown, setShowClientDropdown] = useState(false);
  const searchTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Service
  const [serviceOptions, setServiceOptions] = useState<ServiceOption[]>([]);
  const [servicesLoading, setServicesLoading] = useState(false);
  const [selectedService, setSelectedService] = useState<ServiceOption | null>(null);
  const [autoSelectedService, setAutoSelectedService] = useState(false);

  // Date + Time
  const [selectedDateStr, setSelectedDateStr] = useState(defaultDate ?? todayStr);
  const [stripDates, setStripDates] = useState<Date[]>([]);
  const [slots, setSlots] = useState<string[]>([]);
  const [slotsLoading, setSlotsLoading] = useState(false);
  const [selectedSlot, setSelectedSlot] = useState<string | null>(null);

  // Notes + booking
  const [notes, setNotes] = useState("");
  const [showNotes, setShowNotes] = useState(false);
  const [booking, setBooking] = useState(false);

  const durationMin = useMemo(() => {
    const d = selectedService?.services?.duration_minutes;
    return Math.max(15, d ?? 30);
  }, [selectedService]);

  // ── Step transitions (guided mode only) ──
  const transitionToStep = useCallback(
    (nextStep: Step) => {
      if (nextStep === step || isTransitioning.current) return;
      isTransitioning.current = true;
      Animated.timing(stepOpacity, {
        toValue: 0,
        duration: 120,
        easing: Easing.out(Easing.quad),
        useNativeDriver: true,
      }).start(() => {
        setStep(nextStep);
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
          isTransitioning.current = false;
        });
      });
    },
    [step, stepOpacity, stepTranslateY],
  );

  // ── Lifecycle ──
  const resetForm = useCallback(() => {
    setStep(1);
    setClientName("");
    setClientPhone("");
    setClientSuggestions([]);
    setShowClientDropdown(false);
    setSelectedService(null);
    setAutoSelectedService(false);
    setSelectedDateStr(defaultDate ?? todayStr);
    setSelectedSlot(defaultTime ?? null);
    setSlots([]);
    setNotes("");
    setShowNotes(false);
    setBooking(false);
    stepOpacity.setValue(1);
    stepTranslateY.setValue(0);
    isTransitioning.current = false;
  }, [defaultDate, defaultTime, todayStr, stepOpacity, stepTranslateY]);

  useEffect(() => {
    if (!visible) {
      resetForm();
      return;
    }
    setSelectedDateStr(defaultDate ?? todayStr);
    setSelectedSlot(defaultTime ?? null);
    const today = toZonedTime(new Date(), shopTz);
    setStripDates(Array.from({ length: 14 }, (_, i) => addDays(today, i)));
    if (initialClientName) setClientName(initialClientName);
    if (initialClientPhone) setClientPhone(initialClientPhone);
  }, [visible, defaultDate, defaultTime, todayStr, shopTz, resetForm, initialClientName, initialClientPhone]);

  // Load services
  useEffect(() => {
    if (!visible || !barberId) return;
    let cancelled = false;
    (async () => {
      setServicesLoading(true);
      let { data, error } = await supabase
        .from("barber_services")
        .select("id, service_id, price, services ( name, duration_minutes )")
        .eq("barber_id", barberId)
        .eq("is_offered", true);
      if (error) {
        ({ data, error } = await supabase
          .from("barber_services")
          .select("id, service_id, price, services ( name, duration_minutes )")
          .eq("barber_id", barberId));
      }
      if (cancelled) return;
      setServiceOptions(!error && data ? (data as unknown as ServiceOption[]) : []);
      setServicesLoading(false);
    })();
    return () => { cancelled = true; };
  }, [visible, barberId]);

  // ── Client search — checks clients table first, falls back to appointments ──
  useEffect(() => {
    if (clientName.length < 2) {
      setClientSuggestions([]);
      setShowClientDropdown(false);
      return;
    }
    if (searchTimerRef.current) clearTimeout(searchTimerRef.current);
    searchTimerRef.current = setTimeout(async () => {
      const q = sanitizeIlike(clientName);
      if (q.length < 2) return;
      const pattern = `%${q}%`;

      // Try clients table first
      const { data: clientRows } = await supabase
        .from("clients")
        .select("id, first_name, last_name, phone")
        .or(`first_name.ilike.${pattern},last_name.ilike.${pattern},phone.ilike.${pattern}`)
        .limit(5);

      if (clientRows && clientRows.length > 0) {
        setClientSuggestions(clientRows as ClientRow[]);
        setShowClientDropdown(true);
        return;
      }

      // Fallback: search past appointments for client names
      const { data: aptRows } = await supabase
        .from("appointments")
        .select("client_name, client_phone")
        .eq("barber_id", barberId)
        .ilike("client_name", pattern)
        .order("appointment_date", { ascending: false })
        .limit(20);

      if (aptRows && aptRows.length > 0) {
        // Deduplicate by name
        const seen = new Map<string, ClientRow>();
        for (const a of aptRows) {
          const name = (a.client_name ?? "").trim();
          if (!name || seen.has(name.toLowerCase())) continue;
          const parts = name.split(/\s+/);
          seen.set(name.toLowerCase(), {
            id: name,
            first_name: parts[0] ?? null,
            last_name: parts.slice(1).join(" ") || null,
            phone: (a.client_phone as string) ?? null,
          });
          if (seen.size >= 5) break;
        }
        const results = Array.from(seen.values());
        if (results.length > 0) {
          setClientSuggestions(results);
          setShowClientDropdown(true);
          return;
        }
      }

      setClientSuggestions([]);
      setShowClientDropdown(false);
    }, 280);
    return () => { if (searchTimerRef.current) clearTimeout(searchTimerRef.current); };
  }, [clientName, barberId]);

  // ── Slot generation ──
  const fetchSlots = useCallback(
    async (dateStr: string) => {
      if (!barberId || !selectedService) { setSlots([]); return; }
      setSlotsLoading(true);
      try {
        const d = parse(dateStr, "yyyy-MM-dd", new Date());
        const dow = d.getDay();
        const { data: sched } = await fetchScheduleForDay(supabase, {
          barberId, dayOfWeek: dow,
        });
        if (!sched?.start_time || !sched?.end_time) { setSlots([]); return; }
        const { data: appts } = await fetchBusySlots(supabase, {
          shopId, barberId, date: dateStr,
        });
        const busy = toBusySlots(appts ?? []);
        const generated = generateSlots(sched.start_time, sched.end_time, durationMin, busy);
        setSlots(generated);
        // In quick mode, verify the pre-filled slot is still available
        if (defaultTime && !generated.includes(defaultTime)) {
          setSelectedSlot(null);
        }
      } finally { setSlotsLoading(false); }
    },
    [barberId, shopId, selectedService, durationMin, defaultTime],
  );

  useEffect(() => {
    if (!visible || !selectedService) { setSlots([]); return; }
    void fetchSlots(selectedDateStr);
  }, [visible, selectedService, selectedDateStr, fetchSlots]);

  // Auto-select default time when slots load (quick mode)
  useEffect(() => {
    if (!defaultTime || slots.length === 0) return;
    if (slots.includes(defaultTime)) setSelectedSlot(defaultTime);
  }, [defaultTime, slots]);

  // ── Returning client: auto-select last service ──
  const pickClient = useCallback(
    async (c: ClientRow) => {
      const fn = (c.first_name ?? "").trim();
      const ln = (c.last_name ?? "").trim();
      setClientName([fn, ln].filter(Boolean).join(" ") || fn || ln || "");
      setClientPhone((c.phone ?? "").trim());
      setShowClientDropdown(false);
      setClientSuggestions([]);

      // Find their last completed appointment with this barber
      const { data: lastApt } = await supabase
        .from("appointments")
        .select("barber_service_id")
        .eq("barber_id", barberId)
        .ilike("client_name", `%${fn}%`)
        .eq("status", "completed")
        .order("appointment_date", { ascending: false })
        .limit(1)
        .maybeSingle();

      if (lastApt?.barber_service_id && serviceOptions.length > 0) {
        const match = serviceOptions.find(
          (s) => s.id === lastApt.barber_service_id,
        );
        if (match) {
          setSelectedService(match);
          setAutoSelectedService(true);
        }
      }
    },
    [barberId, serviceOptions],
  );

  const normalizeServiceRow = (row: ServiceOption): ServiceOption => {
    const s = row.services;
    let svc = s;
    if (Array.isArray(s)) {
      svc = (s[0] as { name: string; duration_minutes: number | null }) ?? null;
    }
    return { ...row, services: svc };
  };

  const dateDisplay = useMemo(() => {
    const d = parse(selectedDateStr, "yyyy-MM-dd", new Date());
    return format(d, "EEE, MMM d");
  }, [selectedDateStr]);

  const stripTodayStr = format(toZonedTime(new Date(), shopTz), "yyyy-MM-dd");

  // ── Validation ──
  const hasClient = clientName.trim().length > 0;
  const hasService = selectedService != null;
  const hasSlot = selectedSlot != null;
  const canBook = hasClient && hasService && hasSlot;

  // ── Book ──
  const handleBook = async () => {
    if (!canBook || !selectedService || !selectedSlot) return;
    setBooking(true);
    const startMin = timeToMinutes(selectedSlot);
    const newEnd = minutesToTime(startMin + durationMin);
    const startTime = `${selectedSlot}:00`;
    const price = selectedService.price != null ? Number(selectedService.price) : null;
    const { error } = await supabase.from("appointments").insert({
      shop_id: shopId, barber_id: barberId,
      client_name: clientName.trim(), client_phone: clientPhone.trim() || null, client_email: null,
      service_id: selectedService.service_id, barber_service_id: selectedService.id,
      appointment_date: selectedDateStr, start_time: startTime, end_time: newEnd,
      price_charged: price, booking_source: "phone_booking", status: "confirmed",
      notes: notes.trim() || null,
    });
    setBooking(false);
    if (error) { Alert.alert("Could not book", error.message); return; }
    onBookingCreated();
    onClose();
  };

  // ── Header ──
  const headerTitle = isQuickMode
    ? "Quick Book"
    : step === 1
      ? "Who and what?"
      : "Pick a time";

  // ══════════════════════════════════════════════════════════════════════════
  // QUICK MODE — single screen, date+time locked at top
  // ══════════════════════════════════════════════════════════════════════════
  if (isQuickMode) {
    return (
      <NovaSheet
        visible={visible}
        onClose={onClose}
        title="Quick Book"
        animation="custom"
        height={0.9}
        scrollable={false}
      >

            {/* Locked time context */}
            <View style={styles.contextBar}>
              <View pointerEvents="none">
                <Clock size={14} color={NOVA_GREEN} strokeWidth={2} />
              </View>
              <Text style={styles.contextText}>
                {dateDisplay} at {formatTime12(defaultTime!)}
              </Text>
            </View>

            {/* Client input — fixed above scroll so dropdown doesn't clip */}
            <View style={styles.clientSection}>
              <View style={styles.inputRow}>
                <View pointerEvents="none" style={styles.inputIcon}>
                  <Search size={18} color={DIM} strokeWidth={2} />
                </View>
                <TextInput
                  style={styles.inputFlex}
                  value={clientName}
                  onChangeText={(t) => {
                    setClientName(t);
                    if (t.length < 2) setShowClientDropdown(false);
                  }}
                  placeholder="Client name"
                  placeholderTextColor={DIM}
                  autoCorrect={false}
                  autoFocus
                />
              </View>
              {showClientDropdown && clientSuggestions.length > 0 && (
                <View style={styles.dropdown}>
                  {clientSuggestions.map((c) => {
                    const fn = (c.first_name ?? "").trim();
                    const ln = (c.last_name ?? "").trim();
                    const label = [fn, ln].filter(Boolean).join(" ");
                    return (
                      <TouchableOpacity
                        key={c.id}
                        style={styles.dropdownRow}
                        onPress={() => void pickClient(c)}
                        activeOpacity={0.7}
                      >
                        <Text style={styles.dropdownName} numberOfLines={1}>
                          {label || "Client"}
                        </Text>
                        {c.phone ? (
                          <Text style={styles.dropdownPhone}>{c.phone}</Text>
                        ) : null}
                      </TouchableOpacity>
                    );
                  })}
                </View>
              )}
              <TextInput
                style={[styles.input, { marginTop: 8 }]}
                value={clientPhone}
                onChangeText={setClientPhone}
                placeholder="Phone (optional)"
                placeholderTextColor={DIM}
                keyboardType="phone-pad"
              />
            </View>

            <ScrollView
              style={styles.scroll}
              contentContainerStyle={styles.scrollContent}
              keyboardShouldPersistTaps="handled"
              showsVerticalScrollIndicator={false}
            >
              {/* Service */}
              <Text style={[styles.sectionLabel, { marginTop: 20 }]}>
                {autoSelectedService ? "THE USUAL" : "SERVICE"}
              </Text>
              {servicesLoading ? (
                <ActivityIndicator color={NOVA_GREEN} style={styles.inlineSpinner} />
              ) : (
                serviceOptions.map((raw) => {
                  const row = normalizeServiceRow(raw);
                  const sel = selectedService?.id === row.id;
                  const name = row.services?.name ?? "Service";
                  const dur = row.services?.duration_minutes;
                  return (
                    <TouchableOpacity
                      key={row.id}
                      style={[styles.serviceCard, sel && styles.serviceCardSel]}
                      onPress={() => {
                        setSelectedService(row);
                        setAutoSelectedService(false);
                      }}
                      activeOpacity={0.75}
                      delayPressIn={0}
                    >
                      <View style={styles.serviceCardLeft}>
                        <Text style={[styles.serviceName, sel && styles.serviceNameSel]}>
                          {name}
                        </Text>
                        {dur != null && (
                          <Text style={styles.serviceDuration}>{dur} min</Text>
                        )}
                      </View>
                      <Text style={styles.servicePrice}>
                        {row.price != null ? `$${Number(row.price).toFixed(0)}` : "—"}
                      </Text>
                    </TouchableOpacity>
                  );
                })
              )}

              {/* Notes toggle */}
              {!showNotes ? (
                <TouchableOpacity
                  onPress={() => setShowNotes(true)}
                  activeOpacity={0.7}
                  style={styles.addNoteLink}
                >
                  <Text style={styles.addNoteLinkText}>+ Add a note</Text>
                </TouchableOpacity>
              ) : (
                <>
                  <Text style={[styles.sectionLabel, { marginTop: 16 }]}>NOTE</Text>
                  <TextInput
                    style={[styles.input, styles.notesInput]}
                    value={notes}
                    onChangeText={setNotes}
                    placeholder="Anything to remember?"
                    placeholderTextColor={DIM}
                    multiline
                    textAlignVertical="top"
                    autoFocus
                  />
                </>
              )}

              {/* Book */}
              <TouchableOpacity
                style={[styles.bookBtn, (!canBook || booking) && styles.btnDisabled]}
                disabled={!canBook || booking}
                onPress={handleBook}
                activeOpacity={0.85}
              >
                {booking ? (
                  <ActivityIndicator color={BG} />
                ) : (
                  <Text style={styles.bookBtnText}>
                    {hasService && selectedService?.price != null
                      ? `Book · $${Number(selectedService.price).toFixed(0)}`
                      : "Book Appointment"}
                  </Text>
                )}
              </TouchableOpacity>
            </ScrollView>
      </NovaSheet>
    );
  }

  // ══════════════════════════════════════════════════════════════════════════
  // GUIDED MODE — 2-step wizard (no pre-filled time)
  // Step 1: Client + Service
  // Step 2: Date + Time + Book
  // ══════════════════════════════════════════════════════════════════════════
  return (
    <NovaSheet
      visible={visible}
      onClose={onClose}
      animation="custom"
      height={0.9}
      scrollable={false}
      renderHeader={() => (
        <View style={styles.headerRow}>
          {step > 1 ? (
            <TouchableOpacity
              onPress={() => transitionToStep(1)}
              hitSlop={12}
              activeOpacity={0.7}
              style={styles.headerSide}
            >
              <View pointerEvents="none">
                <ArrowLeft size={20} color={LABEL} strokeWidth={2} />
              </View>
            </TouchableOpacity>
          ) : (
            <View style={styles.headerSide} />
          )}
          <View style={styles.headerCenter}>
            <Text style={styles.headerTitle}>{headerTitle}</Text>
            <View style={styles.stepDots}>
              {[1, 2].map((s) => (
                <View key={s} style={[styles.dot, s <= step && styles.dotActive]} />
              ))}
            </View>
          </View>
          <TouchableOpacity onPress={onClose} hitSlop={12} activeOpacity={0.7} style={styles.headerSide}>
            <View pointerEvents="none">
              <X size={22} color={MUTED} />
            </View>
          </TouchableOpacity>
        </View>
      )}
    >

          {/* Step content */}
          <Animated.View style={{ flex: 1, opacity: stepOpacity, transform: [{ translateY: stepTranslateY }] }}>
            {step === 1 && (
              <>
              {/* Client input — fixed above scroll so dropdown doesn't clip */}
              <View style={styles.clientSection}>
                <View style={styles.inputRow}>
                  <View pointerEvents="none" style={styles.inputIcon}>
                    <Search size={18} color={DIM} strokeWidth={2} />
                  </View>
                  <TextInput
                    style={styles.inputFlex}
                    value={clientName}
                    onChangeText={(t) => {
                      setClientName(t);
                      if (t.length < 2) setShowClientDropdown(false);
                    }}
                    placeholder="Client name"
                    placeholderTextColor={DIM}
                    autoCorrect={false}
                    autoFocus
                  />
                </View>
                {showClientDropdown && clientSuggestions.length > 0 && (
                  <View style={styles.dropdown}>
                    {clientSuggestions.map((c) => {
                      const fn = (c.first_name ?? "").trim();
                      const ln = (c.last_name ?? "").trim();
                      const label = [fn, ln].filter(Boolean).join(" ");
                      return (
                        <TouchableOpacity
                          key={c.id}
                          style={styles.dropdownRow}
                          onPress={() => void pickClient(c)}
                          activeOpacity={0.7}
                        >
                          <Text style={styles.dropdownName} numberOfLines={1}>
                            {label || "Client"}
                          </Text>
                          {c.phone ? (
                            <Text style={styles.dropdownPhone}>{c.phone}</Text>
                          ) : null}
                        </TouchableOpacity>
                      );
                    })}
                  </View>
                )}
                <TextInput
                  style={[styles.input, { marginTop: 8 }]}
                  value={clientPhone}
                  onChangeText={setClientPhone}
                  placeholder="Phone (optional)"
                  placeholderTextColor={DIM}
                  keyboardType="phone-pad"
                />
              </View>

              <ScrollView
                style={styles.scroll}
                contentContainerStyle={styles.scrollContent}
                keyboardShouldPersistTaps="handled"
                showsVerticalScrollIndicator={false}
              >
                {/* Service */}
                <Text style={[styles.sectionLabel, { marginTop: 20 }]}>
                  {autoSelectedService ? "THE USUAL" : "SERVICE"}
                </Text>
                {servicesLoading ? (
                  <ActivityIndicator color={NOVA_GREEN} style={styles.inlineSpinner} />
                ) : (
                  serviceOptions.map((raw) => {
                    const row = normalizeServiceRow(raw);
                    const sel = selectedService?.id === row.id;
                    const name = row.services?.name ?? "Service";
                    const dur = row.services?.duration_minutes;
                    return (
                      <TouchableOpacity
                        key={row.id}
                        style={[styles.serviceCard, sel && styles.serviceCardSel]}
                        onPress={() => {
                          setSelectedService(row);
                          setAutoSelectedService(false);
                        }}
                        activeOpacity={0.75}
                        delayPressIn={0}
                      >
                        <View style={styles.serviceCardLeft}>
                          <Text style={[styles.serviceName, sel && styles.serviceNameSel]}>
                            {name}
                          </Text>
                          {dur != null && (
                            <Text style={styles.serviceDuration}>{dur} min</Text>
                          )}
                        </View>
                        <Text style={styles.servicePrice}>
                          {row.price != null ? `$${Number(row.price).toFixed(0)}` : "—"}
                        </Text>
                      </TouchableOpacity>
                    );
                  })
                )}

                {/* Next */}
                <TouchableOpacity
                  style={[styles.nextBtn, !(hasClient && hasService) && styles.btnDisabled]}
                  disabled={!(hasClient && hasService)}
                  onPress={() => transitionToStep(2)}
                  activeOpacity={0.85}
                >
                  <Text style={styles.nextBtnText}>Pick a time</Text>
                  <View pointerEvents="none">
                    <ChevronRight size={18} color={BG} strokeWidth={2.5} />
                  </View>
                </TouchableOpacity>
              </ScrollView>
              </>
            )}

            {step === 2 && (
              <ScrollView
                style={styles.scroll}
                contentContainerStyle={styles.scrollContent}
                keyboardShouldPersistTaps="handled"
                showsVerticalScrollIndicator={false}
              >
                {/* Summary chip */}
                <View style={styles.summaryChip}>
                  <Text style={styles.summaryChipText} numberOfLines={1}>
                    {clientName.trim()} · {selectedService?.services?.name ?? "Service"}
                    {selectedService?.price != null ? ` · $${Number(selectedService.price).toFixed(0)}` : ""}
                  </Text>
                </View>

                {/* Date */}
                <Text style={styles.sectionLabel}>DATE</Text>
                <ScrollView
                  horizontal
                  showsHorizontalScrollIndicator={false}
                  contentContainerStyle={styles.dateStripContent}
                  style={styles.dateStrip}
                >
                  {stripDates.map((d) => {
                    const ds = format(d, "yyyy-MM-dd");
                    const sel = ds === selectedDateStr;
                    const isToday = ds === stripTodayStr;
                    return (
                      <TouchableOpacity
                        key={ds}
                        style={[styles.dateChip, sel && styles.dateChipSelected]}
                        onPress={() => setSelectedDateStr(ds)}
                        activeOpacity={0.75}
                      >
                        <Text style={[styles.dateChipDow, sel && styles.dateChipDowSel]}>
                          {format(d, "EEE")}
                        </Text>
                        <Text
                          style={[
                            styles.dateChipNum,
                            sel && styles.dateChipNumSel,
                            !sel && isToday && styles.dateChipNumToday,
                          ]}
                        >
                          {format(d, "d")}
                        </Text>
                      </TouchableOpacity>
                    );
                  })}
                </ScrollView>

                {/* Time */}
                <Text style={[styles.sectionLabel, { marginTop: 20 }]}>TIME</Text>
                {slotsLoading ? (
                  <ActivityIndicator color={NOVA_GREEN} style={styles.inlineSpinner} />
                ) : slots.length === 0 ? (
                  <Text style={styles.hint}>No slots available</Text>
                ) : (
                  <View style={styles.slotGrid}>
                    {slots.map((slot) => {
                      const sel = selectedSlot === slot;
                      return (
                        <TouchableOpacity
                          key={slot}
                          style={[styles.slotPill, sel && styles.slotPillSel]}
                          onPress={() => setSelectedSlot(slot)}
                          activeOpacity={0.75}
                          delayPressIn={0}
                        >
                          <Text style={[styles.slotPillText, sel && styles.slotPillTextSel]}>
                            {formatTime12(slot)}
                          </Text>
                        </TouchableOpacity>
                      );
                    })}
                  </View>
                )}

                {/* Notes toggle */}
                {!showNotes ? (
                  <TouchableOpacity
                    onPress={() => setShowNotes(true)}
                    activeOpacity={0.7}
                    style={styles.addNoteLink}
                  >
                    <Text style={styles.addNoteLinkText}>+ Add a note</Text>
                  </TouchableOpacity>
                ) : (
                  <>
                    <Text style={[styles.sectionLabel, { marginTop: 16 }]}>NOTE</Text>
                    <TextInput
                      style={[styles.input, styles.notesInput]}
                      value={notes}
                      onChangeText={setNotes}
                      placeholder="Anything to remember?"
                      placeholderTextColor={DIM}
                      multiline
                      textAlignVertical="top"
                    />
                  </>
                )}

                {/* Book */}
                <TouchableOpacity
                  style={[styles.bookBtn, (!canBook || booking) && styles.btnDisabled]}
                  disabled={!canBook || booking}
                  onPress={handleBook}
                  activeOpacity={0.85}
                >
                  {booking ? (
                    <ActivityIndicator color={BG} />
                  ) : (
                    <Text style={styles.bookBtnText}>
                      {hasService && selectedService?.price != null
                        ? `Book · $${Number(selectedService.price).toFixed(0)}`
                        : "Book Appointment"}
                    </Text>
                  )}
                </TouchableOpacity>
              </ScrollView>
            )}
          </Animated.View>
    </NovaSheet>
  );
}

const styles = StyleSheet.create({
  // Header
  headerRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 16,
    paddingBottom: 8,
  },
  headerSide: {
    width: 36,
    height: 36,
    alignItems: "center",
    justifyContent: "center",
  },
  headerCenter: {
    flex: 1,
    alignItems: "center",
  },
  headerTitle: {
    fontSize: 16,
    fontWeight: "700",
    fontFamily: "Satoshi-Bold",
    color: LABEL,
  },
  stepDots: {
    flexDirection: "row",
    gap: 6,
    marginTop: 6,
  },
  dot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: colors.obsidian500,
  },
  dotActive: {
    backgroundColor: NOVA_GREEN,
  },

  // Context bar (quick mode)
  contextBar: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    paddingVertical: 8,
    marginHorizontal: 20,
    marginBottom: 8,
    borderRadius: 8,
    backgroundColor: "rgba(0,214,143,0.08)",
    borderWidth: 1,
    borderColor: "rgba(0,214,143,0.15)",
  },
  contextText: {
    fontSize: 13,
    fontWeight: "600",
    fontFamily: "Satoshi-Medium",
    color: NOVA_GREEN,
  },

  // Scroll
  scroll: {},
  scrollContent: {
    paddingHorizontal: 20,
    paddingBottom: 40,
  },

  // Client search
  clientSection: {
    paddingHorizontal: 20,
    zIndex: 10,
    marginBottom: 4,
  },
  inputRow: {
    flexDirection: "row",
    alignItems: "center",
    height: 52,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.borderMedium,
    backgroundColor: colors.obsidian600,
    paddingHorizontal: 14,
  },
  inputIcon: { marginRight: 10 },
  inputFlex: {
    flex: 1,
    fontSize: 16,
    fontFamily: "Satoshi-Regular",
    color: LABEL,
    paddingVertical: 0,
  },
  input: {
    height: 52,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.borderMedium,
    backgroundColor: colors.obsidian600,
    paddingHorizontal: 14,
    fontSize: 16,
    fontFamily: "Satoshi-Regular",
    color: LABEL,
  },
  dropdown: {
    marginTop: 4,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.borderMedium,
    backgroundColor: colors.obsidian800,
    maxHeight: 200,
    overflow: "hidden",
  },
  dropdownRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingVertical: 14,
    paddingHorizontal: 14,
    borderBottomWidth: 1,
    borderBottomColor: colors.borderMedium,
  },
  dropdownName: {
    fontSize: 15,
    fontFamily: "Satoshi-Medium",
    fontWeight: "500",
    color: LABEL,
    flex: 1,
  },
  dropdownPhone: {
    fontSize: 13,
    fontFamily: "Satoshi-Regular",
    color: MUTED,
    marginLeft: 8,
  },

  // Section labels
  sectionLabel: {
    fontSize: 11,
    fontWeight: "600",
    fontFamily: "Satoshi-Medium",
    color: DIM,
    textTransform: "uppercase",
    letterSpacing: 0.5,
    marginBottom: 10,
  },
  inlineSpinner: { marginVertical: 16 },
  hint: { fontSize: 14, fontFamily: "Satoshi-Regular", color: DIM, marginVertical: 8 },

  // Service cards
  serviceCard: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    borderRadius: 12,
    padding: 14,
    borderWidth: 1,
    marginBottom: 6,
    borderColor: colors.borderMedium,
    backgroundColor: CARD_BG,
  },
  serviceCardSel: {
    borderColor: "rgba(245,243,239,0.25)",
    backgroundColor: "rgba(245,243,239,0.08)",
  },
  serviceCardLeft: { flex: 1, marginRight: 12 },
  serviceName: { fontSize: 15, fontWeight: "500", fontFamily: "Satoshi-Medium", color: LABEL },
  serviceNameSel: { color: LABEL },
  serviceDuration: { fontSize: 12, fontFamily: "Satoshi-Regular", color: DIM, marginTop: 3 },
  servicePrice: { fontSize: 15, fontWeight: "600", fontFamily: "Satoshi-Medium", color: NOVA_GREEN },

  // Next button
  nextBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 4,
    width: "100%",
    height: 52,
    borderRadius: 12,
    backgroundColor: NOVA_GREEN,
    marginTop: 24,
  },
  nextBtnText: {
    fontSize: 15,
    fontWeight: "600",
    fontFamily: "Satoshi-Medium",
    color: BG,
  },
  btnDisabled: { opacity: 0.35 },

  // Summary chip (guided step 2)
  summaryChip: {
    marginBottom: 16,
    paddingVertical: 10,
    paddingHorizontal: 14,
    borderRadius: 10,
    backgroundColor: colors.obsidian800,
    borderWidth: 1,
    borderColor: colors.borderMedium,
  },
  summaryChipText: {
    fontSize: 13,
    fontWeight: "500",
    fontFamily: "Satoshi-Medium",
    color: LABEL,
  },

  // Date strip
  dateStrip: { maxHeight: 72 },
  dateStripContent: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingVertical: 4,
  },
  dateChip: {
    minWidth: 44,
    paddingVertical: 6,
    paddingHorizontal: 10,
    borderRadius: 10,
    alignItems: "center",
    borderWidth: 1,
    borderColor: "transparent",
    backgroundColor: colors.obsidian600,
  },
  dateChipSelected: {
    backgroundColor: "rgba(245,243,239,0.08)",
    borderColor: "rgba(245,243,239,0.20)",
  },
  dateChipDow: { fontSize: 10, fontFamily: "Satoshi-Medium", color: DIM, fontWeight: "500" },
  dateChipDowSel: { color: LABEL, fontWeight: "600" },
  dateChipNum: { fontSize: 15, fontWeight: "600", fontFamily: "Satoshi-Medium", marginTop: 2, color: LABEL },
  dateChipNumSel: { color: LABEL },
  dateChipNumToday: { color: NOVA_GREEN },

  // Time slots
  slotGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
    marginBottom: 8,
  },
  slotPill: {
    width: "31%",
    paddingVertical: 10,
    borderRadius: 10,
    backgroundColor: colors.obsidian600,
    borderWidth: 1,
    borderColor: "transparent",
    alignItems: "center",
  },
  slotPillSel: {
    backgroundColor: "rgba(245,243,239,0.08)",
    borderColor: "rgba(245,243,239,0.20)",
  },
  slotPillText: {
    fontSize: 13,
    color: LABEL,
    fontWeight: "500",
    fontFamily: "Satoshi-Medium",
    fontVariant: ["tabular-nums"],
  },
  slotPillTextSel: { color: LABEL, fontWeight: "600" },

  // Notes
  addNoteLink: {
    marginTop: 12,
    alignSelf: "flex-start",
  },
  addNoteLinkText: {
    fontSize: 13,
    fontWeight: "500",
    fontFamily: "Satoshi-Medium",
    color: MUTED,
  },
  notesInput: { height: 72, paddingTop: 14 },

  // Book button
  bookBtn: {
    width: "100%",
    height: 52,
    borderRadius: 12,
    backgroundColor: NOVA_GREEN,
    marginTop: 20,
    alignItems: "center",
    justifyContent: "center",
  },
  bookBtnText: { fontSize: 15, fontWeight: "600", fontFamily: "Satoshi-Medium", color: BG },
});
