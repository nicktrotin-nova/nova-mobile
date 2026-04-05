import { useState, useEffect, useCallback } from "react";
import {
  View,
  Text,
  ScrollView,
  TouchableOpacity,
  StyleSheet,
  Image,
  Linking,
  ActivityIndicator,
} from "react-native";
import NovaSheet from "../NovaSheet";
import AppointmentCard from "../AppointmentCard";
import { format, startOfWeek } from "date-fns";
import { toZonedTime } from "date-fns-tz";
import {
  Phone,
  MessageSquare,
  Calendar,
  Clock,
  DollarSign,
  TrendingUp,
} from "lucide-react-native";
import { supabase } from "../../lib/supabase";
import { colors, BG, NOVA_GREEN, LABEL, MUTED, DIM } from "../../theme/colors";
import type { BarberCardData } from "./BarberCard";
import { SHOP_TZ as TZ } from "../../config/shop";

export interface BarberDetailSheetProps {
  visible: boolean;
  onClose: () => void;
  barber: BarberCardData | null;
  shopId: string;
}

interface ApptRow {
  id: string;
  client_name: string | null;
  start_time: string;
  end_time: string;
  status: string;
  price_charged: number | null;
  services: { name: string } | { name: string }[] | null;
}

function fmt12(t: string): string {
  const [h, m] = t.slice(0, 5).split(":").map(Number);
  const period = h >= 12 ? "pm" : "am";
  const hour = h % 12 || 12;
  return m === 0 ? `${hour}${period}` : `${hour}:${m.toString().padStart(2, "0")}${period}`;
}

function fmtMoney(v: number): string {
  const r = Math.round(v);
  return "$" + r.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ",");
}


