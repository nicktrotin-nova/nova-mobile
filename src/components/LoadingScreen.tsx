import { View, ActivityIndicator, StyleSheet } from "react-native";
import { BG, NOVA_GREEN } from "../theme/colors";

export default function LoadingScreen() {
  return (
    <View style={styles.wrap}>
      <ActivityIndicator color={NOVA_GREEN} size="large" />
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    backgroundColor: BG,
  },
});
