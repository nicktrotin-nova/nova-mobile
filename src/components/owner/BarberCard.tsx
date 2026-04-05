import { useEffect, useRef } from "react";
import {
  View,
  Text,
  Image,
  StyleSheet,
  Animated,
  Easing,
  TouchableOpacity,
} from "react-native";
import { LinearGradient } from "expo-linear-gradient";
import Svg, { Circle, Defs, Pattern, Rect } from "react-native-svg";
import { colors, NOVA_GREEN } from "../../theme/colors";

const AnimatedCircle = Animated.createAnimatedComponent(Circle);

export const CARD_HEIGHT = 136;
export const CARD_GAP    = 12;
export const CARD_TOTAL  = CARD_HEIGHT + CARD_GAP;

// Ring geometry — 3px gap between avatar edge and ring inner edge, 3px stroke
const AVATAR = 92;
const STROKE = 3;
const R      = AVATAR / 2 + 3 + STROKE / 2;   // 46 + 3 + 1.5 = 50.5
const RING   = Math.ceil(R * 2 + STROKE);       // 104
const CIRC   = 2 * Math.PI * R;                 // ~317.3

export interface BarberCardData {
  id: string;
  name: string;
  displayName: string | null;
  avatarUrl: string | null;
  isInToday: boolean;
  statusLabel: string;
  startTime: string | null;
  todayRevenue: number;
  weekRevenue: number;
  occupancyPct: number;
  rentPct: number;
  nextApptTime?: string | null;
  nextInLabel?: string | null;
  stripeReady?: boolean;
}

interface Props {
  data: BarberCardData;
  onPress?: () => void;
}

function fmtMoney(v: number): string {
  const r = Math.round(v);
  return "$" + r.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ",");
}

// Staggered dot grain — reads as micro-texture, invisible at arm's length
function GrainOverlay() {
  return (
    <View pointerEvents="none" style={StyleSheet.absoluteFill}>
      <Svg width="100%" height="100%" style={StyleSheet.absoluteFill}>
        <Defs>
          <Pattern
            id="cardgrain"
            x="0" y="0"
            width="4" height="4"
            patternUnits="userSpaceOnUse"
          >
            {/* Three offset dots per tile — denser, reads as visible grain */}
            <Rect x="0" y="0" width="1" height="1" fill="white" fillOpacity="0.055" />
            <Rect x="2" y="2" width="1" height="1" fill="white" fillOpacity="0.04" />
            <Rect x="3" y="1" width="1" height="1" fill="white" fillOpacity="0.025" />
          </Pattern>
        </Defs>
        <Rect x="0" y="0" width="100%" height="100%" fill="url(#cardgrain)" />
      </Svg>
    </View>
  );
}

export default function BarberCard({ data, onPress }: Props) {
  const ringAnim = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    Animated.timing(ringAnim, {
      toValue: data.rentPct,
      duration: 800,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: false,
    }).start();
  }, []);

  const strokeDashoffset = ringAnim.interpolate({
    inputRange: [0, 1],
    outputRange: [CIRC, 0],
  });

  const rawName = data.displayName?.trim() || data.name.trim();
  const displayName = rawName.split(/\s+/)[0] || "?";
  const initial = displayName[0].toUpperCase();

  const ringColor = NOVA_GREEN;

  const occPct = Math.round(data.occupancyPct * 100);

  const Wrapper = onPress ? TouchableOpacity : View;
  const wrapperProps = onPress ? { onPress, activeOpacity: 0.85, delayPressIn: 0 } : {};

  return (
    <Wrapper style={styles.wrapper} {...wrapperProps}>
      <LinearGradient
        colors={[colors.obsidian800, colors.obsidian950]}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
        style={[
          styles.card,
          data.isInToday ? styles.cardBorderActive : styles.cardBorderOff,
          !data.isInToday && styles.cardOff,
        ]}
      >
        <GrainOverlay />

        {/* ── LEFT: Portrait + rent ring ─────────────────────── */}
        <View style={styles.portraitWell}>
          <View style={styles.ringContainer}>

            <View style={styles.avatarOuter}>
              {data.avatarUrl ? (
                <Image source={{ uri: data.avatarUrl }} style={styles.avatar} />
              ) : (
                <View style={styles.avatarFallback}>
                  <Text style={styles.avatarInitial}>{initial}</Text>
                </View>
              )}
              {/* Holofoil — only perceptible on close inspection */}
              <View style={[StyleSheet.absoluteFill, styles.holoWrap]} pointerEvents="none">
                <LinearGradient
                  colors={[
                    "transparent",
                    "rgba(0,214,143,0.9)",
                    "transparent",
                    "rgba(167,139,250,0.8)",
                    "transparent",
                  ]}
                  locations={[0, 0.28, 0.5, 0.75, 1]}
                  start={{ x: 0.1, y: 0 }}
                  end={{ x: 0.9, y: 1 }}
                  style={StyleSheet.absoluteFill}
                />
              </View>
            </View>

            <Svg
              width={RING}
              height={RING}
              style={StyleSheet.absoluteFill}
              pointerEvents="none"
            >
              <Circle
                cx={RING / 2} cy={RING / 2} r={R}
                stroke="rgba(255,255,255,0.06)"
                strokeWidth={STROKE}
                fill="none"
              />
              {data.rentPct > 0 && (
                <AnimatedCircle
                  cx={RING / 2} cy={RING / 2} r={R}
                  stroke={ringColor}
                  strokeWidth={STROKE}
                  fill="none"
                  strokeDasharray={CIRC}
                  strokeDashoffset={strokeDashoffset as unknown as number}
                  strokeLinecap="round"
                  rotation="-90"
                  origin={`${RING / 2}, ${RING / 2}`}
                />
              )}
            </Svg>

          </View>
        </View>

        {/* Vertical hairline — inset from top and bottom */}
        <View style={styles.divider} />

        {/* ── RIGHT: Data panel ──────────────────────────────── */}
        <View style={styles.dataPanel}>

          <View style={styles.nameRow}>
            <Text style={styles.nameText} numberOfLines={1}>
              {displayName}
            </Text>
            {data.stripeReady === false && (
              <View style={styles.stripeBadge}>
                <View style={styles.stripeDot} />
              </View>
            )}
            {data.startTime ? (
              <Text style={styles.startTimeText}>{data.startTime}</Text>
            ) : null}
          </View>

          <View style={styles.identityDivider} />

          <View style={styles.statsContainer}>

            <View style={[styles.statRow, styles.statRowBorder]}>
              <Text style={styles.statLabel}>TODAY</Text>
              <Text style={[styles.statValue, styles.statGreen]}>
                {fmtMoney(data.todayRevenue)}
              </Text>
            </View>

            <View style={[styles.statRow, styles.statRowBorder]}>
              <Text style={styles.statLabel}>CHAIR</Text>
              <Text style={styles.statValue}>{occPct}%</Text>
            </View>

            <View style={styles.statRow}>
              <Text style={styles.statLabel}>THIS WEEK</Text>
              <Text style={[styles.statValue, styles.statGreen]}>
                {fmtMoney(data.weekRevenue)}
              </Text>
            </View>

          </View>
        </View>
      </LinearGradient>
    </Wrapper>
  );
}

