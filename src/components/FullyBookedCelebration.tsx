import { useEffect, useRef, useMemo } from "react";
import {
  View,
  Text,
  Animated,
  Easing,
  StyleSheet,
  Dimensions,
  TouchableOpacity,
  Share,
} from "react-native";
import { captureRef } from "react-native-view-shot";
import { LinearGradient } from "expo-linear-gradient";
import { Share2 } from "lucide-react-native";
import * as Haptics from "expo-haptics";
import { colors } from "../theme/colors";

const { width: SCREEN_W, height: SCREEN_H } = Dimensions.get("window");
const DIAG = Math.sqrt(SCREEN_W * SCREEN_W + SCREEN_H * SCREEN_H);
const GRAD_SIZE = DIAG * 1.5;

const RAINBOW = [
  "#FF0000",
  "#FF8800",
  "#FFDD00",
  "#00D68F",
  "#00AAFF",
  "#8844FF",
  "#FF44AA",
] as const;

// ── EMOJI FOUNTAIN — 48 particles, relentless ─────────────────────────────
const BURST_EMOJIS = ["⭐", "🔥", "💈", "👑", "✨", "💪", "🏆", "⚡", "💰", "🎯", "🌟", "💎", "🫡", "💇", "🪒", "🍄", "🍌", "🐢", "🎮"];
const EMOJI_COUNT = 48;

function generateEmojis(count: number) {
  const out: {
    emoji: string;
    // Spawn origin offset from center
    originX: number;
    originY: number;
    // Flight vector
    angle: number;
    distance: number;
    size: number;
    // Timing — staggered so they never all sync
    initialDelay: number;
    flightDuration: number;
    fadeDuration: number;
    restDelay: number;
  }[] = [];
  for (let i = 0; i < count; i++) {
    const angle = (i / count) * Math.PI * 2 + ((i * 7) % 11) * 0.15;
    out.push({
      emoji: BURST_EMOJIS[i % BURST_EMOJIS.length],
      originX: ((i * 31) % 60) - 30, // spawn jitter ±30px from center
      originY: ((i * 17) % 40) - 20,
      angle,
      distance: 100 + ((i * 37) % 200), // 100–300px travel
      size: 16 + (i % 6) * 5, // 16–41px
      initialDelay: (i % 12) * 80, // first wave staggers over ~1s
      flightDuration: 500 + ((i * 13) % 400), // 500–900ms
      fadeDuration: 400 + ((i * 19) % 300),
      restDelay: 100 + ((i * 23) % 500), // 100–600ms pause before respawn
    });
  }
  return out;
}

// ── GLITTER — 60 tiny sparkle particles ────────────────────────────────────
const GLITTER_COUNT = 60;
const GLITTER_CHARS = ["✦", "✧", "·", "⋆", "✶", "•"];
const GLITTER_COLORS = ["#FFFFFF", "#FFD700", "#00D68F", "#FF88CC", "#88DDFF", "#FFAA00"];

function generateGlitter(count: number) {
  const out: {
    char: string;
    color: string;
    x: number;
    y: number;
    size: number;
    delay: number;
    cycleDuration: number;
  }[] = [];
  for (let i = 0; i < count; i++) {
    out.push({
      char: GLITTER_CHARS[i % GLITTER_CHARS.length],
      color: GLITTER_COLORS[i % GLITTER_COLORS.length],
      x: (i * 137.508) % 100, // golden angle scatter
      y: (i * 97.31 + 11) % 100,
      size: 6 + (i % 8) * 3, // 6–27px
      delay: (i % 15) * 70, // stagger over ~1s
      cycleDuration: 400 + ((i * 29) % 600), // 400–1000ms per twinkle
    });
  }
  return out;
}

interface Props {
  visible: boolean;
  mode?: "auto" | "badge";
  /** Ref to the parent screen view — captured as the share image */
  screenCaptureRef?: React.RefObject<View | null>;
  onFinished?: () => void;
}

