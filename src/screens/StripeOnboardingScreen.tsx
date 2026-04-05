import React, { useEffect, useState, useCallback } from "react";
import {
  View,
  Text,
  StyleSheet,
  ActivityIndicator,
  TouchableOpacity,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { WebView } from "react-native-webview";
import { CircleCheck, ArrowLeft } from "lucide-react-native";
import { colors } from "../theme/colors";
import { supabase } from "../lib/supabase";
import { useAuth } from "../contexts/AuthContext";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import type { MoreStackParamList } from "../navigation/MoreStack";

type Props = NativeStackScreenProps<MoreStackParamList, "StripeOnboarding">;

const RETURN_URL = "getnova.com.au/stripe/complete";
const REFRESH_URL = "getnova.com.au/stripe/refresh";

export default function StripeOnboardingScreen({ navigation }: Props) {
  const { barberId, shopId, role, user } = useAuth();
  const isOwner = role === "shop_owner";

  const [onboardingUrl, setOnboardingUrl] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [complete, setComplete] = useState(false);

  const fetchOnboardingLink = useCallback(async () => {
    setLoading(true);
    setError(null);
    setOnboardingUrl(null);

    // Owner-barbers: one account, set on both shop + barber records
    // The edge function sets stripe_account_id on the entity_type table.
    // For owner-barbers, we create under "owner" (shop) first,
    // then copy the account ID to the barber record too.
    const entityType = isOwner ? "owner" : "barber";
    const entityId = isOwner ? shopId : barberId;

    try {
      const { data, error: fnError } = await supabase.functions.invoke(
        "create-connect-account",
        {
          body: {
            entity_type: entityType,
            entity_id: entityId,
            email: user?.email,
          },
        }
      );

      if (fnError) {
        setError(fnError.message || "Something went wrong. Give it another go.");
        setLoading(false);
        return;
      }

      if (!data?.onboarding_url) {
        setError("No onboarding link returned. Try again.");
        setLoading(false);
        return;
      }

      // Owner-barber: also set the same account on the barber record
      if (isOwner && barberId && data.account_id) {
        await supabase
          .from("barbers")
          .update({ stripe_account_id: data.account_id })
          .eq("id", barberId);
      }

      setOnboardingUrl(data.onboarding_url);
      setLoading(false);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : "Something went wrong. Give it another go.";
      setError(message);
      setLoading(false);
    }
  }, [isOwner, shopId, barberId, user?.email]);

  useEffect(() => {
    fetchOnboardingLink();
  }, [fetchOnboardingLink]);

  const isOwnerBarber = isOwner && !!barberId;
  const stepLabel = isOwner ? "Connect your shop" : "Connect your payments";
  const stepHint = isOwner
    ? "Your details and bank account for receiving payments"
    : "Your details and bank account for receiving earnings";

  // ── Loading state ──
  if (loading) {
    return (
      <SafeAreaView style={styles.container}>
        <View style={styles.centered}>
          <ActivityIndicator size="large" color={colors.nova500} />
          <Text style={styles.loadingText}>Setting things up...</Text>
        </View>
      </SafeAreaView>
    );
  }

  // ── Error state ──
  if (error) {
    return (
      <SafeAreaView style={styles.container}>
        <View style={styles.centered}>
          <Text style={styles.errorText}>{error}</Text>
          <TouchableOpacity
            style={styles.retryButton}
            onPress={fetchOnboardingLink}
            delayPressIn={0}
            activeOpacity={0.8}
          >
            <Text style={styles.retryButtonText}>Try again</Text>
          </TouchableOpacity>
        </View>
      </SafeAreaView>
    );
  }

  // ── Success state ──
  if (complete) {
    return (
      <SafeAreaView style={styles.container}>
        <View style={styles.centered}>
          <View pointerEvents="none">
            <CircleCheck size={56} color={colors.nova500} />
          </View>
          <Text style={styles.successTitle}>You're all set</Text>
          <Text style={styles.successSubtitle}>
            {isOwnerBarber
              ? "Shop and personal accounts are connected"
              : "Your payments are connected"}
          </Text>
        </View>
        <View style={styles.footer}>
          <TouchableOpacity
            style={styles.doneButton}
            onPress={() => navigation.goBack()}
            delayPressIn={0}
            activeOpacity={0.8}
          >
            <Text style={styles.doneButtonText}>Done</Text>
          </TouchableOpacity>
        </View>
      </SafeAreaView>
    );
  }

  // ── WebView state ──
  return (
    <SafeAreaView style={styles.container} edges={["top"]}>
      <View style={styles.stepBar}>
        <TouchableOpacity
          style={styles.backButtonInline}
          onPress={() => navigation.goBack()}
          delayPressIn={0}
          activeOpacity={0.7}
        >
          <View pointerEvents="none">
            <ArrowLeft size={20} color={colors.textPrimary} />
          </View>
        </TouchableOpacity>
        <View style={styles.stepTextCol}>
          <Text style={styles.stepLabel}>{stepLabel}</Text>
          <Text style={styles.stepHint}>{stepHint}</Text>
        </View>
      </View>
      <WebView
        source={{ uri: onboardingUrl! }}
        style={styles.webview}
        onNavigationStateChange={(navState) => {
          if (navState.url.includes(RETURN_URL)) {
            setComplete(true);
          }
          if (navState.url.includes(REFRESH_URL)) {
            fetchOnboardingLink();
          }
        }}
        startInLoadingState
        renderLoading={() => (
          <View style={styles.webviewLoading}>
            <ActivityIndicator size="large" color={colors.nova500} />
          </View>
        )}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.obsidian900,
  },
  centered: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    paddingHorizontal: 32,
  },
  loadingText: {
    fontFamily: "Satoshi-Regular",
    fontSize: 15,
    color: colors.textSecondary,
    marginTop: 16,
  },
  errorText: {
    fontFamily: "Satoshi-Regular",
    fontSize: 15,
    color: colors.error,
    textAlign: "center",
    marginBottom: 24,
    lineHeight: 22,
  },
  retryButton: {
    backgroundColor: colors.nova500,
    paddingVertical: 14,
    paddingHorizontal: 32,
    borderRadius: 12,
  },
  retryButtonText: {
    fontFamily: "Satoshi-Bold",
    fontSize: 15,
    color: colors.textInverse,
  },
  successTitle: {
    fontFamily: "Satoshi-Medium",
    fontSize: 20,
    color: colors.textPrimary,
    marginTop: 20,
  },
  successSubtitle: {
    fontFamily: "Satoshi-Regular",
    fontSize: 14,
    color: colors.textSecondary,
    marginTop: 6,
  },
  footer: {
    paddingHorizontal: 24,
    paddingBottom: 24,
  },
  doneButton: {
    backgroundColor: colors.nova500,
    paddingVertical: 16,
    borderRadius: 12,
    alignItems: "center",
  },
  doneButtonText: {
    fontFamily: "Satoshi-Bold",
    fontSize: 16,
    color: colors.textInverse,
  },
  stepBar: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 16,
    paddingVertical: 12,
    backgroundColor: colors.obsidian800,
    borderBottomWidth: 1,
    borderBottomColor: colors.borderLight,
  },
  backButtonInline: {
    width: 36,
    height: 36,
    borderRadius: 18,
    justifyContent: "center",
    alignItems: "center",
    marginRight: 12,
  },
  stepTextCol: {
    flex: 1,
  },
  stepLabel: {
    fontFamily: "Satoshi-Medium",
    fontSize: 15,
    color: colors.textPrimary,
  },
  stepHint: {
    fontFamily: "Satoshi-Regular",
    fontSize: 12,
    color: colors.textSecondary,
    marginTop: 2,
  },
  webview: {
    flex: 1,
  },
  webviewLoading: {
    ...StyleSheet.absoluteFillObject,
    justifyContent: "center",
    alignItems: "center",
    backgroundColor: colors.obsidian900,
  },
});