export default function BarberDetailSheet({
  visible,
  onClose,
  barber,
  shopId,
}: BarberDetailSheetProps) {

  const [appointments, setAppointments] = useState<ApptRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [barberPhone, setBarberPhone] = useState<string | null>(null);
  const [rentDue, setRentDue] = useState(0);
  const [rentCollected, setRentCollected] = useState(0);

  const fetchData = useCallback(async () => {
    if (!barber || !visible) return;
    setLoading(true);

    const now = toZonedTime(new Date(), TZ);
    const todayStr = format(now, "yyyy-MM-dd");
    const mondayStr = format(startOfWeek(now, { weekStartsOn: 1 }), "yyyy-MM-dd");

    const [apptRes, barberRes, ledgerRes, leaseRes] = await Promise.all([
      supabase
        .from("appointments")
        .select("id, client_name, start_time, end_time, status, price_charged, services!appointments_service_id_fkey(name)")
        .eq("barber_id", barber.id)
        .eq("appointment_date", todayStr)
        .neq("status", "cancelled")
        .order("start_time"),
      supabase
        .from("barbers")
        .select("phone, email")
        .eq("id", barber.id)
        .maybeSingle(),
      supabase
        .from("barber_rent_ledger")
        .select("rent_due, collected_digital, collected_cash_reported")
        .eq("barber_id", barber.id)
        .eq("status", "open")
        .maybeSingle(),
      supabase
        .from("booth_leases")
        .select("rent_amount")
        .eq("barber_id", barber.id)
        .eq("status", "active")
        .maybeSingle(),
    ]);

    setAppointments((apptRes.data ?? []) as ApptRow[]);
    setBarberPhone(
      (barberRes.data as { phone?: string | null } | null)?.phone ?? null,
    );

    const ledger = ledgerRes.data as {
      rent_due: number | null;
      collected_digital: number | null;
      collected_cash_reported: number | null;
    } | null;
    const lease = leaseRes.data as { rent_amount: number | null } | null;
    const due = Number(lease?.rent_amount ?? ledger?.rent_due ?? 0);
    const collected =
      Number(ledger?.collected_digital ?? 0) +
      Number(ledger?.collected_cash_reported ?? 0);
    setRentDue(due);
    setRentCollected(collected);
    setLoading(false);
  }, [barber?.id, visible]);

  useEffect(() => {
    if (visible && barber) void fetchData();
  }, [visible, barber?.id, fetchData]);

  if (!barber) return null;

  const rawName = barber.displayName?.trim() || barber.name.trim();
  const firstName = rawName.split(/\s+/)[0] || rawName;
  const rentRemaining = Math.max(0, rentDue - rentCollected);
  const rentPct = rentDue > 0 ? Math.min(100, Math.round((rentCollected / rentDue) * 100)) : 0;

  const completed = appointments.filter((a) => a.status === "completed");
  const upcoming = appointments.filter((a) => a.status === "confirmed");
  const completedTotal = completed.reduce((s, a) => s + Number(a.price_charged ?? 0), 0);

  return (
    <NovaSheet
      visible={visible && !!barber}
      onClose={onClose}
      renderHeader={() => (
        <View style={styles.headerRow}>
          <View style={styles.headerLeft}>
            {barber.avatarUrl ? (
              <Image source={{ uri: barber.avatarUrl }} style={styles.headerAvatar} />
            ) : (
              <View style={styles.headerAvatarFallback}>
                <Text style={styles.headerAvatarInitial}>
                  {firstName[0]?.toUpperCase() ?? "?"}
                </Text>
              </View>
            )}
            <View>
              <Text style={styles.headerName}>{firstName}</Text>
              <Text style={styles.headerStatus}>{barber.statusLabel}</Text>
            </View>
          </View>
        </View>
      )}
    >

          {loading ? (
            <View style={styles.loadingWrap}>
              <ActivityIndicator color={NOVA_GREEN} size="small" />
            </View>
          ) : (
            <ScrollView
              style={styles.scroll}
              contentContainerStyle={styles.scrollContent}
              showsVerticalScrollIndicator={false}
              keyboardShouldPersistTaps="handled"
            >
              {/* Stats row */}
              <View style={styles.statsRow}>
                <View style={styles.statCard}>
                  <Text style={styles.statLabel}>TODAY</Text>
                  <Text style={styles.statValueGreen}>{fmtMoney(barber.todayRevenue)}</Text>
                </View>
                <View style={styles.statCard}>
                  <Text style={styles.statLabel}>THIS WEEK</Text>
                  <Text style={styles.statValueGreen}>{fmtMoney(barber.weekRevenue)}</Text>
                </View>
                <View style={styles.statCard}>
                  <Text style={styles.statLabel}>CHAIR</Text>
                  <Text style={styles.statValue}>{Math.round(barber.occupancyPct * 100)}%</Text>
                </View>
              </View>

              {/* Rent status */}
              {rentDue > 0 && (
                <View style={styles.rentCard}>
                  <View style={styles.rentHeader}>
                    <Text style={styles.rentTitle}>Rent</Text>
                    <Text style={styles.rentPct}>{rentPct}%</Text>
                  </View>
                  <View style={styles.rentBarBg}>
                    <View
                      style={[
                        styles.rentBarFill,
                        { width: `${Math.min(100, rentPct)}%` },
                      ]}
                    />
                  </View>
                  <View style={styles.rentDetail}>
                    <Text style={styles.rentDetailText}>
                      {fmtMoney(rentCollected)} of {fmtMoney(rentDue)}
                    </Text>
                    {rentRemaining > 0 && (
                      <Text style={styles.rentRemainingText}>
                        {fmtMoney(rentRemaining)} to go
                      </Text>
                    )}
                  </View>
                </View>
              )}

              {/* Today's appointments */}
              <Text style={styles.sectionLabel}>
                TODAY — {appointments.length} BOOKING{appointments.length !== 1 ? "S" : ""}
              </Text>

              {appointments.length === 0 ? (
                <Text style={styles.emptyText}>No bookings today</Text>
              ) : (
                appointments.map((apt) => (
                  <AppointmentCard
                    key={apt.id}
                    appointment={apt}
                    variant="list"
                    showEndTime
                  />
                ))
              )}

              {/* Quick actions */}
              <Text style={[styles.sectionLabel, { marginTop: 20 }]}>QUICK ACTIONS</Text>
              <View style={styles.actionsRow}>
                {barberPhone && (
                  <TouchableOpacity
                    style={styles.actionBtn}
                    onPress={() => void Linking.openURL(`tel:${barberPhone}`)}
                    activeOpacity={0.75}
                  >
                    <View pointerEvents="none">
                      <Phone size={18} color={LABEL} strokeWidth={2} />
                    </View>
                    <Text style={styles.actionLabel}>Call</Text>
                  </TouchableOpacity>
                )}
                {barberPhone && (
                  <TouchableOpacity
                    style={styles.actionBtn}
                    onPress={() => void Linking.openURL(`sms:${barberPhone}`)}
                    activeOpacity={0.75}
                  >
                    <View pointerEvents="none">
                      <MessageSquare size={18} color={LABEL} strokeWidth={2} />
                    </View>
                    <Text style={styles.actionLabel}>Text</Text>
                  </TouchableOpacity>
                )}
              </View>
            </ScrollView>
          )}
    </NovaSheet>
  );
}

