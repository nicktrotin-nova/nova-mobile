import { useState, useEffect, useCallback, useMemo, useRef } from "react";
import {
  View,
  Text,
  TextInput,
  ScrollView,
  TouchableOpacity,
  StyleSheet,
  ActivityIndicator,
  Alert,
  Linking,
} from "react-native";
import NovaSheet from "./NovaSheet";
import { format, addDays, parse } from "date-fns";
import { toZonedTime } from "date-fns-tz";
import {
  X,
  User,
  Scissors,
  Calendar,
  Clock,
  DollarSign,
  Pencil,
  Plus,
  Minus,
} from "lucide-react-native";
import * as Haptics from "expo-haptics";
import { supabase } from "../lib/supabase";
import { colors, BG, NOVA_GREEN, LABEL, MUTED, DIM } from "../theme/colors";
import {
  timeToMinutes,
  minutesToTime,
  formatTime12,
} from "../utils/formatters";
import { generateSlots, toBusySlots } from "../utils/availability";
import { createCheckoutEngine } from "../engine/checkout";
import { fetchBusySlots } from "../api/appointments";
import { fetchScheduleForDay } from "../api/schedules";
import { SHOP_TZ } from "../config/shop";
import type { Appointment } from "../types/domain";

export interface AppointmentDetailSheetProps {
  appointment: Appointment | null;
  visible: boolean;
  onClose: () => void;
  onActionComplete: () => void;
  barbers: { id: string; display_name: string | null; name: string }[];
  shopId: string;
  shopTz?: string;
}

const DEFAULT_TZ = SHOP_TZ;

function barberDisplayName(
  barbers: AppointmentDetailSheetProps["barbers"],
  barberId: string,
): string {
  const b = barbers.find((x) => x.id === barberId);
  return b?.display_name?.trim() || b?.name?.trim() || "Barber";
}

function normalizeSource(src: string | null): "online" | "phone" | "walkin" {
  const s = (src ?? "").toLowerCase();
  if (s.includes("phone")) return "phone";
  if (s.includes("walk") || s === "walk_in" || s === "walkin") return "walkin";
  return "online";
}

function sourceLabel(src: string | null): string {
  const n = normalizeSource(src);
  if (n === "phone") return "Phone";
  if (n === "walkin") return "Walk-in";
  return "Online";
}


