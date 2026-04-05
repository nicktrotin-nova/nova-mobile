import React, { useMemo } from "react";
import { View } from "react-native";
import Svg, { Line } from "react-native-svg";

interface Props {
  width: number;
  height: number;
}

/**
 * Diagonal barber-pole stripes for unavailable calendar zones.
 */
const STRIPE_WIDTH = 7;
// At 45°, perpendicular distance = offset / √2. For equal bands: offset = 2 × width × √2
const STRIPE_SPACING = STRIPE_WIDTH * 2 * Math.SQRT2;

export default function BarberPoleStripes({ width, height }: Props) {
  const lines = useMemo(() => {
    if (width <= 0 || height <= 0) return [];
    const result: { x1: number; y1: number; x2: number; y2: number }[] = [];
    const start = -height;
    const end = width + height;
    for (let offset = start; offset <= end; offset += STRIPE_SPACING) {
      result.push({
        x1: offset,
        y1: 0,
        x2: offset - height,
        y2: height,
      });
    }
    return result;
  }, [width, height]);

  if (width <= 0 || height <= 0) return null;

  return (
    <View
      pointerEvents="none"
      style={{
        position: "absolute",
        top: 0,
        left: 0,
        width,
        height,
        overflow: "hidden",
      }}
    >
      <Svg width={width} height={height}>
        {lines.map((l, i) => (
          <Line
            key={i}
            x1={l.x1}
            y1={l.y1}
            x2={l.x2}
            y2={l.y2}
            stroke="rgba(245,243,239,0.045)"
            strokeWidth={STRIPE_WIDTH}
          />
        ))}
      </Svg>
    </View>
  );
}
