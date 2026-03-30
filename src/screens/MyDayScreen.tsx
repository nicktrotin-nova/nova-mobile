import { useState, useEffect, useMemo, useCallback } from "react";
import {
  View,
  Text,
  ScrollView,
  TouchableOpacity,
  StyleSheet,
  ActivityIndicator,
  RefreshControl,
} from "react-native";
import { supabase } from "../lib/supabase";
import { useAuth } from "../contexts/AuthContext";
import { format } from "date-fns";
import { toZonedTime } from "date-fns-tz";
import { Scissors, CreditCard, Banknote, Wallet } from "lucide-react-native";

const DEFAULT_TZ = "Australia/Brisbane";

interface Appointment {
  id: string;
  start_time: string;
  end_time: string;
  status: string;
  notes: string | null;
  price_charged: number | null;
  booking_source: string | null;
  client_name: string | null;
  client_phone: string | null;
  client_email: string | null;
  services: { name: string; duration_minutes: number } | null;
}

function getTimeGreeting(appointmentCount: number, hour: number): string {
  if (hour >= 17) return "Good evening. Almost done.";
  const period = hour < 12 ? "Good morning" : "Good afternoon";
  if (appointmentCount === 0) return `${period}. Nothing booked yet.`;
  if (appointmentCount <= 3) return `${period}. Quiet day ahead.`;
  if (appointmentCount <= 6) return `${period}. Solid day ahead.`;
  return `${period}. Full house today.`;
}