const styles = StyleSheet.create({
  wrapper: {
    marginBottom: CARD_GAP,
  },

  card: {
    height: CARD_HEIGHT,
    flexDirection: "row",
    borderRadius: 16,
    borderWidth: 0.5,
    overflow: "hidden",
  },
  cardBorderActive: { borderColor: "rgba(255,255,255,0.10)" },
  cardBorderOff:    { borderColor: "rgba(255,255,255,0.04)" },
  cardOff:          { opacity: 0.40 },

  portraitWell: {
    width: 128,
    alignItems: "center",
    justifyContent: "center",
  },
  ringContainer: {
    width: RING,    // 104
    height: RING,
    alignItems: "center",
    justifyContent: "center",
  },
  avatarOuter: {
    width: AVATAR,  // 92
    height: AVATAR,
    borderRadius: AVATAR / 2,
    overflow: "hidden",
  },
  avatar: { width: AVATAR, height: AVATAR },
  avatarFallback: {
    width: AVATAR,
    height: AVATAR,
    backgroundColor: colors.obsidian800,
    alignItems: "center",
    justifyContent: "center",
  },
  avatarInitial: {
    fontSize: 30,
    fontWeight: "600",
    fontFamily: "Satoshi-Medium",
    color: colors.textSecondary,
  },
  holoWrap: {
    opacity: 0.07,
  },

  divider: {
    width: 0.5,
    marginTop: 16,
    marginBottom: 16,
    backgroundColor: "rgba(255,255,255,0.06)",
  },

  dataPanel: {
    flex: 1,
    paddingTop: 12,
    paddingRight: 16,
    paddingLeft: 12,
    paddingBottom: 12,
  },
  nameRow: {
    flexDirection: "row",
    alignItems: "baseline",
    justifyContent: "space-between",
    marginBottom: 8,
  },
  nameText: {
    fontSize: 21,
    fontWeight: "600",
    fontFamily: "Satoshi-Medium",
    color: colors.textPrimary,
    flexShrink: 1,
    letterSpacing: -0.4,
  },
  startTimeText: {
    fontSize: 12,
    fontWeight: "500",
    fontFamily: "Satoshi-Medium",
    color: colors.textTertiary,
    marginLeft: 6,
    flexShrink: 0,
  },
  identityDivider: {
    height: 0.5,
    backgroundColor: "rgba(255,255,255,0.06)",
  },

  statsContainer: {
    flex: 1,
    justifyContent: "space-evenly",
  },
  statRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  statRowBorder: {
    borderBottomWidth: 0.5,
    borderBottomColor: "rgba(255,255,255,0.04)",
  },
  statLabel: {
    fontSize: 11,
    fontWeight: "500",
    fontFamily: "Satoshi-Medium",
    color: colors.textTertiary,
    letterSpacing: 0.5,
  },
  statValue: {
    fontSize: 17,
    fontWeight: "600",
    fontFamily: "Satoshi-Medium",
    color: colors.textPrimary,
    fontVariant: ["tabular-nums"],
  },
  statGreen: { color: NOVA_GREEN },

  stripeBadge: {
    marginLeft: 6,
    justifyContent: "center",
  },
  stripeDot: {
    width: 7,
    height: 7,
    borderRadius: 3.5,
    backgroundColor: colors.warning,
  },
});
