/**
 * InviteBarberSheet — owner sends a barber invite via bottom sheet.
 *
 * Fields: name, email, phone. Calls invite-barber edge function.
 * Success state with green checkmark. Resets on close.
 */

import { useState, useCallback } from "react";
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  ActivityIndicator,
  Keyboard,
} from "react-native";
import { Check, UserPlus, AlertCircle } from "lucide-react-native";
import * as Haptics from "expo-haptics";
import NovaSheet from "../NovaSheet";
import { supabase } from "../../lib/supabase";
import { colors, NOVA_GREEN, LABEL, MUTED, DIM } from "../../theme/colors";

// ─── Props ──────────────────────────────────────────────────────────────────

export interface InviteBarberSheetProps {
  visible: boolean;
  onClose: () => void;
  /** Called after a successful invite so the parent can refresh counts */
  onInviteSent?: () => void;
}

// ─── Component ──────────────────────────────────────────────────────────────

export default function InviteBarberSheet({
  visible,
  onClose,
  onInviteSent,
}: InviteBarberSheetProps) {
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sentName, setSentName] = useState<string | null>(null);

  const reset = useCallback(() => {
    setName("");
    setEmail("");
    setPhone("");
    setSending(false);
    setError(null);
    setSentName(null);
  }, []);

  const handleClose = useCallback(() => {
    reset();
    onClose();
  }, [reset, onClose]);

  const canSend = name.trim().length > 0 && (email.trim().length > 0 || phone.trim().length > 0);

  const handleSend = useCallback(async () => {
    if (!canSend || sending) return;

    Keyboard.dismiss();
    setSending(true);
    setError(null);

    try {
      const { data: sessionData } = await supabase.auth.getSession();
      const token = sessionData?.session?.access_token;

      if (!token) {
        setError("Not authenticated. Please sign in again.");
        setSending(false);
        return;
      }

      const { data, error: fnError } = await supabase.functions.invoke(
        "invite-barber",
        {
          body: {
            name: name.trim(),
            email: email.trim().toLowerCase() || null,
            phone: phone.trim() || null,
          },
        }
      );

      if (fnError) {
        // Edge function returned an error
        const message =
          typeof fnError === "object" && "message" in fnError
            ? (fnError as { message: string }).message
            : "Failed to send invite. Try again.";
        setError(message);
        setSending(false);
        return;
      }

      // Check if the response body has an error field (non-2xx wrapped by supabase client)
      if (data?.error) {
        setError(data.error);
        setSending(false);
        return;
      }

      // Success
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      setSentName(name.trim());
      setSending(false);
      onInviteSent?.();
    } catch {
      setError("Something went wrong. Check your connection.");
      setSending(false);
    }
  }, [canSend, sending, name, email, phone, onInviteSent]);

  // ── Success state ─────────────────────────────────────────────────────────

  if (sentName) {
    return (
      <NovaSheet visible={visible} onClose={handleClose} title="Invite Barber">
        <View style={styles.successWrap}>
          <View style={styles.successCircle}>
            <View pointerEvents="none">
              <Check size={32} color="#fff" strokeWidth={3} />
            </View>
          </View>
          <Text style={styles.successTitle}>Invite sent</Text>
          <Text style={styles.successSubtitle}>
            {sentName} will get an invite to join your shop.
          </Text>
          <TouchableOpacity
            style={styles.doneButton}
            onPress={handleClose}
            activeOpacity={0.7}
          >
            <Text style={styles.doneButtonText}>Done</Text>
          </TouchableOpacity>
        </View>
      </NovaSheet>
    );
  }

  // ── Form state ────────────────────────────────────────────────────────────

  return (
    <NovaSheet
      visible={visible}
      onClose={handleClose}
      title="Invite Barber"
      keyboardPersistTaps="always"
      footer={
        <View style={styles.footer}>
          <TouchableOpacity
            style={[styles.sendButton, !canSend && styles.sendButtonDisabled]}
            onPress={handleSend}
            activeOpacity={0.7}
            disabled={!canSend || sending}
          >
            {sending ? (
              <ActivityIndicator color="#fff" size="small" />
            ) : (
              <>
                <View pointerEvents="none">
                  <UserPlus size={18} color="#fff" strokeWidth={2} />
                </View>
                <Text style={styles.sendButtonText}>Send Invite</Text>
              </>
            )}
          </TouchableOpacity>
        </View>
      }
    >
      <View style={styles.body}>
        <Text style={styles.description}>
          Add a barber to your shop. They'll receive an invite to create their
          Nova account and start taking bookings.
        </Text>

        {/* Name */}
        <Text style={styles.fieldLabel}>NAME</Text>
        <TextInput
          style={styles.input}
          value={name}
          onChangeText={setName}
          placeholder="Barber's full name"
          placeholderTextColor={colors.textGhost}
          autoCapitalize="words"
          autoCorrect={false}
          returnKeyType="next"
        />

        {/* Email */}
        <Text style={styles.fieldLabel}>EMAIL</Text>
        <TextInput
          style={styles.input}
          value={email}
          onChangeText={setEmail}
          placeholder="name@email.com"
          placeholderTextColor={colors.textGhost}
          keyboardType="email-address"
          autoCapitalize="none"
          autoCorrect={false}
          returnKeyType="next"
        />

        {/* Phone */}
        <Text style={styles.fieldLabel}>PHONE</Text>
        <TextInput
          style={styles.input}
          value={phone}
          onChangeText={setPhone}
          placeholder="04XX XXX XXX"
          placeholderTextColor={colors.textGhost}
          keyboardType="phone-pad"
          returnKeyType="done"
        />

        <Text style={styles.hint}>Email or phone required — we'll use it to send the invite.</Text>

        {/* Error */}
        {error ? (
          <View style={styles.errorRow}>
            <View pointerEvents="none">
              <AlertCircle size={16} color={colors.error} />
            </View>
            <Text style={styles.errorText}>{error}</Text>
          </View>
        ) : null}
      </View>
    </NovaSheet>
  );
}

