import React, { useCallback } from "react";
import {
  View,
  Text,
  ScrollView,
  TouchableOpacity,
  Image,
  StyleSheet,
} from "react-native";
import * as Haptics from "expo-haptics";
import { colors } from "../../theme/colors";
import type { Barber } from "../../types/domain";

const COLORS = {
  novaGold: colors.nova500,
  deep: colors.obsidian900,
  slate: colors.textTertiary,
};

interface TeamStripProps {
  barbers: Barber[];
  selectedBarberId: string | null;
  onSelectBarber: (id: string) => void;
  scrollRef?: React.RefObject<ScrollView | null>;
}

function firstName(b: Barber): string {
  const raw = b.display_name?.trim() || b.name.trim();
  return raw.split(/\s+/)[0] || raw;
}

function initialLetter(b: Barber): string {
  const raw = b.display_name?.trim() || b.name.trim();
  return (raw[0] || "?").toUpperCase();
}

function TeamStrip({ barbers, selectedBarberId, onSelectBarber, scrollRef }: TeamStripProps) {
  const handlePress = useCallback(
    (id: string) => {
      onSelectBarber(id);
      Haptics.selectionAsync();
    },
    [onSelectBarber],
  );

  return (
    <ScrollView
      ref={scrollRef}
      horizontal
      showsHorizontalScrollIndicator={false}
      contentContainerStyle={styles.content}
      style={styles.strip}
    >
      {barbers.map((b) => {
        const active = b.id === selectedBarberId;
        return (
          <TouchableOpacity
            key={b.id}
            style={styles.item}
            onPress={() => handlePress(b.id)}
            activeOpacity={0.85}
          >
            <View
              style={[
                styles.avatarRing,
                active ? styles.avatarRingActive : styles.avatarRingIdle,
              ]}
            >
              {b.avatar_url ? (
                <Image
                  source={{ uri: b.avatar_url }}
                  style={styles.avatarImg}
                />
              ) : (
                <View style={styles.avatarFallback}>
                  <Text style={styles.avatarFallbackText}>
                    {initialLetter(b)}
                  </Text>
                </View>
              )}
            </View>
            <Text
              style={[
                styles.name,
                active ? styles.nameActive : styles.nameIdle,
              ]}
              numberOfLines={1}
            >
              {firstName(b)}
            </Text>
          </TouchableOpacity>
        );
      })}
    </ScrollView>
  );
}

export default React.memo(TeamStrip);

const styles = StyleSheet.create({
  strip: {
    backgroundColor: COLORS.deep,
    maxHeight: 98,
    flexGrow: 0,
    flexShrink: 0,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.warmWhite06,
  },
  content: {
    flexDirection: "row",
    alignItems: "flex-start",
    paddingTop: 8,
    paddingBottom: 10,
    paddingHorizontal: 14,
    gap: 16,
  },
  item: {
    alignItems: "center",
    width: 68,
  },
  avatarRing: {
    width: 62,
    height: 62,
    borderRadius: 31,
    overflow: "hidden",
    alignItems: "center",
    justifyContent: "center",
  },
  avatarRingActive: {
    borderWidth: 3,
    borderColor: COLORS.novaGold,
    shadowColor: COLORS.novaGold,
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.25,
    shadowRadius: 8,
    elevation: 6,
  },
  avatarRingIdle: {
    borderWidth: 1.5,
    borderColor: colors.warmWhite10,
  },
  avatarImg: {
    width: 62,
    height: 62,
    borderRadius: 31,
  },
  avatarFallback: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: colors.obsidian600,
    alignItems: "center",
    justifyContent: "center",
  },
  avatarFallbackText: {
    fontSize: 18,
    fontWeight: "600",
    fontFamily: "Satoshi-Bold",
    color: colors.textPrimary,
  },
  name: {
    marginTop: 6,
    fontSize: 11,
    textAlign: "center",
    maxWidth: 62,
  },
  nameActive: {
    fontWeight: "600",
    fontFamily: "Satoshi-Bold",
    color: colors.textPrimary,
  },
  nameIdle: {
    fontWeight: "400",
    fontFamily: "Satoshi-Regular",
    color: COLORS.slate,
  },
});
