import { useState, useEffect, useCallback } from "react";
import {
  View,
  Text,
  TouchableOpacity,
  TextInput,
  StyleSheet,
} from "react-native";
import { format, parse } from "date-fns";
import { Clock, Repeat, ChevronDown } from "lucide-react-native";
import NovaSheet from "./NovaSheet";
import { supabase } from "../lib/supabase";
import { colors, BG, LABEL, MUTED, DIM, NOVA_GREEN } from "../theme/colors";
import { formatTime12, addMinutesToTime } from "../utils/formatters";

export interface BlockCreationSheetProps {
  visible: boolean;
  onClose: () => void;
  onCreated: () => void;
  barberId: string;
  barberName: string;
  date: string; // yyyy-MM-dd
  /** Pre-filled start time from slot tap, e.g. "09:00" */
  startTime?: string;
}

const DURATIONS = [
  { label: "15 min", mins: 15 },
  { label: "30 min", mins: 30 },
  { label: "1 hr", mins: 60 },
  { label: "1.5 hr", mins: 90 },
  { label: "2 hr", mins: 120 },
  { label: "3 hr", mins: 180 },
  { label: "All day", mins: 0 },
];

const QUICK_REASONS = ["Break", "Lunch", "Personal", "Training", "Meeting"];

const RECURRENCE_OPTIONS = [
  { label: "No repeat", value: null },
  { label: "Every day", value: "daily" as const },
  { label: "Every week", value: "weekly" as const },
  { label: "Every month", value: "monthly" as const },
];


export default function BlockCreationSheet({
  visible,
  onClose,
  onCreated,
  barberId,
  barberName,
  date,
  startTime,
}: BlockCreationSheetProps) {
  const [reason, setReason] = useState("");
  const [selectedDuration, setSelectedDuration] = useState(30);
  const [recurrence, setRecurrence] = useState<"daily" | "weekly" | "monthly" | null>(null);
  const [showRecurrence, setShowRecurrence] = useState(false);
  const [saving, setSaving] = useState(false);
  const resolvedStart = startTime ?? "09:00";
  const isAllDay = selectedDuration === 0;

  useEffect(() => {
    if (visible) {
      setReason("");
      setSelectedDuration(60);
      setRecurrence(null);
      setShowRecurrence(false);
      setSaving(false);
    }
  }, [visible]);

  const dateFormatted = (() => {
    try {
      return format(parse(date, "yyyy-MM-dd", new Date()), "EEE, MMM d");
    } catch {
      return date;
    }
  })();

  const endTime = isAllDay ? null : addMinutesToTime(resolvedStart, selectedDuration);
  const timeLabel = isAllDay
    ? "All day"
    : `${formatTime12(resolvedStart)} – ${formatTime12(endTime!)}`;

  const handleCreate = useCallback(async () => {
    if (saving) return;
    setSaving(true);

    const payload: Record<string, unknown> = {
      barber_id: barberId,
      override_date: date,
      is_blocked: true,
      reason: reason.trim() || "Blocked",
      is_recurring: recurrence != null,
      recurrence_pattern: recurrence,
    };

    if (!isAllDay) {
      payload.start_time = `${resolvedStart}:00`;
      payload.end_time = `${endTime}:00`;
    }

    const { error } = await supabase
      .from("availability_overrides")
      .insert(payload);

    setSaving(false);
    if (!error) {
      onCreated();
      onClose();
    }
  }, [saving, barberId, date, reason, recurrence, isAllDay, resolvedStart, endTime, onCreated, onClose]);

  return (
    <NovaSheet
      visible={visible}
      onClose={onClose}
      title="Block Time"
      footer={
        <View style={styles.footer}>
          <TouchableOpacity
            style={[styles.btnPrimary, saving && styles.btnDisabled]}
            onPress={() => void handleCreate()}
            activeOpacity={0.85}
            disabled={saving}
          >
            <Text style={styles.btnPrimaryText}>
              {saving ? "Blocking..." : "Block Time"}
            </Text>
          </TouchableOpacity>
        </View>
      }
    >
            {/* Context bar */}
            <View style={styles.contextBar}>
              <Text style={styles.contextLabel}>{barberName}</Text>
              <Text style={styles.contextDot}> · </Text>
              <Text style={styles.contextLabel}>{dateFormatted}</Text>
            </View>

            {/* Time preview */}
            <View style={styles.timePreview}>
              <View pointerEvents="none">
                <Clock size={16} color={MUTED} strokeWidth={2} />
              </View>
              <Text style={styles.timePreviewText}>{timeLabel}</Text>
            </View>

            {/* Duration pills */}
            <Text style={styles.sectionLabel}>DURATION</Text>
            <View style={styles.pillRow}>
              {DURATIONS.map((d) => {
                const active = selectedDuration === d.mins;
                return (
                  <TouchableOpacity
                    key={d.mins}
                    style={[styles.pill, active && styles.pillActive]}
                    onPress={() => setSelectedDuration(d.mins)}
                    activeOpacity={0.75}
                  >
                    <Text style={[styles.pillText, active && styles.pillTextActive]}>
                      {d.label}
                    </Text>
                  </TouchableOpacity>
                );
              })}
            </View>

            {/* Quick reason pills */}
            <Text style={styles.sectionLabel}>REASON</Text>
            <View style={styles.pillRow}>
              {QUICK_REASONS.map((r) => {
                const active = reason.toLowerCase() === r.toLowerCase();
                return (
                  <TouchableOpacity
                    key={r}
                    style={[styles.pill, active && styles.pillActive]}
                    onPress={() => setReason(active ? "" : r)}
                    activeOpacity={0.75}
                  >
                    <Text style={[styles.pillText, active && styles.pillTextActive]}>
                      {r}
                    </Text>
                  </TouchableOpacity>
                );
              })}
            </View>

            <TextInput
              style={styles.input}
              value={reason}
              onChangeText={setReason}
              placeholder="Or type a custom reason..."
              placeholderTextColor={DIM}
            />

            {/* Recurrence toggle */}
            <TouchableOpacity
              style={styles.recurrenceToggle}
              onPress={() => setShowRecurrence(!showRecurrence)}
              activeOpacity={0.75}
            >
              <View pointerEvents="none">
                <Repeat size={16} color={MUTED} strokeWidth={2} />
              </View>
              <Text style={styles.recurrenceToggleText}>
                {recurrence
                  ? RECURRENCE_OPTIONS.find((o) => o.value === recurrence)?.label
                  : "Repeat"}
              </Text>
              <View pointerEvents="none">
                <ChevronDown
                  size={16}
                  color={MUTED}
                  strokeWidth={2}
                  style={showRecurrence ? { transform: [{ rotate: "180deg" }] } : undefined}
                />
              </View>
            </TouchableOpacity>

            {showRecurrence && (
              <View style={styles.recurrenceOptions}>
                {RECURRENCE_OPTIONS.map((opt) => {
                  const active = recurrence === opt.value;
                  return (
                    <TouchableOpacity
                      key={opt.label}
                      style={[styles.recurrencePill, active && styles.recurrencePillActive]}
                      onPress={() => {
                        setRecurrence(opt.value);
                        setShowRecurrence(false);
                      }}
                      activeOpacity={0.75}
                    >
                      <Text
                        style={[
                          styles.recurrencePillText,
                          active && styles.recurrencePillTextActive,
                        ]}
                      >
                        {opt.label}
                      </Text>
                    </TouchableOpacity>
                  );
                })}
              </View>
            )}
    </NovaSheet>
  );
}

