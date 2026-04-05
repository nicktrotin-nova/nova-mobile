import { useState, useEffect, useCallback, type ReactNode } from "react";
import {
  View,
  Text,
  ScrollView,
  TouchableOpacity,
  Image,
  StyleSheet,
  ActivityIndicator,
  Platform,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import {
  Clock,
  Scissors,
  Settings,
  User,
  Link2,
  Bell,
  Download,
  HelpCircle,
  LogOut,
  ChevronRight,
  Users,
  Building2,
  UserPlus,
} from "lucide-react-native";
import { useNavigation } from "@react-navigation/native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import type { BottomTabNavigationProp } from "@react-navigation/bottom-tabs";
import { supabase } from "../lib/supabase";
import { useAuth } from "../contexts/AuthContext";
import type { MoreStackParamList } from "../navigation/MoreStack";
import type { RootTabParamList } from "../navigation/RootTabParamList";
import { colors, BG, NOVA_GREEN, LABEL, MUTED, DIM } from "../theme/colors";
import { useScreenData } from "../hooks/useScreenData";
import InviteBarberSheet from "../components/owner/InviteBarberSheet";

const ICON_ROW = colors.textSecondary;
const CHEVRON = "rgba(255,255,255,0.15)";

interface BarberRow {
  name: string;
  display_name: string | null;
  avatar_url: string | null;
}

type MoreStackDest = Exclude<keyof MoreStackParamList, "MoreMenu">;

export default function MoreScreen() {
  const stackNav =
    useNavigation<NativeStackNavigationProp<MoreStackParamList, "MoreMenu">>();
  const { barberId, shopId, role, user } = useAuth();
  const isOwner = role === "shop_owner";

  const openMoreStack = (screen: MoreStackDest) => {
    const tabNav = stackNav.getParent<BottomTabNavigationProp<RootTabParamList>>();
    if (tabNav) {
      tabNav.navigate("More", { screen });
    } else {
      stackNav.navigate(screen);
    }
  };
  const [barber, setBarber] = useState<BarberRow | null>(null);
  const [shopName, setShopName] = useState("");
  const [showInvite, setShowInvite] = useState(false);

  const loadBarber = useCallback(async () => {
    if (!barberId) return;
    const { data, error } = await supabase
      .from("barbers")
      .select("name, display_name, avatar_url")
      .eq("id", barberId)
      .maybeSingle();

    if (!error && data) {
      setBarber(data as BarberRow);
    }
  }, [barberId]);

  const { loading } = useScreenData(loadBarber, [loadBarber], !!barberId);

  useEffect(() => {
    if (!shopId || !isOwner) return;
    let cancelled = false;
    (async () => {
      const { data } = await supabase
        .from("shops")
        .select("name")
        .eq("id", shopId)
        .maybeSingle();
      if (!cancelled) setShopName(data?.name ?? "");
    })();
    return () => { cancelled = true; };
  }, [shopId, isOwner]);

  const displayLabel =
    barber?.display_name?.trim() || barber?.name?.trim() || "Barber";
  const email = user?.email ?? "";
  const initial = (displayLabel[0] || "?").toUpperCase();

  if (loading) {
    return (
      <SafeAreaView style={styles.safe} edges={["top"]}>
        <View style={styles.loadingWrap}>
          <ActivityIndicator color={NOVA_GREEN} size="large" />
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.safe} edges={["top"]}>
      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="always"
      >
        <View style={styles.header}>
          {barber?.avatar_url ? (
            <Image
              source={{ uri: barber.avatar_url }}
              style={styles.avatar}
            />
          ) : (
            <View style={styles.avatarFallback}>
              <Text style={styles.avatarFallbackText}>{initial}</Text>
            </View>
          )}
          <View style={styles.headerTextCol}>
            <Text style={styles.displayName} numberOfLines={2}>
              {displayLabel}
            </Text>
            {email ? (
              <Text style={styles.email} numberOfLines={1}>
                {email}
              </Text>
            ) : null}
          </View>
        </View>

        {isOwner && (
          <>
            <Text style={styles.sectionLabel}>Shop owner</Text>
            <MenuRow
              icon={<Building2 size={20} color={NOVA_GREEN} />}
              label={shopName || "My Shop"}
              onPress={() => openMoreStack("OwnerOverlay")}
            />
            <MenuRow
              icon={<UserPlus size={20} color={NOVA_GREEN} />}
              label="Invite Barber"
              onPress={() => setShowInvite(true)}
            />
          </>
        )}

        <Text style={styles.sectionLabel}>My business</Text>
        <MenuRow
          icon={<Clock size={20} color={ICON_ROW} />}
          label="My Schedule"
          onPress={() => openMoreStack("MySchedule")}
        />
        <MenuRow
          icon={<Scissors size={20} color={ICON_ROW} />}
          label="My Services"
          onPress={() => openMoreStack("MyServices")}
        />
        <MenuRow
          icon={<Users size={20} color={ICON_ROW} />}
          label="Clients"
          onPress={() => openMoreStack("Clients")}
        />
        <MenuRow
          icon={<Settings size={20} color={ICON_ROW} />}
          label="Calendar Settings"
          onPress={() => openMoreStack("CalendarSettings")}
        />

        <Text style={styles.sectionLabel}>My profile</Text>
        <MenuRow
          icon={<User size={20} color={ICON_ROW} />}
          label="My Profile"
          onPress={() => openMoreStack("MyProfile")}
        />
        <MenuRow
          icon={<Link2 size={20} color={ICON_ROW} strokeWidth={2} />}
          label="My Booking Link"
          onPress={() => openMoreStack("BookingLink")}
        />

        <Text style={styles.sectionLabel}>Preferences</Text>
        <MenuRow
          icon={<Bell size={20} color={ICON_ROW} />}
          label="Notifications"
          onPress={() => openMoreStack("Notifications")}
        />

        <Text style={styles.sectionLabel}>Support</Text>
        <MenuRow
          icon={<Download size={20} color={ICON_ROW} />}
          label="Export My Data"
          onPress={() => {}}
        />
        <MenuRow
          icon={<HelpCircle size={20} color={ICON_ROW} />}
          label="Help & Support"
          onPress={() => {}}
        />

        <Text style={styles.sectionLabel}>Account</Text>
        <TouchableOpacity
          style={styles.menuRow}
          onPress={() => {
            void supabase.auth.signOut();
          }}
          activeOpacity={0.7}
        >
          <LogOut size={20} color={colors.error} />
          <Text style={styles.signOutLabel}>Sign Out</Text>
        </TouchableOpacity>

        <Text style={styles.footer}>Nova v0.1.0</Text>
      </ScrollView>

      {isOwner && (
        <InviteBarberSheet
          visible={showInvite}
          onClose={() => setShowInvite(false)}
        />
      )}
    </SafeAreaView>
  );
}

function MenuRow({
  icon,
  label,
  onPress,
}: {
  icon: ReactNode;
  label: string;
  onPress: () => void;
}) {
  return (
    <TouchableOpacity
      style={[styles.menuRow, Platform.OS === "web" && styles.menuRowWeb]}
      onPress={onPress}
      activeOpacity={0.7}
      delayPressIn={0}
    >
      <View pointerEvents="none" style={styles.menuRowIcon}>
        {icon}
      </View>
      <Text style={styles.menuLabel} pointerEvents="none" selectable={false}>
        {label}
      </Text>
      <View pointerEvents="none">
        <ChevronRight size={16} color={CHEVRON} strokeWidth={2} />
      </View>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  safe: {
    flex: 1,
    backgroundColor: BG,
  },
  scroll: {
    flex: 1,
    backgroundColor: BG,
  },
  scrollContent: {
    flexGrow: 1,
    paddingBottom: 24,
  },
  loadingWrap: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    backgroundColor: BG,
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 20,
    paddingTop: 20,
    paddingBottom: 8,
    backgroundColor: BG,
  },
  avatar: {
    width: 44,
    height: 44,
    borderRadius: 22,
  },
  avatarFallback: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: colors.obsidian700,
    alignItems: "center",
    justifyContent: "center",
  },
  avatarFallbackText: {
    fontSize: 16,
    fontWeight: "600",
    fontFamily: "Satoshi-Medium",
    color: LABEL,
  },
  headerTextCol: {
    flex: 1,
    marginLeft: 14,
    justifyContent: "center",
  },
  displayName: {
    fontSize: 18,
    fontWeight: "600",
    fontFamily: "Satoshi-Medium",
    color: LABEL,
  },
  email: {
    fontSize: 12,
    fontFamily: "Satoshi-Regular",
    color: MUTED,
    marginTop: 4,
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
  menuRow: {
    height: 52,
    paddingHorizontal: 20,
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "rgba(255,255,255,0.03)",
    borderBottomWidth: 1,
    borderBottomColor: "rgba(255,255,255,0.04)",
  },
  menuRowWeb: {
    cursor: "pointer" as const,
  },
  menuRowIcon: {
    alignItems: "center",
    justifyContent: "center",
  },
  menuLabel: {
    fontSize: 15,
    fontWeight: "400",
    fontFamily: "Satoshi-Regular",
    color: LABEL,
    marginLeft: 14,
    flex: 1,
  },
  signOutLabel: {
    fontSize: 15,
    fontWeight: "400",
    fontFamily: "Satoshi-Regular",
    color: colors.error,
    marginLeft: 14,
    flex: 1,
  },
  footer: {
    fontSize: 11,
    fontFamily: "Satoshi-Regular",
    color: "rgba(255,255,255,0.15)",
    textAlign: "center",
    marginTop: 40,
    marginBottom: 20,
  },
});
