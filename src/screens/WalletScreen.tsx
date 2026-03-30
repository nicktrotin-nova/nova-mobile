import { useState, useEffect, useMemo, useCallback } from "react";
import {
  View,
  Text,
  ScrollView,
  StyleSheet,
  ActivityIndicator,
  RefreshControl,
} from "react-native";
import { supabase } from "../lib/supabase";
import { useAuth } from "../contexts/AuthContext";
import { format, startOfWeek, endOfWeek } from "date-fns";
import { toZonedTime } from "date-fns-tz";
import { DollarSign, TrendingUp, Scissors } from "lucide-react-native";

const DEFAULT_TZ = "Australia/Brisbane";

interface CompletedAppointment {
  id: string;
  client_name: string | null;
  price_charged: number | null;
  payment_method: string | null;
  appointment_date: string;
  start_time: string;
  services: { name: string } | null;
}

interface RentLedger {
  id: string;
  period_start: string;
  period_end: string;
  rent_due: number;
  collected_digital: number;
  collected_cash_reported: number;
  balance_remaining: number | null;
  status: string;
}

export default function WalletScreen() {
  const { barberId, shopId } = useAuth();
  const [appointments, setAppointments] = useState<CompletedAppointment[]>([]);
  const [rentLedger, setRentLedger] = useState<RentLedger | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const shopNow = toZonedTime(new Date(), DEFAULT_TZ);
  const weekStart = format(startOfWeek(shopNow, { weekStartsOn: 1 }), "yyyy-MM-dd");
  const weekEnd = format(endOfWeek(shopNow, { weekStartsOn: 1 }), "yyyy-MM-dd");

  const fetchData = useCallback(async () => {
    if (!barberId) return;

    // Fetch completed appointments this week
    const { data: aptData } = await supabase
      .from("appointments")
      .select(`
        id, client_name, price_charged, payment_method,
        appointment_date, start_time,
        services!appointments_service_id_fkey(name)
      `)
      .eq("barber_id", barberId)
      .eq("status", "completed")
      .gte("appointment_date", weekStart)
      .lte("appointment_date", weekEnd)
      .order("appointment_date", { ascending: false })
      .order("start_time", { ascending: false });

    if (aptData) setAppointments(aptData as any);

    // Fetch current rent ledger
    const { data: ledgerData } = await supabase
      .from("rent_ledger")
      .select("*")
      .eq("barber_id", barberId)
      .lte("period_start", weekEnd)
      .gte("period_end", weekStart)
      .order("period_start", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (ledgerData) setRentLedger(ledgerData as any);

    setLoading(false);
  }, [barberId, weekStart, weekEnd]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await fetchData();
    setRefreshing(false);
  }, [fetchData]);

  const totalEarned = useMemo(() => {
    return appointments.reduce((sum, a) => sum + (a.price_charged ?? 0), 0);
  }, [appointments]);

  const rentDue = rentLedger?.rent_due ?? 0;
  const rentCollected = rentLedger
    ? (rentLedger.collected_digital ?? 0) + (rentLedger.collected_cash_reported ?? 0)
    : 0;
  const rentRemaining = Math.max(0, rentDue - rentCollected);
  const takeHome = Math.max(0, totalEarned - rentRemaining);
  const rentProgress = rentDue > 0 ? Math.min(1, rentCollected / rentDue) : 0;

  const cardCount = appointments.filter((a) => a.payment_method === "card").length;
  const cashCount = appointments.filter((a) => a.payment_method === "cash").length;

  if (loading) {
    return (
      <View style={styles.loadingContainer}>
        <ActivityIndicator color="#00D68F" size="large" />
      </View>
    );
  }

  return (
    <ScrollView
      style={styles.container}
      contentContainerStyle={styles.scrollContent}
      refreshControl={
        <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor="#00D68F" />
      }
    >
      {/* Take-home hero */}
      <View style={styles.heroCard}>
        <Text style={styles.heroLabel}>Take-home this week</Text>
        <Text style={styles.heroAmount}>
          ${takeHome.toFixed(2)}
        </Text>
        <Text style={styles.heroSubtext}>
          {appointments.length} cut{appointments.length !== 1 ? "s" : ""} · ${totalEarned.toFixed(2)} earned
        </Text>
      </View>

      {/* Rent progress */}
      {rentDue > 0 && (
        <View style={styles.rentCard}>
          <View style={styles.rentHeader}>
            <Text style={styles.rentLabel}>Rent progress</Text>
            <Text style={styles.rentAmount}>
              ${rentCollected.toFixed(0)} / ${rentDue.toFixed(0)}
            </Text>
          </View>
          <View style={styles.progressTrack}>
            <View
              style={[
                styles.progressFill,
                {
                  width: `${rentProgress * 100}%`,
                  backgroundColor:
                    rentProgress >= 0.7 ? "#00D68F" : rentProgress >= 0.4 ? "#F59E0B" : "#EF4444",
                },
              ]}
            />
          </View>
          {rentRemaining > 0 ? (
            <Text style={styles.rentSubtext}>
              ${rentRemaining.toFixed(0)} remaining until rent is covered
            </Text>
          ) : (
            <Text style={[styles.rentSubtext, { color: "#00D68F" }]}>
              Rent covered — everything from here is yours
            </Text>
          )}
        </View>
      )}

      {/* Payment breakdown */}
      <View style={styles.breakdownCard}>
        <Text style={styles.sectionTitle}>Payment breakdown</Text>
        <View style={styles.breakdownRow}>
          <Text style={styles.breakdownLabel}>Card</Text>
          <Text style={styles.breakdownValue}>{cardCount} payments</Text>
        </View>
        <View style={styles.breakdownRow}>
          <Text style={styles.breakdownLabel}>Cash</Text>
          <Text style={styles.breakdownValue}>{cashCount} payments</Text>
        </View>
      </View>

      {/* Recent completions */}
      <View style={styles.recentSection}>
        <Text style={styles.sectionTitle}>This week</Text>
        {appointments.length === 0 ? (
          <View style={styles.emptyState}>
            <Scissors color="#7BA7C2" size={24} />
            <Text style={styles.emptyText}>No completed cuts this week</Text>
          </View>
        ) : (
          appointments.map((apt) => (
            <View key={apt.id} style={styles.recentRow}>
              <View style={{ flex: 1 }}>
                <Text style={styles.recentClient}>{apt.client_name || "Walk-in"}</Text>
                <Text style={styles.recentService}>{(apt.services as any)?.name || "Service"}</Text>
              </View>
              <Text style={styles.recentPrice}>${apt.price_charged ?? 0}</Text>
            </View>
          ))
        )}
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#0F1923",
  },
  scrollContent: {
    paddingHorizontal: 16,
    paddingTop: 16,
    paddingBottom: 100,
  },
  loadingContainer: {
    flex: 1,
    backgroundColor: "#0F1923",
    justifyContent: "center",
    alignItems: "center",
  },
  heroCard: {
    backgroundColor: "rgba(255,255,255,0.04)",
    borderRadius: 16,
    padding: 24,
    alignItems: "center",
    marginBottom: 12,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.06)",
  },
  heroLabel: {
    fontSize: 13,
    color: "#7BA7C2",
    marginBottom: 8,
  },
  heroAmount: {
    fontSize: 42,
    fontWeight: "700",
    color: "#00D68F",
  },
  heroSubtext: {
    fontSize: 13,
    color: "#94A3B8",
    marginTop: 8,
  },
  rentCard: {
    backgroundColor: "rgba(255,255,255,0.04)",
    borderRadius: 12,
    padding: 16,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.06)",
  },
  rentHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 10,
  },
  rentLabel: {
    fontSize: 14,
    fontWeight: "600",
    color: "#F8FAFC",
  },
  rentAmount: {
    fontSize: 13,
    color: "#94A3B8",
  },
  progressTrack: {
    height: 6,
    backgroundColor: "rgba(255,255,255,0.08)",
    borderRadius: 3,
    overflow: "hidden",
    marginBottom: 8,
  },
  progressFill: {
    height: 6,
    borderRadius: 3,
  },
  rentSubtext: {
    fontSize: 12,
    color: "#94A3B8",
  },
  breakdownCard: {
    backgroundColor: "rgba(255,255,255,0.04)",
    borderRadius: 12,
    padding: 16,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.06)",
  },
  sectionTitle: {
    fontSize: 14,
    fontWeight: "600",
    color: "#F8FAFC",
    marginBottom: 12,
  },
  breakdownRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    paddingVertical: 6,
  },
  breakdownLabel: {
    fontSize: 13,
    color: "#94A3B8",
  },
  breakdownValue: {
    fontSize: 13,
    color: "#F8FAFC",
  },
  recentSection: {
    marginTop: 4,
  },
  recentRow: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: "rgba(255,255,255,0.06)",
  },
  recentClient: {
    fontSize: 14,
    fontWeight: "500",
    color: "#F8FAFC",
  },
  recentService: {
    fontSize: 12,
    color: "#7BA7C2",
    marginTop: 2,
  },
  recentPrice: {
    fontSize: 15,
    fontWeight: "600",
    color: "#00D68F",
  },
  emptyState: {
    alignItems: "center",
    paddingTop: 40,
    gap: 8,
  },
  emptyText: {
    fontSize: 13,
    color: "#7BA7C2",
  },
});