// ─── Styles ─────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  body: {
    paddingHorizontal: 16,
  },
  description: {
    fontSize: 14,
    fontFamily: "Satoshi-Regular",
    color: MUTED,
    lineHeight: 20,
    marginBottom: 20,
  },

  // Fields
  fieldLabel: {
    fontSize: 11,
    fontFamily: "Satoshi-Medium",
    color: DIM,
    letterSpacing: 0.5,
    textTransform: "uppercase",
    marginBottom: 6,
    marginTop: 12,
  },
  input: {
    height: 48,
    backgroundColor: colors.obsidian600,
    borderRadius: 10,
    paddingHorizontal: 14,
    fontSize: 15,
    fontFamily: "Satoshi-Regular",
    color: LABEL,
  },
  hint: {
    fontSize: 12,
    fontFamily: "Satoshi-Regular",
    color: DIM,
    marginTop: 10,
    lineHeight: 16,
  },

  // Error
  errorRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    marginTop: 14,
    paddingHorizontal: 2,
  },
  errorText: {
    fontSize: 13,
    fontFamily: "Satoshi-Regular",
    color: colors.error,
    flex: 1,
  },

  // Footer
  footer: {
    paddingHorizontal: 16,
    paddingTop: 12,
    paddingBottom: 34,
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },
  sendButton: {
    height: 52,
    backgroundColor: NOVA_GREEN,
    borderRadius: 12,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 10,
  },
  sendButtonDisabled: {
    opacity: 0.4,
  },
  sendButtonText: {
    fontSize: 16,
    fontFamily: "Satoshi-Bold",
    fontWeight: "700",
    color: "#fff",
  },

  // Success state
  successWrap: {
    alignItems: "center",
    paddingHorizontal: 24,
    paddingTop: 20,
    paddingBottom: 16,
  },
  successCircle: {
    width: 64,
    height: 64,
    borderRadius: 32,
    backgroundColor: NOVA_GREEN,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 16,
  },
  successTitle: {
    fontSize: 20,
    fontFamily: "DMSerifText-Regular",
    color: LABEL,
    marginBottom: 8,
  },
  successSubtitle: {
    fontSize: 14,
    fontFamily: "Satoshi-Regular",
    color: MUTED,
    textAlign: "center",
    lineHeight: 20,
    marginBottom: 24,
  },
  doneButton: {
    height: 48,
    paddingHorizontal: 40,
    backgroundColor: colors.obsidian600,
    borderRadius: 10,
    alignItems: "center",
    justifyContent: "center",
  },
  doneButtonText: {
    fontSize: 15,
    fontFamily: "Satoshi-Medium",
    fontWeight: "500",
    color: LABEL,
  },
});
