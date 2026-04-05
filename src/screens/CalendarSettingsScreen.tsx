import { useEffect, useState } from "react";
import {
  View,
  Text,
  ScrollView,
  TouchableOpacity,
  StyleSheet,
} from "react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { SafeAreaView } from "react-native-safe-area-context";
import { useNavigation } from "@react-navigation/native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import { ChevronLeft, Minus, Plus } from "lucide-react-native";
import type { MoreStackParamList } from "../navigation/MoreStack";
import { colors, BG, STEEL, MUTED, DIM, LABEL, CARD_BG } from "../theme/colors";

const BORDER = colors.borderMedium;

const ZOOM_KEY = "nova_calendar_zoom";
const SLOT_KEY = "nova_slot_size";

const ZOOM_PRESETS = [100, 150, 200, 250, 300] as const;
const SLOT_OPTIONS: { value: number; label: string; desc: string }[] = [
  { value: 10, label: "10 min", desc: "Detailed" },
  { value: 15, label: "15 min", desc: "Standard" },
  { value: 30, label: "30 min", desc: "Compact" },
];

function clampZoom(v: number): number {
  return Math.max(100, Math.min(300, Math.round(v / 10) * 10));
}

function normalizeSlot(v: number): number {
  return SLOT_OPTIONS.some((o) => o.value === v) ? v : 15;
}