export default function AppointmentDetailSheet({
  appointment,
  visible,
  onClose,
  onActionComplete,
  barbers,
  shopId,
  shopTz = DEFAULT_TZ,
}: AppointmentDetailSheetProps) {
  const [mode, setMode] = useState<"detail" | "reschedule">("detail");
  const [paymentStep, setPaymentStep] = useState(false);
  const [paymentMethod, setPaymentMethod] = useState<
    "card" | "cash" | "prepaid" | null
  >(null);

  const [rescheduleDates, setRescheduleDates] = useState<Date[]>([]);
  const [selectedRescheduleDate, setSelectedRescheduleDate] = useState<
    string | null
  >(null);
  const [slots, setSlots] = useState<string[]>([]);
  const [slotsLoading, setSlotsLoading] = useState(false);
  const [selectedSlot, setSelectedSlot] = useState<string | null>(null);


  // ── Inline editing state ──
  const [editingField, setEditingField] = useState<
    "client_name" | "price" | "notes" | null
  >(null);
  const [editClientName, setEditClientName] = useState("");
  const [editPrice, setEditPrice] = useState("");
  const [editNotes, setEditNotes] = useState("");
  const [localClientName, setLocalClientName] = useState<string | null>(null);
  const [localPrice, setLocalPrice] = useState<number | null>(null);
  const [localNotes, setLocalNotes] = useState<string | null>(null);
  const [completing, setCompleting] = useState(false);

  const nameInputRef = useRef<TextInput>(null);
  const priceInputRef = useRef<TextInput>(null);
  const notesInputRef = useRef<TextInput>(null);

  const resetSheet = useCallback(() => {
    setMode("detail");
    setPaymentStep(false);
    setPaymentMethod(null);
    setSelectedRescheduleDate(null);
    setSlots([]);
    setSelectedSlot(null);
    setSlotsLoading(false);
    setEditingField(null);
    setLocalClientName(null);
    setLocalPrice(null);
    setLocalNotes(null);
  }, []);

  useEffect(() => {
    if (!visible || !appointment) {
      resetSheet();
      return;
    }
    resetSheet();
  }, [visible, appointment?.id, resetSheet]);

  // Focus input after editingField changes
  useEffect(() => {
    if (!editingField) return;
    const timeout = setTimeout(() => {
      if (editingField === "client_name") nameInputRef.current?.focus();
      else if (editingField === "price") priceInputRef.current?.focus();
      else if (editingField === "notes") notesInputRef.current?.focus();
    }, 50);
    return () => clearTimeout(timeout);
  }, [editingField]);

  const startEditing = useCallback(
    (field: "client_name" | "price" | "notes") => {
      if (!appointment || !isConfirmedRef.current) return;
      void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
      setEditingField(field);
      if (field === "client_name") {
        setEditClientName(
          localClientName ?? appointment.client_name ?? "",
        );
      } else if (field === "price") {
        const current = localPrice ?? appointment.price_charged;
        setEditPrice(current != null ? String(current) : "");
      } else if (field === "notes") {
        setEditNotes(localNotes ?? appointment.notes ?? "");
      }
    },
    [appointment, localClientName, localPrice, localNotes],
  );

  const saveField = useCallback(
    async (field: "client_name" | "price" | "notes") => {
      if (!appointment) return;
      setEditingField(null);

      let updatePayload: Record<string, unknown> = {};

      if (field === "client_name") {
        const trimmed = editClientName.trim();
        if (!trimmed || trimmed === (localClientName ?? appointment.client_name)) return;
        updatePayload = { client_name: trimmed };
        setLocalClientName(trimmed);
      } else if (field === "price") {
        const parsed = parseFloat(editPrice);
        if (isNaN(parsed) || parsed < 0) return;
        const current = localPrice ?? appointment.price_charged;
        if (parsed === current) return;
        updatePayload = { price_charged: parsed };
        setLocalPrice(parsed);
      } else if (field === "notes") {
        const trimmed = editNotes.trim();
        const current = localNotes ?? appointment.notes ?? "";
        if (trimmed === current) return;
        updatePayload = { notes: trimmed || null };
        setLocalNotes(trimmed || null);
      }

      const { error } = await supabase
        .from("appointments")
        .update(updatePayload)
        .eq("id", appointment.id);

      if (!error) {
        onActionComplete();
      }
    },
    [appointment, editClientName, editPrice, editNotes, localClientName, localPrice, localNotes, onActionComplete],
  );

  useEffect(() => {
    if (mode !== "reschedule" || !visible) return;
    const today = toZonedTime(new Date(), shopTz);
    setRescheduleDates(Array.from({ length: 14 }, (_, i) => addDays(today, i)));
  }, [mode, visible, shopTz]);

  const durationMin = useMemo(() => {
    if (!appointment) return 30;
    return Math.max(
      15,
      timeToMinutes(appointment.end_time) -
        timeToMinutes(appointment.start_time),
    );
  }, [appointment]);

  const fetchSlotsForDate = useCallback(
    async (dateStr: string) => {
      if (!appointment) return;
      setSlotsLoading(true);
      setSelectedSlot(null);
      try {
        const d = parse(dateStr, "yyyy-MM-dd", new Date());
        const dow = d.getDay();

        const { data: sched } = await fetchScheduleForDay(supabase, {
          barberId: appointment.barber_id,
          dayOfWeek: dow,
        });

        if (!sched?.start_time || !sched?.end_time) {
          setSlots([]);
          return;
        }

        const { data: appts } = await fetchBusySlots(supabase, {
          shopId,
          barberId: appointment.barber_id,
          date: dateStr,
        });

        const busy = toBusySlots(appts ?? [], appointment.id);

        const generated = generateSlots(
          sched.start_time,
          sched.end_time,
          durationMin,
          busy,
        );
        setSlots(generated);
      } finally {
        setSlotsLoading(false);
      }
    },
    [appointment, shopId, durationMin],
  );

  useEffect(() => {
    if (
      mode === "reschedule" &&
      selectedRescheduleDate &&
      appointment
    ) {
      void fetchSlotsForDate(selectedRescheduleDate);
    }
  }, [mode, selectedRescheduleDate, appointment, fetchSlotsForDate]);

  const onSelectRescheduleDay = useCallback((dateStr: string) => {
    setSelectedRescheduleDate(dateStr);
  }, []);

  useEffect(() => {
    if (mode === "reschedule" && rescheduleDates.length && !selectedRescheduleDate) {
      const first = format(rescheduleDates[0], "yyyy-MM-dd");
      setSelectedRescheduleDate(first);
    }
  }, [mode, rescheduleDates, selectedRescheduleDate]);

  const engine = useMemo(() => createCheckoutEngine({ supabase }), []);

  // Ref so startEditing callback can read latest value without dep
  // Must be above the early return — hooks can't come after conditional returns
  const isConfirmedRef = useRef(false);

  if (!appointment) {
    return null;
  }

  const statusLower = appointment.status.toLowerCase();
  const isConfirmed = statusLower === "confirmed";
  const isCompleted = statusLower === "completed";
  const isNoShow = statusLower === "no_show";

  isConfirmedRef.current = isConfirmed;

  const statusDotColor = isNoShow
    ? colors.error
    : isCompleted
      ? MUTED
      : NOVA_GREEN;

  const aptDate = parse(appointment.appointment_date, "yyyy-MM-dd", new Date());
  const dateFormatted = format(aptDate, "EEE, MMM d");
  const timeRangeLabel = `${formatTime12(appointment.start_time)} – ${formatTime12(appointment.end_time)}`;
  const durationLabel = `(${durationMin}min)`;

  const serviceName = appointment.services?.name ?? "Service";

  const handleComplete = async () => {
    if (!paymentMethod || !appointment || completing) return;

    setCompleting(true);
    try {
      const result = await engine.complete({
        appointmentId: appointment.id,
        paymentMethod,
        priceOverride: localPrice ?? undefined,
      });

      if (!result.success) {
        Alert.alert("Error", result.message);
        return;
      }

      // Card payments via PaymentSheet not yet supported from detail sheet — only MyDayScreen
      if ("needsPaymentSheet" in result) {
        Alert.alert("Card payments", "Use the My Day screen to accept card payments");
        return;
      }

      Alert.alert("Completed", result.toastMessage);
      onActionComplete();
      onClose();
    } finally {
      setCompleting(false);
    }
  };

  const handleCancel = () => {
    if (!appointment) return;
    Alert.alert(
      "Cancel this appointment?",
      undefined,
      [
        { text: "Keep it", style: "cancel" },
        {
          text: "Yes, cancel it",
          style: "destructive",
          onPress: async () => {
            const { error } = await supabase
              .from("appointments")
              .update({ status: "cancelled" })
              .eq("id", appointment.id);
            if (!error) {
              onActionComplete();
              onClose();
            }
          },
        },
      ],
    );
  };

  const handleNoShow = async () => {
    if (!appointment) return;
    const { error } = await supabase
      .from("appointments")
      .update({ status: "no_show" })
      .eq("id", appointment.id);
    if (!error) {
      onActionComplete();
      onClose();
    }
  };

  const handleUndoComplete = async () => {
    if (!appointment) return;
    const { error } = await supabase
      .from("appointments")
      .update({ status: "confirmed", payment_method: null })
      .eq("id", appointment.id);
    if (!error) {
      onActionComplete();
      onClose();
    }
  };

  const handleUndoNoShow = async () => {
    if (!appointment) return;
    const { error } = await supabase
      .from("appointments")
      .update({ status: "confirmed" })
      .eq("id", appointment.id);
    if (!error) {
      onActionComplete();
      onClose();
    }
  };

  const handleConfirmReschedule = async () => {
    if (!appointment || !selectedSlot || !selectedRescheduleDate) return;
    const startMin = timeToMinutes(selectedSlot);
    const newEnd = minutesToTime(startMin + durationMin);
    const newStart = `${selectedSlot}:00`;
    const { error } = await supabase
      .from("appointments")
      .update({
        appointment_date: selectedRescheduleDate,
        start_time: newStart,
        end_time: newEnd,
      })
      .eq("id", appointment.id);
    if (!error) {
      onActionComplete();
      onClose();
    }
  };

  const todayStr = format(toZonedTime(new Date(), shopTz), "yyyy-MM-dd");

  // Resolved display values (local edits take priority over appointment prop)
  const displayClientName = localClientName ?? appointment.client_name;
  const displayPrice = localPrice ?? appointment.price_charged;
  const displayNotes = localNotes ?? appointment.notes;

  /** Pencil hint icon — only shown for confirmed appointments */
  const editHint = isConfirmed ? (
    <View pointerEvents="none" style={styles.editHint}>
      <Pencil size={13} color={DIM} />
    </View>
  ) : null;

  const renderDetailBody = () => (
    <>
      {/* ── Client card ── */}
      <View style={styles.card}>
        <TouchableOpacity
          style={styles.cardRow}
          activeOpacity={isConfirmed ? 0.7 : 1}
          onPress={isConfirmed ? () => startEditing("client_name") : undefined}
          disabled={!isConfirmed}
        >
          <View pointerEvents="none">
            <User size={18} color={DIM} />
          </View>
          {editingField === "client_name" ? (
            <TextInput
              ref={nameInputRef}
              style={[styles.clientName, styles.editInput]}
              value={editClientName}
              onChangeText={setEditClientName}
              onBlur={() => void saveField("client_name")}
              onSubmitEditing={() => void saveField("client_name")}
              returnKeyType="done"
              selectionColor={NOVA_GREEN}
              autoCorrect={false}
            />
          ) : (
            <>
              <Text style={styles.clientName}>{displayClientName}</Text>
              {editHint}
            </>
          )}
        </TouchableOpacity>
        {appointment.client_phone ? (
          <TouchableOpacity
            onPress={() => {
              const p = appointment.client_phone?.replace(/\s/g, "") ?? "";
              if (p) void Linking.openURL(`tel:${p}`);
            }}
          >
            <Text style={styles.phoneLink}>{appointment.client_phone}</Text>
          </TouchableOpacity>
        ) : null}
      </View>

      {/* ── Service + barber card ── */}
      <View style={styles.card}>
        <View style={styles.cardRow}>
          <View pointerEvents="none">
            <Scissors size={18} color={DIM} />
          </View>
          <Text style={styles.cardPrimary}>{serviceName}</Text>
        </View>
        <View style={[styles.cardRow, styles.cardRowSpaced]}>
          <View pointerEvents="none">
            <User size={18} color={DIM} />
          </View>
          <Text style={styles.cardMuted}>
            {barberDisplayName(barbers, appointment.barber_id)}
          </Text>
        </View>
      </View>

      {/* ── Date / time / price card ── */}
      <View style={styles.card}>
        <View style={styles.cardRow}>
          <View pointerEvents="none">
            <Calendar size={18} color={DIM} />
          </View>
          <Text style={styles.cardPrimary}>{dateFormatted}</Text>
        </View>
        <View style={[styles.cardRow, styles.cardRowSpaced]}>
          <View pointerEvents="none">
            <Clock size={18} color={DIM} />
          </View>
          <Text style={styles.cardPrimary}>
            {timeRangeLabel}{" "}
            <Text style={styles.durationMuted}>{durationLabel}</Text>
          </Text>
        </View>

        {/* Price row — editable for confirmed */}
        <TouchableOpacity
          style={[styles.cardRow, styles.cardRowSpaced]}
          activeOpacity={isConfirmed ? 0.7 : 1}
          onPress={isConfirmed ? () => startEditing("price") : undefined}
          disabled={!isConfirmed}
        >
          <View pointerEvents="none">
            <DollarSign size={18} color={NOVA_GREEN} />
          </View>
          {editingField === "price" ? (
            <TextInput
              ref={priceInputRef}
              style={[styles.priceText, styles.editInput, styles.editInputGreen]}
              value={editPrice}
              onChangeText={setEditPrice}
              onBlur={() => void saveField("price")}
              onSubmitEditing={() => void saveField("price")}
              keyboardType="numeric"
              returnKeyType="done"
              selectionColor={NOVA_GREEN}
            />
          ) : (
            <>
              <Text style={styles.priceText}>
                ${displayPrice != null ? Number(displayPrice).toFixed(0) : "0"}
              </Text>
              {editHint}
            </>
          )}
        </TouchableOpacity>
      </View>

      {/* ── Badges ── */}
      <View style={styles.badgeRow}>
        <View
          style={[
            styles.badge,
            normalizeSource(appointment.booking_source) === "phone"
              ? styles.badgePhone
              : normalizeSource(appointment.booking_source) === "walkin"
                ? styles.badgeWalkin
                : styles.badgeOnline,
          ]}
        >
          <Text
            style={[
              styles.badgeText,
              normalizeSource(appointment.booking_source) === "phone"
                ? styles.badgeTextPhone
                : normalizeSource(appointment.booking_source) === "walkin"
                  ? styles.badgeTextWalkin
                  : styles.badgeTextOnline,
            ]}
          >
            {sourceLabel(appointment.booking_source)}
          </Text>
        </View>
        <View
          style={[
            styles.badge,
            isNoShow
              ? styles.badgeNoShow
              : isCompleted
                ? styles.badgeCompleted
                : styles.badgeConfirmed,
          ]}
        >
          <Text
            style={[
              styles.badgeText,
              isNoShow
                ? styles.badgeTextNoShow
                : isCompleted
                  ? styles.badgeTextCompleted
                  : styles.badgeTextConfirmed,
            ]}
          >
            {isNoShow
              ? "no_show"
              : isCompleted
                ? "completed"
                : "confirmed"}
          </Text>
        </View>
      </View>

      {/* ── Notes card — editable, with "Add a note" prompt ── */}
      {editingField === "notes" ? (
        <View style={styles.notesCard}>
          <Text style={styles.notesLabel}>NOTES</Text>
          <TextInput
            ref={notesInputRef}
            style={[styles.notesBody, styles.editInputMultiline]}
            value={editNotes}
            onChangeText={setEditNotes}
            onBlur={() => void saveField("notes")}
            multiline
            textAlignVertical="top"
            selectionColor={NOVA_GREEN}
            placeholderTextColor={DIM}
            placeholder="Add a note..."
          />
        </View>
      ) : displayNotes ? (
        <TouchableOpacity
          activeOpacity={isConfirmed ? 0.7 : 1}
          onPress={isConfirmed ? () => startEditing("notes") : undefined}
          disabled={!isConfirmed}
        >
          <View style={styles.notesCard}>
            <View style={styles.notesHeaderRow}>
              <Text style={styles.notesLabel}>NOTES</Text>
              {editHint}
            </View>
            <Text style={styles.notesBody}>{displayNotes}</Text>
          </View>
        </TouchableOpacity>
      ) : isConfirmed ? (
        <TouchableOpacity
          style={styles.addNoteRow}
          activeOpacity={0.7}
          onPress={() => startEditing("notes")}
        >
          <View pointerEvents="none">
            <Pencil size={14} color={DIM} />
          </View>
          <Text style={styles.addNoteText}>Add a note</Text>
        </TouchableOpacity>
      ) : null}
    </>
  );

  const renderRescheduleBody = () => {
    const ctxDay = format(aptDate, "EEE, MMM d");
    const ctxTime = `${formatTime12(appointment.start_time)} – ${formatTime12(appointment.end_time)}`;
    return (
      <>
        <TouchableOpacity onPress={() =>setMode("detail")} hitSlop={8}>
          <Text style={styles.backReschedule}>← Reschedule</Text>
        </TouchableOpacity>
        <Text style={styles.contextLine}>
          {appointment.client_name} · {serviceName} · currently {ctxDay} at{" "}
          {ctxTime}
        </Text>
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.dateStripContent}
          style={styles.dateStrip}
        >
          {rescheduleDates.map((d) => {
            const ds = format(d, "yyyy-MM-dd");
            const sel = ds === selectedRescheduleDate;
            const isToday = ds === todayStr;
            return (
              <TouchableOpacity
                key={ds}
                style={[styles.dateChip, sel && styles.dateChipSelected]}
                onPress={() => onSelectRescheduleDay(ds)}
                activeOpacity={0.85}
              >
                <Text
                  style={[
                    styles.dateChipDow,
                    sel && styles.dateChipDowSelected,
                  ]}
                >
                  {format(d, "EEE")}
                </Text>
                <Text
                  style={[
                    styles.dateChipNum,
                    sel && styles.dateChipNumSelected,
                    !sel && isToday && styles.dateChipNumToday,
                    !sel && !isToday && styles.dateChipNumIdle,
                  ]}
                >
                  {format(d, "d")}
                </Text>
              </TouchableOpacity>
            );
          })}
        </ScrollView>
        {slotsLoading ? (
          <ActivityIndicator color={NOVA_GREEN} style={styles.slotsSpinner} />
        ) : slots.length === 0 ? (
          <Text style={styles.noSlots}>No available slots on this date</Text>
        ) : (
          <View style={styles.slotGrid}>
            {slots.map((slot) => {
              const sel = selectedSlot === slot;
              return (
                <TouchableOpacity
                  key={slot}
                  style={[styles.slotPill, sel && styles.slotPillSelected]}
                  onPress={() => setSelectedSlot(slot)}
                  activeOpacity={0.85}
                >
                  <Text
                    style={[
                      styles.slotPillText,
                      sel && styles.slotPillTextSelected,
                    ]}
                  >
                    {formatTime12(`${slot}:00`)}
                  </Text>
                </TouchableOpacity>
              );
            })}
          </View>
        )}
      </>
    );
  };

  const renderFooter = () => (
          <View style={styles.footer}>
            {mode === "detail" && isConfirmed && !paymentStep ? (
              <>
                <TouchableOpacity
                  style={styles.btnPrimary}
                  onPress={() => setMode("reschedule")}
                  activeOpacity={0.85}
                >
                  <Text style={styles.btnPrimaryText}>Reschedule</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={styles.btnPrimary}
                  onPress={() => setPaymentStep(true)}
                  activeOpacity={0.85}
                >
                  <Text style={styles.btnPrimaryText}>Mark Complete</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={styles.btnDanger}
                  onPress={handleCancel}
                  activeOpacity={0.85}
                >
                  <Text style={styles.btnDangerText}>Cancel Appointment</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={styles.btnGhost}
                  onPress={handleNoShow}
                  activeOpacity={0.85}
                >
                  <Text style={styles.btnGhostText}>Mark as No Show</Text>
                </TouchableOpacity>
              </>
            ) : null}
            {mode === "detail" && isConfirmed && paymentStep ? (
              <>
                {/* Price adjustment */}
                <View style={styles.priceAdjustRow}>
                  <TouchableOpacity
                    style={styles.priceAdjustBtn}
                    onPress={() => {
                      const current = localPrice ?? appointment.price_charged ?? 0;
                      if (current > 5) {
                        setLocalPrice(current - 5);
                        void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                      }
                    }}
                    activeOpacity={0.7}
                    delayPressIn={0}
                  >
                    <View pointerEvents="none">
                      <Minus size={14} color={LABEL} strokeWidth={2.5} />
                    </View>
                  </TouchableOpacity>
                  <View style={styles.priceAdjustCenter}>
                    <Text style={[
                      styles.priceAdjustAmount,
                      localPrice != null && localPrice !== appointment.price_charged && styles.priceAdjustChanged,
                    ]}>
                      ${(localPrice ?? appointment.price_charged ?? 0).toFixed(0)}
                    </Text>
                    {localPrice != null && localPrice !== appointment.price_charged ? (
                      <Text style={styles.priceAdjustOriginal}>
                        was ${(appointment.price_charged ?? 0).toFixed(0)}
                      </Text>
                    ) : null}
                  </View>
                  <TouchableOpacity
                    style={styles.priceAdjustBtn}
                    onPress={() => {
                      const current = localPrice ?? appointment.price_charged ?? 0;
                      setLocalPrice(current + 5);
                      void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                    }}
                    activeOpacity={0.7}
                    delayPressIn={0}
                  >
                    <View pointerEvents="none">
                      <Plus size={14} color={LABEL} strokeWidth={2.5} />
                    </View>
                  </TouchableOpacity>
                </View>
                <Text style={styles.payPrompt}>How did they pay?</Text>
                <View style={styles.payRow}>
                  {(["card", "cash", "prepaid"] as const).map((m) => (
                    <TouchableOpacity
                      key={m}
                      style={[
                        styles.payPill,
                        paymentMethod === m && styles.payPillSelected,
                      ]}
                      onPress={() => setPaymentMethod(m)}
                      activeOpacity={0.85}
                    >
                      <Text
                        style={[
                          styles.payPillText,
                          paymentMethod === m && styles.payPillTextSelected,
                        ]}
                      >
                        {m === "prepaid"
                          ? "Prepaid"
                          : m.charAt(0).toUpperCase() + m.slice(1)}
                      </Text>
                    </TouchableOpacity>
                  ))}
                </View>
                <TouchableOpacity
                  style={[
                    styles.btnPrimary,
                    (!paymentMethod || completing) && styles.btnDisabled,
                  ]}
                  disabled={!paymentMethod || completing}
                  onPress={handleComplete}
                  activeOpacity={0.85}
                >
                  {completing ? (
                    <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
                      <ActivityIndicator size="small" color="#F5F3EF" />
                      <Text style={styles.btnPrimaryText}>Completing...</Text>
                    </View>
                  ) : (
                    <Text style={styles.btnPrimaryText}>Complete</Text>
                  )}
                </TouchableOpacity>
                <TouchableOpacity onPress={() => setPaymentStep(false)}>
                  <Text style={styles.cancelPayText}>Back</Text>
                </TouchableOpacity>
              </>
            ) : null}
            {mode === "detail" && isCompleted ? (
              <TouchableOpacity
                style={styles.btnOutline}
                onPress={handleUndoComplete}
                activeOpacity={0.85}
              >
                <Text style={styles.btnOutlineText}>Undo Complete</Text>
              </TouchableOpacity>
            ) : null}
            {mode === "detail" && isNoShow ? (
              <TouchableOpacity
                style={styles.btnOutline}
                onPress={handleUndoNoShow}
                activeOpacity={0.85}
              >
                <Text style={styles.btnOutlineText}>Undo No-Show</Text>
              </TouchableOpacity>
            ) : null}
            {mode === "reschedule" && selectedSlot ? (
              <TouchableOpacity
                style={styles.btnPrimary}
                onPress={handleConfirmReschedule}
                activeOpacity={0.85}
              >
                <Text style={styles.btnPrimaryText}>Confirm Reschedule</Text>
              </TouchableOpacity>
            ) : null}
          </View>
  );

  return (
    <NovaSheet
      visible={visible && !!appointment}
      onClose={onClose}
      title="Appointment Details"
      headerLeft={
        <View style={[styles.statusDot, { backgroundColor: statusDotColor }]} />
      }
      footer={renderFooter()}
    >
      {mode === "detail" ? renderDetailBody() : renderRescheduleBody()}
    </NovaSheet>
  );
}

