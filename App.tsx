import { useEffect, useState } from "react";
import { View, ActivityIndicator, StyleSheet } from "react-native";
import { NavigationContainer } from "@react-navigation/native";
import { createBottomTabNavigator } from "@react-navigation/bottom-tabs";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { StatusBar } from "expo-status-bar";
import { CalendarCheck, Wallet, Calendar, MoreHorizontal } from "lucide-react-native";

import { AuthProvider, useAuth } from "./src/contexts/AuthContext";
import LoginScreen from "./src/screens/LoginScreen";
import MyDayScreen from "./src/screens/MyDayScreen";
import WalletScreen from "./src/screens/WalletScreen";

function CalendarScreen() {
  return <View style={{ flex: 1, backgroundColor: "#0F1923" }} />;
}
function MoreScreen() {
  return <View style={{ flex: 1, backgroundColor: "#0F1923" }} />;
}

const Tab = createBottomTabNavigator();

function AppContent() {
  const { user, loading, barberId, role } = useAuth();

  if (loading) {
    return (
      <View style={styles.loading}>
        <ActivityIndicator color="#00D68F" size="large" />
      </View>
    );
  }

  if (!user || !barberId) {
    return <LoginScreen />;
  }

  return (
    <Tab.Navigator
      screenOptions={{
        headerShown: false,
        tabBarStyle: {
          backgroundColor: "#0A1220",
          borderTopColor: "rgba(255,255,255,0.06)",
          borderTopWidth: 1,
          height: 60,
        },
        tabBarActiveTintColor: "#00D68F",
        tabBarInactiveTintColor: "#7BA7C2",
        tabBarLabelStyle: {
          fontSize: 10,
          fontWeight: "500",
        },
      }}
    >
      <Tab.Screen
        name="MyDay"
        component={MyDayScreen}
        options={{
          tabBarLabel: "My Day",
          tabBarIcon: ({ color, size }) => <CalendarCheck color={color} size={size} />,
        }}
      />
      <Tab.Screen
        name="Wallet"
        component={WalletScreen}
        options={{
          tabBarLabel: "Wallet",
          tabBarIcon: ({ color, size }) => <Wallet color={color} size={size} />,
        }}
      />
      <Tab.Screen
        name="Calendar"
        component={CalendarScreen}
        options={{
          tabBarLabel: "Calendar",
          tabBarIcon: ({ color, size }) => <Calendar color={color} size={size} />,
        }}
      />
      <Tab.Screen
        name="More"
        component={MoreScreen}
        options={{
          tabBarLabel: "More",
          tabBarIcon: ({ color, size }) => <MoreHorizontal color={color} size={size} />,
        }}
      />
    </Tab.Navigator>
  );
}

export default function App() {
  return (
    <SafeAreaProvider>
      <AuthProvider>
        <NavigationContainer>
          <StatusBar style="light" />
          <AppContent />
        </NavigationContainer>
      </AuthProvider>
    </SafeAreaProvider>
  );
}

const styles = StyleSheet.create({
  loading: {
    flex: 1,
    backgroundColor: "#0F1923",
    justifyContent: "center",
    alignItems: "center",
  },
});