const styles = StyleSheet.create({
  contextBar: {
    flexDirection: "row",
    alignItems: "center",
    marginBottom: 16,
  },
  contextLabel: {
    fontSize: 13,
    fontFamily: "Satoshi-Medium",
    fontWeight: "500",
    color: MUTED,
  },
  contextDot: {
    fontSize: 13,
    color: DIM,
  },
  timePreview: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    backgroundColor: colors.obsidian800,
    borderRadius: 10,
    paddingVertical: 12,
    paddingHorizontal: 14,
    borderWidth: 1,
    borderColor: colors.borderMedium,
    marginBottom: 20,
  },
  timePreviewText: {
    fontSize: 15,
    fontFamily: "Satoshi-Medium",
    fontWeight: "500",
    color: LABEL,
  },
  sectionLabel: {
    fontSize: 11,
    fontWeight: "600",
    fontFamily: "Satoshi-Medium",
    color: DIM,
    textTransform: "uppercase",
    letterSpacing: 0.5,
    marginBottom: 8,
  },
  pillRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
    marginBottom: 16,
  },
  pill: {
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 8,
    backgroundColor: colors.obsidian600,
    borderWidth: 1,
    borderColor: colors.borderMedium,
  },
  pillActive: {
    backgroundColor: "rgba(245,243,239,0.10)",
    borderColor: "rgba(245,243,239,0.25)",
  },
  pillText: {
    fontSize: 13,
    fontFamily: "Satoshi-Medium",
    fontWeight: "500",
    color: MUTED,
  },
  pillTextActive: {
    color: LABEL,
    fontWeight: "600",
  },
  input: {
    height: 44,
    borderRadius: 10,
    paddingHorizontal: 12,
    backgroundColor: colors.obsidian600,
    borderWidth: 1,
    borderColor: colors.borderMedium,
    fontSize: 15,
    fontFamily: "Satoshi-Regular",
    color: LABEL,
    marginBottom: 16,
  },
  recurrenceToggle: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingVertical: 12,
    paddingHorizontal: 14,
    backgroundColor: colors.obsidian800,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: colors.borderMedium,
    marginBottom: 8,
  },
  recurrenceToggleText: {
    flex: 1,
    fontSize: 14,
    fontFamily: "Satoshi-Medium",
    fontWeight: "500",
    color: MUTED,
  },
  recurrenceOptions: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
    marginBottom: 8,
    paddingLeft: 4,
  },
  recurrencePill: {
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderRadius: 8,
    backgroundColor: colors.obsidian600,
    borderWidth: 1,
    borderColor: colors.borderMedium,
  },
  recurrencePillActive: {
    backgroundColor: "rgba(245,243,239,0.10)",
    borderColor: "rgba(245,243,239,0.25)",
  },
  recurrencePillText: {
    fontSize: 12,
    fontFamily: "Satoshi-Medium",
    fontWeight: "500",
    color: MUTED,
  },
  recurrencePillTextActive: {
    color: LABEL,
    fontWeight: "600",
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
    backgroundColor: colors.textPrimary,
    alignItems: "center",
    justifyContent: "center",
  },
  btnDisabled: {
    opacity: 0.5,
  },
  btnPrimaryText: {
    color: BG,
    fontWeight: "600",
    fontFamily: "Satoshi-Medium",
    fontSize: 15,
  },
});