export default function MyDayScreen() {
  const { barberId, shopId } = useAuth();
  const [appointments, setAppointments] = useState<Appointment[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [checkoutId, setCheckoutId] = useState<string | null>(null);
  const [completingMethod, setCompletingMethod] = useState<string | null>(null);
  const [justCompletedId, setJustCompletedId] = useState<string | null>(null);

  const shopNow = toZonedTime(new Date(), DEFAULT_TZ);
  const today = format(shopNow, "yyyy-MM-dd");
  const hour = shopNow.getHours();

  const fetchAppointments = useCallback(async () => {
    if (!barberId) return;
    const { data, error } = await supabase
      .from("appointments")
      .select(`
        id, start_time, end_time, status, notes, price_charged, booking_source,
        client_name, client_phone, client_email,
        services!appointments_service_id_fkey(name, duration_minutes)
      `)
      .eq("barber_id", barberId)
      .eq("appointment_date", today)
      .in("status", ["confirmed", "completed"])
      .order("start_time");
    if (!error && data) {
      setAppointments(data as any);
    }
    setLoading(false);
  }, [barberId, today]);

  useEffect(() => {
    fetchAppointments();
  }, [fetchAppointments]);

  // Realtime subscription
  useEffect(() => {
    if (!barberId) return;
    const channel = supabase
      .channel(`today-${barberId}`)
      .on("postgres_changes", {
        event: "*",
        schema: "public",
        table: "appointments",
        filter: `barber_id=eq.${barberId}`,
      }, () => {
        fetchAppointments();
      })
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [barberId, fetchAppointments]);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await fetchAppointments();
    setRefreshing(false);
  }, [fetchAppointments]);

  const nextUp = useMemo(() => {
    const nowStr = format(shopNow, "HH:mm:ss");
    return appointments.find(
      (a) => a.status === "confirmed" && a.start_time >= nowStr
    );
  }, [appointments, shopNow]);

  const completeAppointment = async (appointmentId: string, method: string) => {
    setCompletingMethod(method);
    const { error } = await supabase
      .from("appointments")
      .update({ status: "completed", payment_method: method })
      .eq("id", appointmentId);
    if (!error) {
      setJustCompletedId(appointmentId);
      setCheckoutId(null);
      setExpandedId(null);
      setTimeout(() => setJustCompletedId(null), 1500);
      fetchAppointments();
    }
    setCompletingMethod(null);
  };

  const confirmedCount = appointments.filter((a) => a.status === "confirmed").length;
  const greeting = getTimeGreeting(confirmedCount, hour);

  if (loading) {
    return (
      <View style={styles.loadingContainer}>
        <ActivityIndicator color="#00D68F" size="large" />
      </View>
    );
  }

  return (
    <View style={styles.container}>
      {/* Greeting */}
      <View style={styles.greetingContainer}>
        <Text style={styles.greeting}>{greeting}</Text>
      </View>

      <ScrollView
        style={styles.scrollView}
        contentContainerStyle={styles.scrollContent}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={onRefresh}
            tintColor="#00D68F"
          />
        }
      >
        {appointments.length === 0 ? (
          <View style={styles.emptyState}>
            <Scissors color="#7BA7C2" size={32} />
            <Text style={styles.emptyTitle}>No appointments today</Text>
            <Text style={styles.emptySubtitle}>Your booking link is live</Text>
          </View>
        ) : (
          appointments.map((apt) => {
            const isNext = nextUp?.id === apt.id;
            const isCompleted = apt.status === "completed";
            const isExpanded = expandedId === apt.id;
            const isCheckout = checkoutId === apt.id;
            const wasJustCompleted = justCompletedId === apt.id;
            const startTime = format(
              new Date(`2000-01-01T${apt.start_time}`),
              "h:mm a"
            );

            return (
              <TouchableOpacity
                key={apt.id}
                onPress={() => {
                  if (isCompleted) return;
                  setExpandedId(isExpanded ? null : apt.id);
                  setCheckoutId(null);
                }}
                activeOpacity={isCompleted ? 1 : 0.7}
                style={[
                  styles.card,
                  isNext && styles.cardNext,
                  isCompleted && styles.cardCompleted,
                  wasJustCompleted && styles.cardJustCompleted,
                ]}
              >
                {/* Main row */}
                <View style={styles.cardRow}>
                  <Text style={[styles.cardTime, isCompleted && styles.textFaded]}>
                    {startTime}
                  </Text>
                  <View style={styles.cardCenter}>
                    <Text
                      style={[styles.cardClient, isCompleted && styles.textFaded]}
                      numberOfLines={1}
                    >
                      {apt.client_name || "Walk-in"}
                    </Text>
                    <Text style={[styles.cardService, isCompleted && styles.textFaded]}>
                      {(apt.services as any)?.name || "Service"}
                    </Text>
                  </View>
                  <Text style={styles.cardPrice}>
                    ${apt.price_charged ?? 0}
                  </Text>
                </View>

                {/* Expanded actions */}
                {isExpanded && !isCompleted && !isCheckout && (
                  <View style={styles.actions}>
                    <TouchableOpacity
                      style={styles.completeButton}
                      onPress={() => setCheckoutId(apt.id)}
                    >
                      <Text style={styles.completeButtonText}>Complete</Text>
                    </TouchableOpacity>
                  </View>
                )}

                {/* Checkout: payment method selection */}
                {isCheckout && (
                  <View style={styles.paymentMethods}>
                    <TouchableOpacity
                      style={styles.paymentButton}
                      onPress={() => completeAppointment(apt.id, "card")}
                      disabled={!!completingMethod}
                    >
                      <CreditCard color="#F8FAFC" size={18} />
                      <Text style={styles.paymentText}>Card</Text>
                    </TouchableOpacity>
                    <TouchableOpacity
                      style={styles.paymentButton}
                      onPress={() => completeAppointment(apt.id, "cash")}
                      disabled={!!completingMethod}
                    >
                      <Banknote color="#F8FAFC" size={18} />
                      <Text style={styles.paymentText}>Cash</Text>
                    </TouchableOpacity>
                    <TouchableOpacity
                      style={styles.paymentButton}
                      onPress={() => completeAppointment(apt.id, "prepaid")}
                      disabled={!!completingMethod}
                    >
                      <Wallet color="#F8FAFC" size={18} />
                      <Text style={styles.paymentText}>Prepaid</Text>
                    </TouchableOpacity>
                    <TouchableOpacity onPress={() => setCheckoutId(null)}>
                      <Text style={styles.backText}>← Back</Text>
                    </TouchableOpacity>
                  </View>
                )}
              </TouchableOpacity>
            );
          })
        )}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#0F1923",
  },
  loadingContainer: {
    flex: 1,
    backgroundColor: "#0F1923",
    justifyContent: "center",
    alignItems: "center",
  },
  greetingContainer: {
    paddingHorizontal: 20,
    paddingTop: 16,
    paddingBottom: 8,
  },
  greeting: {
    fontSize: 14,
    color: "#94A3B8",
  },
  scrollView: {
    flex: 1,
  },
  scrollContent: {
    paddingHorizontal: 16,
    paddingBottom: 100,
  },
  emptyState: {
    alignItems: "center",
    justifyContent: "center",
    paddingTop: 120,
    gap: 12,
  },
  emptyTitle: {
    fontSize: 16,
    fontWeight: "600",
    color: "#F8FAFC",
  },
  emptySubtitle: {
    fontSize: 13,
    color: "#7BA7C2",
  },
  card: {
    backgroundColor: "rgba(255,255,255,0.04)",
    borderRadius: 12,
    padding: 16,
    marginBottom: 8,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.06)",
  },
  cardNext: {
    backgroundColor: "rgba(255,255,255,0.07)",
    borderColor: "rgba(0,214,143,0.15)",
    shadowColor: "#00D68F",
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.18,
    shadowRadius: 16,
  },
  cardCompleted: {
    opacity: 0.5,
  },
  cardJustCompleted: {
    borderColor: "rgba(0,214,143,0.25)",
    shadowColor: "#00D68F",
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.3,
    shadowRadius: 20,
  },
  cardRow: {
    flexDirection: "row",
    alignItems: "center",
  },
  cardTime: {
    fontSize: 13,
    color: "#94A3B8",
    width: 70,
  },
  cardCenter: {
    flex: 1,
    marginHorizontal: 12,
  },
  cardClient: {
    fontSize: 15,
    fontWeight: "600",
    color: "#F8FAFC",
  },
  cardService: {
    fontSize: 12,
    color: "#7BA7C2",
    marginTop: 2,
  },
  cardPrice: {
    fontSize: 15,
    fontWeight: "600",
    color: "#00D68F",
  },
  textFaded: {
    opacity: 0.7,
  },
  actions: {
    marginTop: 12,
    borderTopWidth: 1,
    borderTopColor: "rgba(255,255,255,0.06)",
    paddingTop: 12,
  },
  completeButton: {
    backgroundColor: "#1A2D4A",
    borderRadius: 8,
    paddingVertical: 10,
    alignItems: "center",
  },
  completeButtonText: {
    color: "#F8FAFC",
    fontSize: 14,
    fontWeight: "600",
  },
  paymentMethods: {
    marginTop: 12,
    borderTopWidth: 1,
    borderTopColor: "rgba(255,255,255,0.06)",
    paddingTop: 12,
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  paymentButton: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    backgroundColor: "rgba(255,255,255,0.08)",
    borderRadius: 8,
    paddingVertical: 10,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.1)",
  },
  paymentText: {
    color: "#F8FAFC",
    fontSize: 13,
    fontWeight: "500",
  },
  backText: {
    color: "#7BA7C2",
    fontSize: 13,
    paddingHorizontal: 8,
  },
});
