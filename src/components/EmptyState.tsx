import { View, Text, StyleSheet } from "react-native";
import { LABEL, MUTED } from "../theme/colors";

interface EmptyStateProps {
  icon: React.ReactNode;
  title: string;
  subtitle?: string;
}

export default function EmptyState({ icon, title, subtitle }: EmptyStateProps) {
  return (
    <View style={styles.wrap}>
      <View pointerEvents="none">{icon}</View>
      <Text style={styles.title}>{title}</Text>
      {subtitle ? <Text style={styles.sub}>{subtitle}</Text> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 32,
  },
  title: {
    marginTop: 12,
    fontSize: 17,
    fontWeight: "600",
    fontFamily: "Satoshi-Medium",
    color: LABEL,
  },
  sub: {
    marginTop: 6,
    fontSize: 14,
    fontFamily: "Satoshi-Regular",
    color: MUTED,
    textAlign: "center",
  },
});
