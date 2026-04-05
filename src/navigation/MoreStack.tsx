import { createNativeStackNavigator } from "@react-navigation/native-stack";
import MoreScreen from "../screens/MoreScreen";
import MyServicesScreen from "../screens/MyServicesScreen";
import MyScheduleScreen from "../screens/MyScheduleScreen";
import MyProfileScreen from "../screens/MyProfileScreen";
import BookingLinkScreen from "../screens/BookingLinkScreen";
import CalendarSettingsScreen from "../screens/CalendarSettingsScreen";
import NotificationsScreen from "../screens/NotificationsScreen";
import ClientsScreen from "../screens/ClientsScreen";
import StripeOnboardingScreen from "../screens/StripeOnboardingScreen";

export type MoreStackParamList = {
  MoreMenu: undefined;
  MyServices: undefined;
  MySchedule: undefined;
  Clients: undefined;
  MyProfile: undefined;
  BookingLink: undefined;
  CalendarSettings: undefined;
  Notifications: undefined;
  StripeOnboarding: undefined;
};

const Stack = createNativeStackNavigator<MoreStackParamList>();

export default function MoreStack() {
  return (
    <Stack.Navigator screenOptions={{ headerShown: false }}>
      <Stack.Screen name="MoreMenu" component={MoreScreen} />
      <Stack.Screen name="MySchedule" component={MyScheduleScreen} />
      <Stack.Screen name="MyServices" component={MyServicesScreen} />
      <Stack.Screen name="Clients" component={ClientsScreen} />
      <Stack.Screen name="MyProfile" component={MyProfileScreen} />
      <Stack.Screen name="BookingLink" component={BookingLinkScreen} />
      <Stack.Screen name="CalendarSettings" component={CalendarSettingsScreen} />
      <Stack.Screen name="Notifications" component={NotificationsScreen} />
      <Stack.Screen name="StripeOnboarding" component={StripeOnboardingScreen} />
    </Stack.Navigator>
  );
}
