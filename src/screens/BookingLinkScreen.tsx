import { useState, useEffect, useCallback, useRef } from "react";
import {
  View,
  Text,
  ScrollView,
  TouchableOpacity,
  StyleSheet,
  ActivityIndicator,
  Share,
  Alert,
  Platform,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useNavigation } from "@react-navigation/native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import { ChevronLeft } from "lucide-react-native";
import { supabase } from "../lib/supabase";
import { useAuth } from "../contexts/AuthContext";
import type { MoreStackParamList } from "../navigation/MoreStack";
import { colors, BG, NOVA_GREEN, MUTED, LABEL, CARD_BG, BORDER } from "../theme/colors";
import { useScreenData } from "../hooks/useScreenData";

const BOOKING_BASE = "https://getnova.com.au";

function slugify(raw: string): string {
  const s = raw
    .trim()
    .toLowerCase()
    .replace(/\s+/g, "-")
    .replace(/[^a-z0-9-]/g, "")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
  return s.length > 0 ? s : "barber";
}

export default function BookingLinkScreen() {
  const navigation =
    useNavigation<NativeStackNavigationProp<MoreStackParamList>>();
  const { barberId, shopId } = useAuth();
  const [url, setUrl] = useState("");
  const [copied, setCopied] = useState(false);
  const copyTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const load = useCallback(async () => {
    if (!barberId) {
      setUrl("");
      return;
    }

    const barberRes = await supabase
      .from("barbers")
      .select("booking_url_slug, display_name, name, shop_id")
      .eq("id", barberId)
      .maybeSingle();

    const barberRow = barberRes.data as {
      booking_url_slug?: string | null;
      display_name?: string | null;
      name?: string | null;
      shop_id?: string | null;
    } | null;

    const resolvedShopId = shopId ?? barberRow?.shop_id ?? null;

    let shopSlug: string | null = null;
    if (resolvedShopId) {
      const shopRes = await supabase
        .from("shops")
        .select("slug")
        .eq("id", resolvedShopId)
        .maybeSingle();
      if (!shopRes.error && shopRes.data) {
        const s = (shopRes.data as { slug?: string | null }).slug?.trim();
        shopSlug = s && s.length > 0 ? s : null;
      }
    }

    const barberSlug =
      (barberRow?.booking_url_slug?.trim() &&
        slugify(barberRow.booking_url_slug.trim())) ||
      slugify(
        barberRow?.display_name?.trim() ||
          barberRow?.name?.trim() ||
          "barber",
      );

    const shopSeg = shopSlug ?? "shop";
    setUrl(`${BOOKING_BASE}/${shopSeg}/${barberSlug}`);
  }, [barberId, shopId]);

  const { loading } = useScreenData(load, [load], !!barberId);

  useEffect(() => {
    return () => {
      if (copyTimerRef.current) clearTimeout(copyTimerRef.current);
    };
  }, []);

  const onCopy = async () => {
    if (!url) return;
    try {
      if (
        Platform.OS === "web" &&
        typeof navigator !== "undefined" &&
        navigator.clipboard?.writeText
      ) {
        await navigator.clipboard.writeText(url);
      } else {
        const { Clipboard } = require("react-native");
        Clipboard.setString(url);
      }
      setCopied(true);
      if (copyTimerRef.current) clearTimeout(copyTimerRef.current);
      copyTimerRef.current = setTimeout(() => setCopied(false), 2000);
    } catch {
      Alert.alert("Copy failed", "Could not copy to the clipboard.");
    }
  };

  const onShare = async () => {
    if (!url) return;
    try {
      await Share.share({ message: url, url });
    } catch {
      /* user dismissed */
    }
  };

  return (
    <SafeAreaView style={styles.safe} edges={["top"]}>
      <View style={styles.header}>
        <TouchableOpacity
          onPress={() => navigation.goBack()}
          style={styles.backBtn}
          hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
          activeOpacity={0.7}
        >
          <View pointerEvents="none">
            <ChevronLeft size={24} color={LABEL} strokeWidth={2} />
          </View>
        </TouchableOpacity>
        <View style={styles.headerTitleWrap} pointerEvents="none">
          <Text style={styles.headerTitle}>My Booking Link</Text>
        </View>
        <View style={styles.headerSpacer} />
      </View>

      {loading ? (
        <View style={styles.loadingWrap}>
          <ActivityIndicator color={NOVA_GREEN} size="large" />
        </View>
      ) : (
        <ScrollView
          style={styles.scroll}
          contentContainerStyle={styles.scrollContent}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          <View style={styles.centerBlock}>
            <View style={styles.urlCard}>
              <Text style={styles.urlText} selectable>
                {url || "—"}
              </Text>
            </View>

            <TouchableOpacity
              style={styles.copyBtn}
              onPress={() => void onCopy()}
              activeOpacity={0.85}
              disabled={!url}
            >
              <Text style={styles.copyBtnText}>
                {copied ? "Copied ✓" : "Copy Link"}
              </Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={styles.shareBtn}
              onPress={() => void onShare()}
              activeOpacity={0.85}
              disabled={!url}
            >
              <Text style={styles.shareBtnText}>Share Link</Text>
            </TouchableOpacity>

            <Text style={styles.qrHint}>QR code coming soon</Text>
          </View>
        </ScrollView>
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: {
    flex: 1,
    backgroundColor: BG,
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 8,
    height: 52,
    backgroundColor: BG,
  },
  backBtn: {
    width: 44,
    height: 44,
    alignItems: "center",
    justifyContent: "center",
    zIndex: 2,
  },
  headerTitleWrap: {
    ...StyleSheet.absoluteFillObject,
    justifyContent: "center",
    alignItems: "center",
    zIndex: 1,
  },
  headerTitle: {
    fontSize: 17,
    fontWeight: "600",
    fontFamily: "Satoshi-Medium",
    color: LABEL,
    textAlign: "center",
  },
  headerSpacer: {
    width: 44,
    zIndex: 2,
  },
  loadingWrap: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    backgroundColor: BG,
  },
  scroll: {
    flex: 1,
    backgroundColor: BG,
  },
  scrollContent: {
    flexGrow: 1,
    justifyContent: "center",
    paddingHorizontal: 20,
    paddingVertical: 32,
  },
  centerBlock: {
    width: "100%",
    maxWidth: 400,
    alignSelf: "center",
  },
  urlCard: {
    backgroundColor: CARD_BG,
    borderRadius: 14,
    padding: 20,
    borderWidth: 1,
    borderColor: BORDER,
  },
  urlText: {
    fontSize: 15,
    fontWeight: "500",
    fontFamily: "Satoshi-Medium",
    color: NOVA_GREEN,
    textAlign: "center",
  },
  copyBtn: {
    marginTop: 16,
    width: "100%",
    height: 48,
    borderRadius: 10,
    backgroundColor: colors.obsidian600,
    alignItems: "center",
    justifyContent: "center",
  },
  copyBtnText: {
    fontSize: 15,
    fontWeight: "600",
    fontFamily: "Satoshi-Medium",
    color: LABEL,
  },
  shareBtn: {
    marginTop: 12,
    width: "100%",
    height: 48,
    borderRadius: 10,
    backgroundColor: BORDER,
    borderWidth: 1,
    borderColor: colors.borderMedium,
    alignItems: "center",
    justifyContent: "center",
  },
  shareBtnText: {
    fontSize: 15,
    fontWeight: "500",
    fontFamily: "Satoshi-Medium",
    color: LABEL,
  },
  qrHint: {
    marginTop: 24,
    fontSize: 12,
    fontFamily: "Satoshi-Regular",
    color: MUTED,
    textAlign: "center",
  },
});