const styles = StyleSheet.create({
  // Header
  headerRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 16,
    marginBottom: 12,
  },
  headerLeft: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
  },
  headerAvatar: {
    width: 40,
    height: 40,
    borderRadius: 20,
  },
  headerAvatarFallback: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: colors.obsidian600,
    alignItems: "center",
    justifyContent: "center",
  },
  headerAvatarInitial: {
    fontSize: 16,
    fontWeight: "600",
    fontFamily: "Satoshi-Medium",
    color: MUTED,
  },
  headerName: {
    fontSize: 18,
    fontWeight: "700",
    fontFamily: "Satoshi-Bold",
    color: LABEL,
  },
  headerStatus: {
    fontSize: 12,
    fontFamily: "Satoshi-Regular",
    color: MUTED,
    marginTop: 1,
  },

  loadingWrap: {
    paddingVertical: 40,
    alignItems: "center",
  },
  scroll: {},
  scrollContent: {
    paddingHorizontal: 16,
    paddingBottom: 32,
  },

  // Stats
  statsRow: {
    flexDirection: "row",
    gap: 8,
    marginBottom: 12,
  },
  statCard: {
    flex: 1,
    backgroundColor: colors.obsidian800,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: colors.borderMedium,
    paddingVertical: 10,
    paddingHorizontal: 10,
    alignItems: "center",
  },
  statLabel: {
    fontSize: 10,
    fontWeight: "600",
    fontFamily: "Satoshi-Medium",
    color: DIM,
    textTransform: "uppercase",
    letterSpacing: 0.5,
    marginBottom: 4,
  },
  statValue: {
    fontSize: 18,
    fontWeight: "600",
    fontFamily: "Satoshi-Medium",
    color: LABEL,
    fontVariant: ["tabular-nums"],
  },
  statValueGreen: {
    fontSize: 18,
    fontWeight: "600",
    fontFamily: "Satoshi-Medium",
    color: NOVA_GREEN,
    fontVariant: ["tabular-nums"],
  },

  // Rent
  rentCard: {
    backgroundColor: colors.obsidian800,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.borderMedium,
    padding: 14,
    marginBottom: 16,
  },
  rentHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 8,
  },
  rentTitle: {
    fontSize: 13,
    fontWeight: "600",
    fontFamily: "Satoshi-Medium",
    color: LABEL,
  },
  rentPct: {
    fontSize: 13,
    fontWeight: "600",
    fontFamily: "Satoshi-Medium",
    color: NOVA_GREEN,
  },
  rentBarBg: {
    height: 6,
    borderRadius: 3,
    backgroundColor: colors.obsidian600,
    overflow: "hidden",
    marginBottom: 8,
  },
  rentBarFill: {
    height: "100%",
    borderRadius: 3,
    backgroundColor: NOVA_GREEN,
  },
  rentDetail: {
    flexDirection: "row",
    justifyContent: "space-between",
  },
  rentDetailText: {
    fontSize: 12,
    fontFamily: "Satoshi-Regular",
    color: MUTED,
  },
  rentRemainingText: {
    fontSize: 12,
    fontFamily: "Satoshi-Medium",
    fontWeight: "500",
    color: DIM,
  },

  // Section
  sectionLabel: {
    fontSize: 11,
    fontWeight: "600",
    fontFamily: "Satoshi-Medium",
    color: DIM,
    textTransform: "uppercase",
    letterSpacing: 0.5,
    marginBottom: 10,
  },
  emptyText: {
    fontSize: 14,
    fontFamily: "Satoshi-Regular",
    color: MUTED,
    marginBottom: 8,
  },

  // Actions
  actionsRow: {
    flexDirection: "row",
    gap: 10,
  },
  actionBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    backgroundColor: colors.obsidian800,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: colors.borderMedium,
    paddingVertical: 12,
    paddingHorizontal: 16,
  },
  actionLabel: {
    fontSize: 14,
    fontWeight: "500",
    fontFamily: "Satoshi-Medium",
    color: LABEL,
  },
});