export default function FullyBookedCelebration({ visible, mode = "auto", screenCaptureRef, onFinished }: Props) {
  const fadeAnim = useRef(new Animated.Value(0)).current;
  const rainbowShift = useRef(new Animated.Value(0)).current;
  const textScale = useRef(new Animated.Value(0)).current;
  const shareScale = useRef(new Animated.Value(0)).current;

  const emojis = useMemo(() => generateEmojis(EMOJI_COUNT), []);
  const emojiAnims = useRef(emojis.map(() => new Animated.Value(0))).current;

  const glitter = useMemo(() => generateGlitter(GLITTER_COUNT), []);
  const glitterAnims = useRef(glitter.map(() => new Animated.Value(0))).current;

  const hapticIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const stopAll = () => {
    emojiAnims.forEach((a) => a.stopAnimation());
    glitterAnims.forEach((a) => a.stopAnimation());
    rainbowShift.stopAnimation();
    fadeAnim.stopAnimation();
    textScale.stopAnimation();
    shareScale.stopAnimation();
    if (hapticIntervalRef.current) {
      clearInterval(hapticIntervalRef.current);
      hapticIntervalRef.current = null;
    }
  };

  useEffect(() => {
    if (!visible) {
      stopAll();
      return;
    }

    // Reset
    fadeAnim.setValue(0);
    rainbowShift.setValue(0);
    textScale.setValue(0);
    shareScale.setValue(0);
    emojiAnims.forEach((a) => a.setValue(0));
    glitterAnims.forEach((a) => a.setValue(0));

    // Haptic opening salvo
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    setTimeout(() => Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy), 100);
    setTimeout(() => Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy), 200);
    setTimeout(() => Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium), 350);
    setTimeout(() => Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light), 500);

    // Continuous haptic rumble — random mix of light/medium/rigid every 150–350ms
    const hapticStyles = [
      Haptics.ImpactFeedbackStyle.Light,
      Haptics.ImpactFeedbackStyle.Medium,
      Haptics.ImpactFeedbackStyle.Rigid,
      Haptics.ImpactFeedbackStyle.Light,
      Haptics.ImpactFeedbackStyle.Light, // weighted toward light so it doesn't numb
    ];
    let hapticIdx = 0;
    const hapticLoop = setInterval(() => {
      Haptics.impactAsync(hapticStyles[hapticIdx % hapticStyles.length]);
      hapticIdx++;
    }, 200 + Math.floor(Math.random() * 150));
    // Store for cleanup
    hapticIntervalRef.current = hapticLoop;

    // Fade in
    Animated.timing(fadeAnim, {
      toValue: 1,
      duration: 300,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: true,
    }).start();

    // Rainbow — fast spin
    Animated.loop(
      Animated.timing(rainbowShift, {
        toValue: 1,
        duration: 800,
        easing: Easing.linear,
        useNativeDriver: false,
      }),
    ).start();

    // ── EMOJI FOUNTAIN — each particle loops independently ──
    emojiAnims.forEach((anim, i) => {
      const e = emojis[i];
      Animated.loop(
        Animated.sequence([
          Animated.delay(e.initialDelay),
          // Explode out
          Animated.timing(anim, {
            toValue: 1,
            duration: e.flightDuration,
            easing: Easing.out(Easing.cubic),
            useNativeDriver: true,
          }),
          // Fade out
          Animated.timing(anim, {
            toValue: 2,
            duration: e.fadeDuration,
            easing: Easing.in(Easing.quad),
            useNativeDriver: true,
          }),
          // Reset + rest
          Animated.timing(anim, { toValue: 0, duration: 0, useNativeDriver: true }),
          Animated.delay(e.restDelay),
        ]),
      ).start();
    });

    // ── GLITTER — rapid twinkle loops ──
    glitterAnims.forEach((anim, i) => {
      const g = glitter[i];
      Animated.loop(
        Animated.sequence([
          Animated.delay(g.delay),
          // Flash in
          Animated.timing(anim, {
            toValue: 1,
            duration: g.cycleDuration * 0.3,
            easing: Easing.out(Easing.quad),
            useNativeDriver: true,
          }),
          // Hold briefly
          Animated.delay(g.cycleDuration * 0.2),
          // Fade out
          Animated.timing(anim, {
            toValue: 0,
            duration: g.cycleDuration * 0.5,
            easing: Easing.in(Easing.cubic),
            useNativeDriver: true,
          }),
          Animated.delay(200 + (i % 6) * 100),
        ]),
      ).start();
    });

    // Text punch-in
    Animated.spring(textScale, {
      toValue: 1,
      friction: 4,
      tension: 200,
      delay: 250,
      useNativeDriver: true,
    }).start();

    // Share button fade-in
    Animated.timing(shareScale, {
      toValue: 1,
      duration: 400,
      delay: mode === "badge" ? 600 : 800,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: true,
    }).start();

    // Auto mode: dismiss
    let timer: ReturnType<typeof setTimeout> | null = null;
    if (mode === "auto") {
      timer = setTimeout(() => {
        Animated.timing(fadeAnim, {
          toValue: 0,
          duration: 600,
          easing: Easing.in(Easing.cubic),
          useNativeDriver: true,
        }).start(() => {
          stopAll();
          onFinished?.();
        });
      }, 3500);
    }

    return () => {
      if (timer) clearTimeout(timer);
      stopAll();
    };
  }, [visible]);

  if (!visible) return null;

  const gradientRotation = rainbowShift.interpolate({
    inputRange: [0, 1],
    outputRange: ["0deg", "360deg"],
  });

  const dismiss = () => {
    Animated.timing(fadeAnim, {
      toValue: 0,
      duration: 400,
      easing: Easing.in(Easing.cubic),
      useNativeDriver: true,
    }).start(() => {
      stopAll();
      onFinished?.();
    });
  };

  const handleShare = async () => {
    const ref = screenCaptureRef;
    if (!ref?.current) return;
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    try {
      const uri = await captureRef(ref, {
        format: "png",
        quality: 1,
        result: "tmpfile",
      });
      await Share.share({ url: uri });
    } catch {
      // user cancelled or capture failed
    }
  };

  return (
    <Animated.View
      pointerEvents="auto"
      style={[styles.overlay, { opacity: fadeAnim }]}
    >
      {/* Tap anywhere to dismiss */}
      <TouchableOpacity
        style={StyleSheet.absoluteFill}
        activeOpacity={1}
        onPress={dismiss}
      />

      {/* Rainbow gradient — fast rotating */}
      <Animated.View
        pointerEvents="none"
        style={[
          styles.gradientWrap,
          {
            width: GRAD_SIZE,
            height: GRAD_SIZE,
            borderRadius: GRAD_SIZE / 2,
            marginLeft: -GRAD_SIZE / 2,
            marginTop: -GRAD_SIZE / 2,
            transform: [{ rotate: gradientRotation }],
          },
        ]}
      >
        <LinearGradient
          colors={RAINBOW}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 1 }}
          style={styles.gradient}
        />
      </Animated.View>

      {/* GLITTER — tiny sparkles everywhere */}
      {glitter.map((g, i) => (
        <Animated.View
          key={`g-${i}`}
          pointerEvents="none"
          style={[
            styles.glitterDot,
            {
              left: `${g.x}%`,
              top: `${g.y}%`,
              opacity: glitterAnims[i],
              transform: [
                {
                  scale: glitterAnims[i].interpolate({
                    inputRange: [0, 1],
                    outputRange: [0.3, 1.3],
                  }),
                },
              ],
            },
          ]}
        >
          <Text
            style={{
              fontSize: g.size,
              color: g.color,
              textShadowColor: g.color,
              textShadowOffset: { width: 0, height: 0 },
              textShadowRadius: g.size > 15 ? 12 : 6,
            }}
          >
            {g.char}
          </Text>
        </Animated.View>
      ))}

      {/* EMOJI FOUNTAIN — relentless spawn from center */}
      {emojis.map((e, i) => {
        const dx = Math.cos(e.angle) * e.distance;
        const dy = Math.sin(e.angle) * e.distance;
        return (
          <Animated.View
            key={`e-${i}`}
            pointerEvents="none"
            style={[
              styles.emojiParticle,
              {
                left: SCREEN_W / 2 - 12 + e.originX,
                top: SCREEN_H / 2 - 12 + e.originY,
                opacity: emojiAnims[i].interpolate({
                  inputRange: [0, 0.2, 1, 1.5, 2],
                  outputRange: [0, 1, 1, 0.4, 0],
                }),
                transform: [
                  {
                    translateX: emojiAnims[i].interpolate({
                      inputRange: [0, 1, 2],
                      outputRange: [0, dx, dx * 1.2],
                    }),
                  },
                  {
                    translateY: emojiAnims[i].interpolate({
                      inputRange: [0, 1, 2],
                      outputRange: [0, dy, dy * 1.2 + 40],
                    }),
                  },
                  {
                    scale: emojiAnims[i].interpolate({
                      inputRange: [0, 0.3, 1, 2],
                      outputRange: [0.1, 1.3, 1, 0.5],
                    }),
                  },
                  {
                    rotate: emojiAnims[i].interpolate({
                      inputRange: [0, 2],
                      outputRange: ["0deg", `${(i % 2 === 0 ? 1 : -1) * (20 + (i % 5) * 15)}deg`],
                    }),
                  },
                ],
              },
            ]}
          >
            <Text style={{ fontSize: e.size }}>{e.emoji}</Text>
          </Animated.View>
        );
      })}

      {/* Toast */}
      <Animated.View
        pointerEvents="none"
        style={[
          styles.toastContainer,
          {
            transform: [
              {
                scale: textScale.interpolate({
                  inputRange: [0, 1],
                  outputRange: [0.3, 1],
                }),
              },
            ],
            opacity: textScale,
          },
        ]}
      >
        <Text style={styles.toastEmoji}>⭐</Text>
        <Text style={styles.toastTitle}>FULLY BOOKED</Text>
        <Text style={styles.toastSub}>Every slot filled. Legend.</Text>
      </Animated.View>

      {/* Share — both modes */}
      <Animated.View
        pointerEvents="auto"
        style={[
          styles.shareWrap,
          {
            opacity: shareScale,
            transform: [
              {
                translateY: shareScale.interpolate({
                  inputRange: [0, 1],
                  outputRange: [20, 0],
                }),
              },
            ],
          },
        ]}
      >
        <TouchableOpacity
          style={styles.shareBtn}
          activeOpacity={0.8}
          onPress={handleShare}
        >
          <View pointerEvents="none">
            <Share2 size={18} color="#00D68F" strokeWidth={2.5} />
          </View>
          <Text style={styles.shareBtnText}>Share</Text>
        </TouchableOpacity>
      </Animated.View>

    </Animated.View>
  );
}

