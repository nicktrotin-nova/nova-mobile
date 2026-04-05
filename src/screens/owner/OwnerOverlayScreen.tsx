import { useEffect, useState } from "react";
import { View, Text, TouchableOpacity, StyleSheet } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { X } from "lucide-react-native";
import { useNavigation } from "@react-navigation/native";
import OwnerGlanceScreen from "./OwnerGlanceScreen";
import { colors } from "../../theme/colors";
import { useAuth } from "../../contexts/AuthContext";
import { supabase } from "../../lib/supabase";

export default function OwnerOverlayScreen() {
  const navigation = useNavigation();
  const { shopId } = useAuth();
  const [shopName, setShopName] = useState("My Shop");

  useEffect(() => {
    if (!shopId) return;
    let cancelled = false;

    (async () => {
      const { data } = await supabase
        .from("shops")
        .select("name")
        .eq("id", shopId)
        .maybeSingle();

      if (cancelled) return;
      if (data?.name?.trim()) {
        setShopName(data.name);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [shopId]);

  return (
    <SafeAreaView style={styles.safe}>
      <View style={styles.handleWrap}>
        <View style={styles.handle} />
      </View>

      <View style={styles.header}>
        <Text style={styles.title} numberOfLines={1}>
          {shopName}
        </Text>
        <TouchableOpacity
          onPress={() => navigation.goBack()}
          activeOpacity={0.8}
          style={styles.closeBtn}
          hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
        >
          <View pointerEvents="none">
            <X size={24} color={colors.textTertiary} strokeWidth={2.2} />
          </View>
        </TouchableOpacity>
      </View>

      <View style={styles.content}>
        <OwnerGlanceScreen />
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: {
    flex: 1,
    backgroundColor: colors.obsidian950,
  },
  handleWrap: {
    alignItems: "center",
    paddingTop: 8,
  },
  handle: {
    width: 40,
    height: 4,
    borderRadius: 2,
    backgroundColor: colors.white30,
  },
  header: {
    paddingHorizontal: 16,
    paddingBottom: 12,
    paddingTop: 12,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  title: {
    flex: 1,
    marginRight: 12,
    color: colors.textPrimary,
    fontSize: 20,
    fontWeight: "600",
    fontFamily: "Satoshi-Medium",
  },
  closeBtn: {
    width: 28,
    height: 28,
    alignItems: "center",
    justifyContent: "center",
  },
  content: {
    flex: 1,
  },
});
