import { useState, useEffect, useCallback } from "react";
import {
  View,
  Text,
  TouchableOpacity,
  TextInput,
  StyleSheet,
  Alert,
} from "react-native";
import { format, parse } from "date-fns";
import { Repeat } from "lucide-react-native";
import { supabase } from "../lib/supabase";
import { colors, BG, LABEL, MUTED, DIM } from "../theme/colors";
import NovaSheet from "./NovaSheet";
import { formatTime12 } from "../utils/formatters";
import type { Override } from "../types/domain";

export interface BlockDetailSheetProps {
  block: Override | null;
  visible: boolean;
  onClose: () => void;
  onActionComplete: () => void;
  barberName: string;
}

function repeatsLabel(pattern: string | null | undefined): string {
  switch (pattern) {
    case "daily":
      return "Repeats every day";
    case "weekly":
      return "Repeats every week";
    case "monthly":
      return "Repeats every month";
    default:
      return "Repeats";
  }
}

function normalizeDbTime(t: string | null): string | null {
  if (!t) return null;
  if (t.length === 5) return `${t}:00`;
  return t;
}

export default function BlockDetailSheet({
  block,
  visible,
  onClose,
  onActionComplete,
  barberName,
}: BlockDetailSheetProps) {
  const [reason, setReason] = useState("");

  const resetReason = useCallback(() => {
    setReason(block?.reason?.trim() ? block.reason : "");
  }, [block?.reason, block?.id]);

  useEffect(() => {
    if (visible && block) resetReason();
  }, [visible, block?.id, resetReason]);

  const handleSave = async () => {
    if (!block) return;
    const reasonTrim = reason.trim() || null;

    if (block._virtual) {
      const skipPayload = {
        barber_id: block.barber_id,
        override_date: block.override_date,
        is_blocked: false,
        is_recurring: false,
        start_time: null as string | null,
        end_time: null as string | null,
        reason: null as string | null,
      };
      const blockPayload = {
        barber_id: block.barber_id,
        override_date: block.override_date,
        is_blocked: true,
        is_recurring: false,
        start_time: normalizeDbTime(block.start_time),
        end_time: normalizeDbTime(block.end_time),
        reason: reasonTrim,
      };

      const { error: skipErr } = await supabase
        .from("availability_overrides")
        .insert(skipPayload);
      if (skipErr) return;

      const { error: insErr } = await supabase
        .from("availability_overrides")
        .insert(blockPayload);
      if (!insErr) {
        onActionComplete();
        onClose();
      }
      return;
    }

    const { error } = await supabase
      .from("availability_overrides")
      .update({ reason: reasonTrim })
      .eq("id", block.id);
    if (error) {
      Alert.alert("Could not update block", error.message);
      return;
    }
    onActionComplete();
    onClose();
  };

  const deleteTemplate = async (templateId: string) => {
    const { error } = await supabase
      .from("availability_overrides")
      .delete()
      .eq("id", templateId);
    if (error) {
      Alert.alert("Could not delete block", error.message);
      return;
    }
    onActionComplete();
    onClose();
  };

  const handleRemove = () => {
    if (!block) return;
    const isSeries = !!(block._virtual || block.is_recurring);

    if (isSeries) {
      Alert.alert(
        "Remove block",
        "Delete all occurrences of this recurring block?",
        [
          { text: "Cancel", style: "cancel" },
          {
            text: "Delete all occurrences",
            style: "destructive",
            onPress: () => {
              const templateId = block._source_id ?? block.id;
              void deleteTemplate(templateId);
            },
          },
        ],
      );
      return;
    }

    void (async () => {
      const { error } = await supabase
        .from("availability_overrides")
        .delete()
        .eq("id", block.id);
      if (!error) {
        onActionComplete();
        onClose();
      }
    })();
  };

  if (!block) {
    return null;
  }

  const aptDate = parse(block.override_date, "yyyy-MM-dd", new Date());
  const dateFormatted = format(aptDate, "EEE, MMM d");
  const st = block.start_time ? formatTime12(block.start_time) : "";
  const et = block.end_time ? formatTime12(block.end_time) : "";
  const timeRange = st && et ? `${st} – ${et}` : "—";
  const showRepeat = !!(block.is_recurring || block._virtual);

  return (
    <NovaSheet
      visible={visible && !!block}
      onClose={onClose}
      title="Blocked Time"
      footer={
        <View style={styles.footer}>
          <TouchableOpacity
            style={styles.btnDanger}
            onPress={handleRemove}
            activeOpacity={0.85}
          >
            <Text style={styles.btnDangerText}>Remove Block</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={styles.btnPrimary}
            onPress={handleSave}
            activeOpacity={0.85}
          >
            <Text style={styles.btnPrimaryText}>Save Changes</Text>
          </TouchableOpacity>
        </View>
      }
    >
            <View style={styles.infoCard}>
              <Text style={styles.infoLabel}>Barber</Text>
              <Text style={styles.infoValue}>{barberName}</Text>
              <Text style={styles.infoLabelSpaced}>Date</Text>
              <Text style={styles.infoValue}>{dateFormatted}</Text>
              <Text style={styles.infoLabelSpaced}>Time</Text>
              <Text style={styles.infoValue}>{timeRange}</Text>
              <Text style={styles.infoLabelSpaced}>Reason</Text>
              <Text
                style={
                  block.reason?.trim()
                    ? styles.infoValue
                    : styles.infoMuted
                }
              >
                {block.reason?.trim() ? block.reason : "No reason"}
              </Text>
            </View>

            {showRepeat ? (
              <View style={styles.repeatRow}>
                <Repeat size={16} color={MUTED} strokeWidth={2} />
                <Text style={styles.repeatText}>
                  {repeatsLabel(block.recurrence_pattern)}
                </Text>
              </View>
            ) : null}

            <Text style={styles.inputLabel}>Edit reason</Text>
            <TextInput
              style={styles.input}
              value={reason}
              onChangeText={setReason}
              placeholder="e.g. Lunch, Break"
              placeholderTextColor={MUTED}
            />
    </NovaSheet>
  );
}