const styles = StyleSheet.create({
  statusDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  card: {
    borderRadius: 12,
    backgroundColor: colors.obsidian800,
    borderWidth: 1,
    borderColor: colors.borderMedium,
    padding: 12,
    marginBottom: 12,
    marginHorizontal: 16,
  },
  cardRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
  },
  cardRowSpaced: {
    marginTop: 10,
  },
  clientName: {
    fontSize: 14,
    fontWeight: "600",
    fontFamily: "Satoshi-Medium",
    color: LABEL,
    flex: 1,
  },
  phoneLink: {
    fontSize: 12,
    fontFamily: "Satoshi-Regular",
    color: NOVA_GREEN,
    marginTop: 8,
    marginLeft: 28,
  },
  cardPrimary: {
    fontSize: 14,
    fontWeight: "500",
    fontFamily: "Satoshi-Medium",
    color: LABEL,
    flex: 1,
  },
  cardMuted: {
    fontSize: 13,
    fontFamily: "Satoshi-Regular",
    color: MUTED,
    flex: 1,
  },
  durationMuted: {
    fontSize: 13,
    fontWeight: "400",
    color: MUTED,
  },
  priceText: {
    fontSize: 15,
    fontWeight: "600",
    fontFamily: "Satoshi-Medium",
    color: NOVA_GREEN,
    flex: 1,
  },
  badgeRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
    marginHorizontal: 16,
    marginBottom: 12,
  },
  badge: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 20,
    borderWidth: 1,
  },
  badgeOnline: {
    backgroundColor: colors.nova10,
    borderColor: colors.nova20,
  },
  badgeTextOnline: {
    color: NOVA_GREEN,
  },
  badgePhone: {
    backgroundColor: colors.warning10,
    borderColor: colors.warning20,
  },
  badgeTextPhone: {
    color: colors.warning,
  },
  badgeWalkin: {
    backgroundColor: colors.steel10,
    borderColor: colors.steelAlt20,
  },
  badgeTextWalkin: {
    color: colors.textPrimary,
  },
  badgeConfirmed: {
    backgroundColor: colors.nova10,
    borderColor: colors.nova20,
  },
  badgeTextConfirmed: {
    color: NOVA_GREEN,
  },
  badgeNoShow: {
    backgroundColor: colors.error10,
    borderColor: colors.error20,
  },
  badgeTextNoShow: {
    color: colors.error,
  },
  badgeCompleted: {
    backgroundColor: colors.steel10,
    borderColor: colors.steelAlt20,
  },
  badgeTextCompleted: {
    color: MUTED,
  },
  badgeText: {
    fontSize: 11,
    fontWeight: "500",
    fontFamily: "Satoshi-Medium",
  },
  notesCard: {
    borderRadius: 12,
    backgroundColor: colors.obsidian800,
    borderWidth: 1,
    borderColor: colors.borderMedium,
    padding: 12,
    marginHorizontal: 16,
    marginBottom: 12,
  },
  notesHeaderRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  notesLabel: {
    fontSize: 10,
    textTransform: "uppercase",
    letterSpacing: 0.06 * 16,
    color: MUTED,
    marginBottom: 6,
  },
  notesBody: {
    fontSize: 13,
    fontFamily: "Satoshi-Regular",
    color: LABEL,
    lineHeight: 20,
  },
  // ── Inline editing styles ──
  editHint: {
    marginLeft: 4,
    opacity: 0.5,
  },
  editInput: {
    flex: 1,
    padding: 0,
    margin: 0,
    borderBottomWidth: 1.5,
    borderBottomColor: NOVA_GREEN,
    paddingBottom: 2,
  },
  editInputGreen: {
    color: NOVA_GREEN,
  },
  editInputMultiline: {
    minHeight: 48,
    borderBottomWidth: 1.5,
    borderBottomColor: NOVA_GREEN,
    paddingBottom: 4,
    padding: 0,
    margin: 0,
  },
  addNoteRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    marginHorizontal: 16,
    marginBottom: 12,
    paddingVertical: 10,
    paddingHorizontal: 12,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.borderMedium,
    borderStyle: "dashed",
  },
  addNoteText: {
    fontSize: 13,
    fontFamily: "Satoshi-Regular",
    color: DIM,
  },
  footer: {
    paddingHorizontal: 16,
    paddingTop: 12,
    paddingBottom: 32,
    borderTopWidth: 1,
    borderTopColor: colors.borderMedium,
    backgroundColor: colors.obsidian800,
  },
  btnPrimary: {
    width: "100%",
    height: 52,
    borderRadius: 12,
    backgroundColor: colors.obsidian800,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 8,
  },
  btnDisabled: {
    opacity: 0.45,
  },
  btnPrimaryText: {
    color: LABEL,
    fontWeight: "600",
    fontFamily: "Satoshi-Medium",
    fontSize: 15,
  },
  btnDanger: {
    width: "100%",
    height: 52,
    borderRadius: 12,
    backgroundColor: colors.error10,
    borderWidth: 1,
    borderColor: colors.error20,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 8,
  },
  btnDangerText: {
    color: colors.error,
    fontWeight: "600",
    fontFamily: "Satoshi-Medium",
    fontSize: 15,
  },
  btnGhost: {
    width: "100%",
    height: 48,
    borderRadius: 12,
    backgroundColor: "transparent",
    borderWidth: 1,
    borderColor: colors.borderMedium,
    alignItems: "center",
    justifyContent: "center",
  },
  btnGhostText: {
    color: MUTED,
    fontWeight: "500",
    fontFamily: "Satoshi-Medium",
    fontSize: 14,
  },
  btnOutline: {
    width: "100%",
    height: 52,
    borderRadius: 12,
    borderWidth: 2,
    borderColor: colors.borderMedium,
    backgroundColor: colors.obsidian600,
    alignItems: "center",
    justifyContent: "center",
  },
  btnOutlineText: {
    fontSize: 15,
    fontWeight: "600",
    fontFamily: "Satoshi-Medium",
    color: LABEL,
  },
  priceAdjustRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 16,
    marginBottom: 16,
    paddingVertical: 4,
  },
  priceAdjustBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: colors.obsidian600,
    alignItems: "center",
    justifyContent: "center",
  },
  priceAdjustCenter: {
    alignItems: "center",
    minWidth: 80,
  },
  priceAdjustAmount: {
    fontSize: 28,
    fontFamily: "DMSerifText-Regular",
    color: NOVA_GREEN,
  },
  priceAdjustChanged: {
    color: NOVA_GREEN,
  },
  priceAdjustOriginal: {
    fontSize: 11,
    fontFamily: "Satoshi-Regular",
    color: MUTED,
    marginTop: 2,
  },
  payPrompt: {
    fontSize: 13,
    fontFamily: "Satoshi-Regular",
    color: MUTED,
    textAlign: "center",
    marginBottom: 12,
  },
  payRow: {
    flexDirection: "row",
    gap: 8,
    marginBottom: 12,
  },
  payPill: {
    flex: 1,
    borderRadius: 12,
    borderWidth: 2,
    borderColor: colors.borderMedium,
    paddingVertical: 16,
    alignItems: "center",
    justifyContent: "center",
  },
  payPillSelected: {
    borderColor: colors.warmWhite25,
    backgroundColor: colors.warmWhite10,
  },
  payPillText: {
    fontSize: 13,
    fontWeight: "500",
    fontFamily: "Satoshi-Medium",
    color: MUTED,
  },
  payPillTextSelected: {
    fontWeight: "600",
    color: LABEL,
  },
  cancelPayText: {
    textAlign: "center",
    marginTop: 12,
    fontSize: 14,
    color: MUTED,
  },
  backReschedule: {
    fontSize: 14,
    fontWeight: "500",
    color: MUTED,
    marginHorizontal: 16,
    marginBottom: 12,
  },
  contextLine: {
    fontSize: 13,
    color: MUTED,
    marginHorizontal: 16,
    marginBottom: 16,
  },
  dateStrip: {
    marginBottom: 16,
    maxHeight: 72,
  },
  dateStripContent: {
    paddingHorizontal: 16,
    gap: 6,
    flexDirection: "row",
    alignItems: "center",
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
    backgroundColor: colors.nova15,
    borderColor: colors.nova40,
  },
  dateChipDow: {
    fontSize: 10,
    color: MUTED,
    fontWeight: "500",
  },
  dateChipDowSelected: {
    color: NOVA_GREEN,
    fontWeight: "600",
  },
  dateChipNum: {
    fontSize: 15,
    fontWeight: "600",
    marginTop: 2,
    color: LABEL,
  },
  dateChipNumSelected: {
    color: NOVA_GREEN,
  },
  dateChipNumToday: {
    color: NOVA_GREEN,
  },
  dateChipNumIdle: {
    color: LABEL,
  },
  slotsSpinner: {
    marginVertical: 24,
  },
  noSlots: {
    textAlign: "center",
    color: MUTED,
    fontSize: 14,
    marginHorizontal: 16,
    marginBottom: 16,
  },
  slotGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
    marginHorizontal: 16,
    paddingBottom: 8,
  },
  slotPill: {
    width: "31%",
    paddingVertical: 10,
    paddingHorizontal: 14,
    borderRadius: 8,
    backgroundColor: colors.obsidian600,
    borderWidth: 1,
    borderColor: colors.borderMedium,
    alignItems: "center",
  },
  slotPillSelected: {
    backgroundColor: colors.nova15,
    borderColor: colors.nova40,
  },
  slotPillText: {
    fontSize: 13,
    color: LABEL,
    fontWeight: "500",
    fontFamily: "Satoshi-Medium",
  },
  slotPillTextSelected: {
    color: NOVA_GREEN,
    fontWeight: "600",
  },
});
