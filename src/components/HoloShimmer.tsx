import { useEffect, useRef } from "react";
import { Animated, StyleSheet, Easing } from "react-native";
import { LinearGradient } from "expo-linear-gradient";
import { colors } from "../theme/colors";

interface HoloShimmerProps {
  width: number;
  height: number;
}

/**
 * Holographic shimmer overlay for the Wallet hero card.
 * A slow-moving diagonal gradient that catches light like a holofoil card.
 * Barely perceptible at rest, alive on movement.
 */
export default function HoloShimmer({ width, height }: HoloShimmerProps) {
  const translateX = useRef(new Animated.Value(-width)).current;

  useEffect(() => {
    if (width === 0) return;

    // Pendulum sweep — back and forth, no visible reset
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(translateX, {
          toValue: width,
          duration: 8000,
          easing: Easing.inOut(Easing.ease),
          useNativeDriver: true,
        }),
        Animated.delay(2000),
        Animated.timing(translateX, {
          toValue: -width,
          duration: 8000,
          easing: Easing.inOut(Easing.ease),
          useNativeDriver: true,
        }),
        Animated.delay(2000),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [width, translateX]);

  if (width === 0 || height === 0) return null;

  return (
    <Animated.View
      style={[
        styles.shimmer,
        {
          width: width * 1.5,
          height: height * 2,
          transform: [
            { translateX },
            { rotate: "-25deg" },
          ],
        },
      ]}
      pointerEvents="none"
    >
      <LinearGradient
        colors={[
          "transparent",
          colors.white03,
          colors.nova06,
          colors.purple04,
          colors.white03,
          "transparent",
        ]}
        start={{ x: 0, y: 0.5 }}
        end={{ x: 1, y: 0.5 }}
        style={StyleSheet.absoluteFill}
      />
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  shimmer: {
    position: "absolute",
    top: "-50%",
    left: 0,
    overflow: "hidden",
  },
});
