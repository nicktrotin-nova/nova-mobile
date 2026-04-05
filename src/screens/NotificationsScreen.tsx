import { useEffect, useMemo, useState } from "react";
import {
  View,
  Text,
  ScrollView,
  TouchableOpacity,
  StyleSheet,
  Switch,
} from "react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { SafeAreaView } from "react-native-safe-area-context";
import { useNavigation } from "@react-navigation/native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import { ChevronLeft } from "lucide-react-native";
import { supabase } from "../lib/supabase";
import { useAuth } from "../contexts/AuthContext";
import type { MoreStackParamList } from "../navigation/MoreStack";
import { colors, BG, MUTED, LABEL, DIM } from "../theme/colors";
const PREFS_KEY = "nova_notification_prefs";

type Prefs = {
  newBooking: boolean;
  cancellation: boolean;
  reminder: boolean;
  dailySummary: boolean;
  rentMilestone: boolean;
  weeklySweep: boolean;
  barberScheduleChanges: boolean;
  rentAlerts: boolean;
};

const DEFAULT_PREFS: Prefs = {
  newBooking: true,
  cancellation: true,
  reminder: true,
  dailySummary: false,
  rentMilestone: true,
  weeklySweep: true,
  barberScheduleChanges: true,
  rentAlerts: true,
};

export default function NotificationsScreen() {
  const navigation =
    useNavigation<NativeStackNavigationProp<MoreStackParamList>>();
  const { user, role } = useAuth();
  const [prefs, setPrefs] = useState<Prefs>(DEFAULT_PREFS);
  const [isOwner, setIsOwner] = useState(role === "shop_owner");

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const raw = await AsyncStorage.getItem(PREFS_KEY);
      if (cancelled || !raw) return;
      try {
        const parsed = JSON.parse(raw) as Partial<Prefs>;
        setPrefs((prev) => ({ ...prev, ...parsed }));
      } catch {
        // Ignore malformed local data and keep defaults.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    void AsyncStorage.setItem(PREFS_KEY, JSON.stringify(prefs));
  }, [prefs]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (!user?.id) return;
      const { data } = await supabase
        .from("user_roles")
        .select("role")
        .eq("user_id", user.id)
        .eq("role", "shop_owner")
        .maybeSingle();
      if (!cancelled) {
        setIsOwner(!!data);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [user?.id]);

  const groups = useMemo(() => {
    const base: { title: string; rows: { key: keyof Prefs; label: string; desc: string }[] }[] = [
      {
        title: "Bookings",
        rows: [
          {
            key: "newBooking" as const,
            label: "New booking",
            desc: "When a client books online",
          },
          {
            key: "cancellation" as const,
            label: "Cancellation",
            desc: "When a client cancels",
          },
          {
            key: "reminder" as const,
            label: "Reminder",
            desc: "30 min before each appointment",
          },
        ],
      },
      {
        title: "Earnings",
        rows: [
          {
            key: "dailySummary" as const,
            label: "Daily summary",
            desc: "End of day earnings recap",
          },
          {
            key: "rentMilestone" as const,
            label: "Rent milestone",
            desc: "When rent is fully covered",
          },
          {
            key: "weeklySweep" as const,
            label: "Weekly sweep",
            desc: "Friday payout confirmation",
          },
        ],
      },
    ];

    if (isOwner) {
      base.push({
        title: "Shop",
        rows: [
          {
            key: "barberScheduleChanges" as const,
            label: "Barber schedule changes",
            desc: "When a barber updates availability",
          },
          {
            key: "rentAlerts" as const,
            label: "Rent alerts",
            desc: "When a barber falls behind on rent",
          },
        ],
      });
    }
    return base;
  }, [isOwner]);

  const setPref = (key: keyof Prefs, value: boolean) => {
    setPrefs((prev) => ({ ...prev, [key]: value }));
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
          <Text style={styles.headerTitle}>Notifications</Text>
        </View>
        <View style={styles.headerSpacer} />
      </View>

      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
      >
        {groups.map((group) => (
          <View key={group.title}>
            <Text style={styles.sectionLabel}>{group.title}</Text>
            {group.rows.map((row) => (
              <View key={row.key} style={styles.row}>
                <View style={styles.rowTextWrap}>
                  <Text style={styles.rowTitle}>{row.label}</Text>
                  <Text style={styles.rowDesc}>{row.desc}</Text>
                </View>
                <Switch
                  value={prefs[row.key]}
                  onValueChange={(v) => setPref(row.key, v)}
                  trackColor={{ false: colors.trackOff, true: colors.nova500 }}
                  thumbColor="#FFFFFF"
                />
              </View>
            ))}
          </View>
        ))}

        <Text style={styles.note}>
          Push notifications require the Nova iOS app. These preferences will
          sync when notifications are enabled.
        </Text>
      </ScrollView>
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
  scroll: {
    flex: 1,
    backgroundColor: BG,
  },
  scrollContent: {
    paddingBottom: 28,
  },
  sectionLabel: {
    fontSize: 13,
    fontWeight: "500",
    fontFamily: "Satoshi-Medium",
    color: DIM,
    letterSpacing: 0.5,
    textTransform: "uppercase",
    paddingHorizontal: 20,
    marginTop: 24,
    marginBottom: 8,
  },
  row: {
    height: 56,
    paddingHorizontal: 20,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    borderBottomWidth: 1,
    borderBottomColor: colors.white04,
    backgroundColor: colors.white03,
  },
  rowTextWrap: {
    flex: 1,
    paddingRight: 10,
  },
  rowTitle: {
    fontSize: 15,
    fontWeight: "400",
    fontFamily: "Satoshi-Regular",
    color: LABEL,
  },
  rowDesc: {
    marginTop: 2,
    fontSize: 12,
    fontFamily: "Satoshi-Regular",
    color: MUTED,
  },
  note: {
    marginTop: 32,
    paddingHorizontal: 20,
    fontSize: 12,
    fontFamily: "Satoshi-Regular",
    color: colors.white25,
    textAlign: "center",
  },
});
