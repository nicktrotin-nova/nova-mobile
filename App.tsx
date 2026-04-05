import { useEffect, useState, Component, ErrorInfo, ReactNode } from "react";
import { View, Text, ActivityIndicator, StyleSheet, TouchableOpacity } from "react-native";
import { NavigationContainer } from "@react-navigation/native";
import { createBottomTabNavigator } from "@react-navigation/bottom-tabs";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { StatusBar } from "expo-status-bar";
import { Sun, Wallet, Calendar, MoreHorizontal, AlertTriangle } from "lucide-react-native";
import * as Haptics from "expo-haptics";

import { colors } from "./src/theme/colors";
import { AuthProvider, useAuth } from "./src/contexts/AuthContext";
import LoginScreen from "./src/screens/LoginScreen";
import MyDayScreen from "./src/screens/MyDayScreen";
import WalletScreen from "./src/screens/WalletScreen";
import CalendarScreen from "./src/screens/CalendarScreen";
import MoreStack from "./src/navigation/MoreStack";

// --- Error Boundary ---
interface ErrorBoundaryProps {
  children: ReactNode;
}
interface ErrorBoundaryState {
  hasError: boolean;
  error: Error | null;
}

class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  constructor(props: ErrorBoundaryProps) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error("Nova ErrorBoundary caught:", error, info.componentStack);
  }

  handleRestart = () => {
    this.setState({ hasError: false, error: null });
  };

  render() {
    if (this.state.hasError) {
      return (
        <View style={errorStyles.container}>
          <View pointerEvents="none">
            <AlertTriangle color="#00D68F" size={48} />
          </View>
          <Text style={errorStyles.title}>Something went wrong</Text>
          <Text style={errorStyles.message}>
            {this.state.error?.message || "An unexpected error occurred."}
          </Text>
          <TouchableOpacity style={errorStyles.button} onPress={this.handleRestart}>
            <Text style={errorStyles.buttonText}>Restart</Text>
          </TouchableOpacity>
        </View>
      );
    }
    return this.props.children;
  }
}

const errorStyles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#131518",
    justifyContent: "center",
    alignItems: "center",
    paddingHorizontal: 32,
  },
  title: {
    fontFamily: "Satoshi-Bold",
    fontSize: 20,
    color: "#F5F3EF",
    marginTop: 20,
    marginBottom: 8,
  },
  message: {
    fontFamily: "Satoshi-Regular",
    fontSize: 14,
    color: colors.warmWhite40,
    textAlign: "center",
    marginBottom: 32,
    lineHeight: 20,
  },
  button: {
    backgroundColor: "#00D68F",
    borderRadius: 10,
    paddingVertical: 14,
    paddingHorizontal: 40,
  },
  buttonText: {
    fontFamily: "Satoshi-Bold",
    fontSize: 15,
    color: "#131518",
  },
});

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

  const renderTabLabel = (label: string) => ({ focused, color }: { focused: boolean; color: string }) => (
    <Text
      style={{
        fontSize: 11,
        fontFamily: focused ? "Satoshi-Bold" : "Satoshi-Regular",
        color,
      }}
    >
      {label}
    </Text>
  );

  return (
    <Tab.Navigator
      screenOptions={{
        headerShown: false,
        animation: "fade",
        tabBarStyle: {
          backgroundColor: "#131518",
          borderTopWidth: 0,
          height: 75,
          paddingBottom: 8,
        },
        tabBarActiveTintColor: "#00D68F",
        tabBarInactiveTintColor: colors.warmWhite40,
      }}
      screenListeners={{
        tabPress: () => {
          Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
        },
      }}
    >
      <Tab.Screen
        name="MyDay"
        component={MyDayScreen}
        options={{
          tabBarLabel: renderTabLabel("My Day"),
          tabBarIcon: ({ color, size }) => <Sun color={color} size={size} />,
        }}
      />
      <Tab.Screen
        name="Wallet"
        component={WalletScreen}
        options={{
          tabBarLabel: renderTabLabel("Wallet"),
          tabBarIcon: ({ color, size }) => <Wallet color={color} size={size} />,
        }}
      />
      <Tab.Screen
        name="Calendar"
        component={CalendarScreen}
        options={{
          tabBarLabel: renderTabLabel("Calendar"),
          tabBarIcon: ({ color, size }) => <Calendar color={color} size={size} />,
        }}
      />
      <Tab.Screen
        name="More"
        component={MoreStack}
        options={{
          tabBarLabel: renderTabLabel("More"),
          tabBarIcon: ({ color, size }) => <MoreHorizontal color={color} size={size} />,
        }}
      />
    </Tab.Navigator>
  );
}

export default function App() {
  return (
    <SafeAreaProvider>
      <ErrorBoundary>
        <AuthProvider>
          <NavigationContainer>
            <StatusBar style="light" />
            <AppContent />
          </NavigationContainer>
        </AuthProvider>
      </ErrorBoundary>
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