// ── Rainbow paper shimmer for calendar background ──────────────────────────
export function RainbowPaperOverlay() {
  const shift = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    const loop = Animated.loop(
      Animated.timing(shift, {
        toValue: 1,
        duration: 3000,
        easing: Easing.linear,
        useNativeDriver: false,
      }),
    );
    loop.start();
    return () => loop.stop();
  }, []);

  const rotation = shift.interpolate({
    inputRange: [0, 1],
    outputRange: ["0deg", "360deg"],
  });

  return (
    <Animated.View
      pointerEvents="none"
      style={[
        rpStyles.wrap,
        {
          width: GRAD_SIZE,
          height: GRAD_SIZE,
          borderRadius: GRAD_SIZE / 2,
          marginLeft: -GRAD_SIZE / 2,
          marginTop: -GRAD_SIZE / 2,
          transform: [{ rotate: rotation }],
        },
      ]}
    >
      <LinearGradient
        colors={RAINBOW}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
        style={rpStyles.gradient}
      />
    </Animated.View>
  );
}

const rpStyles = StyleSheet.create({
  wrap: {
    position: "absolute",
    left: "50%",
    top: "50%",
    opacity: 0.07,
    overflow: "hidden",
  },
  gradient: {
    flex: 1,
  },
});

const styles = StyleSheet.create({
  overlay: {
    ...StyleSheet.absoluteFillObject,
    zIndex: 999,
    alignItems: "center",
    justifyContent: "center",
    overflow: "hidden",
  },
  gradientWrap: {
    position: "absolute",
    left: "50%",
    top: "50%",
    opacity: 0.22,
    overflow: "hidden",
  },
  gradient: {
    flex: 1,
  },
  emojiParticle: {
    position: "absolute",
  },
  glitterDot: {
    position: "absolute",
  },
  toastContainer: {
    backgroundColor: colors.canvas92,
    paddingHorizontal: 36,
    paddingVertical: 24,
    borderRadius: 20,
    alignItems: "center",
    borderWidth: 1,
    borderColor: colors.nova30,
    shadowColor: "#00D68F",
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.4,
    shadowRadius: 24,
    elevation: 20,
  },
  toastEmoji: {
    fontSize: 36,
    marginBottom: 8,
  },
  toastTitle: {
    fontFamily: "DMSerifText-Regular",
    fontSize: 32,
    color: "#00D68F",
    letterSpacing: 2,
    textAlign: "center",
  },
  toastSub: {
    fontFamily: "Satoshi-Medium",
    fontSize: 15,
    color: colors.warmWhite65,
    marginTop: 6,
    textAlign: "center",
  },
  shareWrap: {
    marginTop: 20,
    zIndex: 10,
  },
  shareBtn: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: colors.canvas85,
    paddingHorizontal: 24,
    paddingVertical: 14,
    borderRadius: 16,
    gap: 8,
    borderWidth: 1,
    borderColor: colors.nova20,
  },
  shareBtnText: {
    fontFamily: "Satoshi-Medium",
    fontSize: 16,
    color: "#00D68F",
  },
});