export default function CalendarSettingsScreen() {
  const navigation =
    useNavigation<NativeStackNavigationProp<MoreStackParamList>>();
  const [zoom, setZoom] = useState(200);
  const [slotSize, setSlotSize] = useState(15);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const [storedZoom, storedSlot] = await Promise.all([
        AsyncStorage.getItem(ZOOM_KEY),
        AsyncStorage.getItem(SLOT_KEY),
      ]);
      if (cancelled) return;
      const z = Number(storedZoom);
      const s = Number(storedSlot);
      if (!Number.isNaN(z)) setZoom(clampZoom(z));
      if (!Number.isNaN(s)) setSlotSize(normalizeSlot(s));
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    void AsyncStorage.setItem(ZOOM_KEY, String(zoom));
  }, [zoom]);

  useEffect(() => {
    void AsyncStorage.setItem(SLOT_KEY, String(slotSize));
  }, [slotSize]);

  return (
    <SafeAreaView style={styles.safe} edges={["top"]}>
      {/* Header */}
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
          <Text style={styles.headerTitle}>Calendar Settings</Text>
        </View>
        <View style={styles.headerSpacer} />
      </View>

      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
      >
        {/* Zoom Level */}
        <View style={styles.card}>
          <Text style={styles.cardLabel}>Zoom Level</Text>

          <View style={styles.zoomRow}>
            <TouchableOpacity
              style={styles.roundBtn}
              onPress={() => setZoom((z) => clampZoom(z - 10))}
              activeOpacity={0.7}
              delayPressIn={0}
            >
              <View pointerEvents="none">
                <Minus size={20} color={LABEL} strokeWidth={2.4} />
              </View>
            </TouchableOpacity>
            <Text style={styles.zoomValue}>{zoom}%</Text>
            <TouchableOpacity
              style={styles.roundBtn}
              onPress={() => setZoom((z) => clampZoom(z + 10))}
              activeOpacity={0.7}
              delayPressIn={0}
            >
              <View pointerEvents="none">
                <Plus size={20} color={LABEL} strokeWidth={2.4} />
              </View>
            </TouchableOpacity>
          </View>

          <View style={styles.pillsRow}>
            {ZOOM_PRESETS.map((z) => {
              const sel = zoom === z;
              return (
                <TouchableOpacity
                  key={z}
                  onPress={() => setZoom(z)}
                  style={[styles.pill, sel && styles.pillSel]}
                  activeOpacity={0.7}
                >
                  <Text style={[styles.pillText, sel && styles.pillTextSel]}>
                    {z}%
                  </Text>
                </TouchableOpacity>
              );
            })}
          </View>
        </View>

        {/* Grid Interval */}
        <View style={styles.card}>
          <Text style={styles.cardLabel}>Grid Interval</Text>
          <View style={styles.slotRow}>
            {SLOT_OPTIONS.map((opt) => {
              const sel = slotSize === opt.value;
              return (
                <TouchableOpacity
                  key={opt.value}
                  onPress={() => setSlotSize(opt.value)}
                  style={[styles.slotOption, sel && styles.slotOptionSel]}
                  activeOpacity={0.7}
                >
                  <Text
                    style={[styles.slotValue, sel && styles.slotValueSel]}
                  >
                    {opt.label}
                  </Text>
                  <Text
                    style={[styles.slotDesc, sel && styles.slotDescSel]}
                  >
                    {opt.desc}
                  </Text>
                </TouchableOpacity>
              );
            })}
          </View>
        </View>

        <Text style={styles.note}>
          These settings only affect how the calendar looks on this device.
        </Text>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: BG },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 8,
    height: 52,
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
  headerTitle: { fontSize: 17, fontWeight: "600", fontFamily: "Satoshi-Medium", color: LABEL },
  headerSpacer: { width: 44, zIndex: 2 },
  scroll: { flex: 1 },
  scrollContent: {
    paddingHorizontal: 20,
    paddingTop: 12,
    paddingBottom: 28,
  },

  // Cards
  card: {
    borderRadius: 12,
    backgroundColor: CARD_BG,
    borderWidth: 1,
    borderColor: BORDER,
    padding: 16,
    marginBottom: 12,
  },
  cardLabel: {
    fontSize: 14,
    fontWeight: "600",
    fontFamily: "Satoshi-Medium",
    color: LABEL,
    marginBottom: 4,
  },
  cardHint: {
    fontSize: 13,
    color: DIM,
    marginBottom: 4,
  },

  // Zoom
  zoomRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginTop: 12,
  },
  roundBtn: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: colors.border,
    borderWidth: 1,
    borderColor: BORDER,
    alignItems: "center",
    justifyContent: "center",
  },
  zoomValue: {
    flex: 1,
    fontSize: 28,
    fontWeight: "600",
    fontFamily: "Satoshi-Medium",
    color: LABEL,
    textAlign: "center",
    fontVariant: ["tabular-nums"],
  },

  // Pills
  pillsRow: {
    marginTop: 14,
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
  },
  pill: {
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 10,
    backgroundColor: colors.border,
    borderWidth: 1,
    borderColor: "transparent",
  },
  pillSel: {
    backgroundColor: colors.warmWhite10,
    borderColor: colors.warmWhite25,
  },
  pillText: { fontSize: 14, fontWeight: "500", fontFamily: "Satoshi-Medium", color: MUTED },
  pillTextSel: { color: STEEL },

  // Slot options
  slotRow: {
    flexDirection: "row",
    gap: 8,
    marginTop: 12,
  },
  slotOption: {
    flex: 1,
    borderRadius: 12,
    paddingVertical: 16,
    alignItems: "center",
    backgroundColor: colors.border,
    borderWidth: 1,
    borderColor: "transparent",
  },
  slotOptionSel: {
    backgroundColor: colors.warmWhite08,
    borderColor: colors.warmWhite20,
  },
  slotValue: {
    fontSize: 16,
    fontWeight: "600",
    fontFamily: "Satoshi-Medium",
    color: MUTED,
  },
  slotValueSel: { color: STEEL },
  slotDesc: {
    fontSize: 12,
    fontFamily: "Satoshi-Regular",
    color: DIM,
    marginTop: 3,
  },
  slotDescSel: { color: colors.warmWhite50 },

  // Note
  note: {
    marginTop: 20,
    textAlign: "center",
    fontSize: 12,
    fontFamily: "Satoshi-Regular",
    color: colors.white25,
  },
});