const styles = StyleSheet.create({
  infoCard: {
    marginHorizontal: 16,
    marginBottom: 16,
    padding: 14,
    borderRadius: 12,
    backgroundColor: colors.obsidian800,
    borderWidth: 1,
    borderColor: colors.borderMedium,
  },
  infoLabel: {
    fontSize: 11,
    fontWeight: "600",
    fontFamily: "Satoshi-Medium",
    color: MUTED,
    textTransform: "uppercase",
    letterSpacing: 0.05 * 16,
  },
  infoLabelSpaced: {
    fontSize: 11,
    fontWeight: "600",
    fontFamily: "Satoshi-Medium",
    color: MUTED,
    textTransform: "uppercase",
    letterSpacing: 0.05 * 16,
    marginTop: 10,
  },
  infoValue: {
    fontSize: 15,
    fontWeight: "500",
    fontFamily: "Satoshi-Medium",
    color: LABEL,
    marginTop: 4,
  },
  infoMuted: {
    fontSize: 15,
    fontWeight: "400",
    fontFamily: "Satoshi-Regular",
    color: MUTED,
    marginTop: 4,
  },
  repeatRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    marginHorizontal: 16,
    marginBottom: 16,
  },
  repeatText: {
    fontSize: 13,
    color: MUTED,
    fontWeight: "500",
    fontFamily: "Satoshi-Medium",
  },
  inputLabel: {
    fontSize: 12,
    fontWeight: "600",
    fontFamily: "Satoshi-Medium",
    color: DIM,
    marginHorizontal: 16,
    marginBottom: 8,
  },
  input: {
    marginHorizontal: 16,
    height: 44,
    borderRadius: 10,
    paddingHorizontal: 12,
    backgroundColor: colors.obsidian600,
    borderWidth: 1,
    borderColor: colors.borderMedium,
    fontSize: 15,
    color: LABEL,
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
    backgroundColor: colors.errorAlt10,
    borderWidth: 1,
    borderColor: colors.errorAlt20,
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
});
