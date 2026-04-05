import { useState, useCallback } from "react";
import {
  View,
  Text,
  StyleSheet,
  ActivityIndicator,
  RefreshControl,
  ScrollView,
  TouchableOpacity,
} from "react-native";
import { UserPlus } from "lucide-react-native";
import { format, startOfWeek } from "date-fns";
import { toZonedTime } from "date-fns-tz";
import { supabase } from "../../lib/supabase";
import { useAuth } from "../../contexts/AuthContext";
import BarberCard, {
  type BarberCardData,
  CARD_TOTAL,
} from "../../components/owner/BarberCard";
import BarberDetailSheet from "../../components/owner/BarberDetailSheet";
import { colors, NOVA_GREEN } from "../../theme/colors";
import {
  timeToMinutes,
  formatTime12Compact,
  normalizeService,
} from "../../utils/formatters";
import { SHOP_TZ as TZ } from "../../config/shop";
import { useScreenData } from "../../hooks/useScreenData";

// ─── Types ───────────────────────────────────────────────────────────────────

interface BarberRow {
  id: string;
  name: string;
  display_name: string | null;
  avatar_url: string | null;
}

interface ApptRow {
  id: string;
  barber_id: string;
  start_time: string;
  end_time: string;
  status: string;
  price_charged: number | null;
  services:
    | { duration_minutes: number | null }
    | { duration_minutes: number | null }[]
    | null;
}

interface ScheduleRow {
  barber_id: string;
  day_of_week: number;
  start_time: string;
  end_time: string;
  is_available: boolean;
}

interface LedgerRow {
  barber_id: string;
  rent_due: number | null;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function fmtMoney(v: number): string {
  const r = Math.round(v);
  return "$" + r.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ",");
}

const DAY_ABBR = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

function nextWorkingDay(
  schedules: ScheduleRow[],
  todayDow: number
): string | null {
  for (let i = 1; i <= 7; i++) {
    const dow = (todayDow + i) % 7;
    const s = schedules.find((x) => x.day_of_week === dow && x.is_available);
    if (s) return `${DAY_ABBR[dow]} ${formatTime12Compact(s.start_time)}`;
  }
  return null;
}

function serviceDuration(s: ApptRow["services"]): number {
  const n = normalizeService(s);
  return n?.duration_minutes ?? 30;
}

// ─── Screen ──────────────────────────────────────────────────────────────────

export default function OwnerGlanceScreen() {
  const { shopId } = useAuth();

  const [cards, setCards] = useState<BarberCardData[]>([]);
  const [totalWeek, setTotalWeek] = useState(0);
  const [pendingInvites, setPendingInvites] = useState(0);
  const [selectedBarber, setSelectedBarber] = useState<BarberCardData | null>(null);
  const [showDetail, setShowDetail] = useState(false);
  const [fetchError, setFetchError] = useState(false);

  // Snapshot time values — stable for this render pass
  const now = toZonedTime(new Date(), TZ);
  const todayStr = format(now, "yyyy-MM-dd");
  const todayDow = now.getDay();
  const nowMins = now.getHours() * 60 + now.getMinutes();
  const mondayStr = format(startOfWeek(now, { weekStartsOn: 1 }), "yyyy-MM-dd");
  const dayName = format(now, "EEEE");

  const fetchData = useCallback(async () => {
    if (!shopId) return;
    setFetchError(false);

    try {
      // 1. All barbers in the shop
      const { data: barbers } = await supabase
        .from("barbers")
        .select("id, name, display_name, avatar_url")
        .eq("shop_id", shopId)
        .order("name");

      if (!barbers?.length) {
        setCards([]);
        return;
      }

      const ids = barbers.map((b: BarberRow) => b.id);

      // 2–7: Parallel queries (including pending invites count)
      const [
        { data: todayAppts },
        { data: weekAppts },
        { data: schedules },
        { data: ledgers },
        { data: leases },
        { count: inviteCount },
      ] = await Promise.all([
        supabase
          .from("appointments")
          .select(
            "id, barber_id, start_time, end_time, status, price_charged, services!appointments_service_id_fkey(duration_minutes)"
          )
          .in("barber_id", ids)
          .eq("appointment_date", todayStr)
          .neq("status", "cancelled"),

        supabase
          .from("appointments")
          .select("id, barber_id, price_charged")
          .in("barber_id", ids)
          .gte("appointment_date", mondayStr)
          .lte("appointment_date", todayStr)
          .eq("status", "completed"),

        supabase
          .from("availability_schedules")
          .select("barber_id, day_of_week, start_time, end_time, is_available")
          .in("barber_id", ids),

        supabase
          .from("barber_rent_ledger")
          .select("barber_id, rent_due")
          .in("barber_id", ids)
          .eq("status", "open"),

        supabase
          .from("booth_leases")
          .select("barber_id, rent_amount")
          .in("barber_id", ids)
          .eq("status", "active"),

        supabase
          .from("barber_invites")
          .select("id", { count: "exact", head: true })
          .eq("shop_id", shopId)
          .eq("status", "pending"),
      ]);

      // ── Build BarberCardData per barber ──────────────────────────────────
      const cardData: BarberCardData[] = (barbers as BarberRow[]).map(
        (barber) => {
          const barberTodayAppts = (todayAppts ?? []).filter(
            (a: ApptRow) => a.barber_id === barber.id
          ) as ApptRow[];

          const barberWeekAppts = (weekAppts ?? []).filter(
            (a: { barber_id: string; price_charged: number | null }) =>
              a.barber_id === barber.id
          );

          const barberSchedules = (schedules ?? []).filter(
            (s: ScheduleRow) => s.barber_id === barber.id
          ) as ScheduleRow[];

          const ledger = (ledgers ?? []).find(
            (l: LedgerRow) => l.barber_id === barber.id
          ) as LedgerRow | undefined;

          const todaySchedule = barberSchedules.find(
            (s) => s.day_of_week === todayDow
          );
          const isInToday = !!todaySchedule?.is_available;

          // Status label
          let statusLabel = "Available";
          if (!isInToday) {
            statusLabel = "Off today";
          } else {
            for (const apt of barberTodayAppts) {
              if (apt.status === "confirmed") {
                const s = timeToMinutes(apt.start_time);
                const e = timeToMinutes(apt.end_time);
                if (nowMins >= s && nowMins < e) {
                  statusLabel = "With client";
                  break;
                }
              }
            }
          }

          const nextInLabel = !isInToday
            ? nextWorkingDay(barberSchedules, todayDow)
            : null;

          const startTime =
            isInToday && todaySchedule
              ? formatTime12Compact(todaySchedule.start_time)
              : null;

          // Revenue
          const todayRevenue = barberTodayAppts.reduce(
            (sum, a) => sum + Number(a.price_charged ?? 0),
            0
          );
          const weekRevenue = barberWeekAppts.reduce(
            (sum, a) => sum + Number(a.price_charged ?? 0),
            0
          );

          // Occupancy: booked minutes / scheduled minutes today
          let occupancyPct = 0;
          if (isInToday && todaySchedule) {
            const availMins =
              timeToMinutes(todaySchedule.end_time) -
              timeToMinutes(todaySchedule.start_time);
            if (availMins > 0) {
              const bookedMins = barberTodayAppts.reduce(
                (sum, a) => sum + serviceDuration(a.services as ApptRow["services"]),
                0
              );
              occupancyPct = Math.min(1, bookedMins / availMins);
            }
          }

          // Rent progress — lease rent_amount is the target, week revenue is progress
          const lease = (leases ?? []).find(
            (l: { barber_id: string; rent_amount: number | null }) =>
              l.barber_id === barber.id,
          ) as { barber_id: string; rent_amount: number | null } | undefined;
          const rentDue = Number(lease?.rent_amount ?? ledger?.rent_due ?? 0);
          const rentPct = rentDue > 0 ? Math.min(1, weekRevenue / rentDue) : 0;

          return {
            id: barber.id,
            name: barber.name,
            displayName: barber.display_name,
            avatarUrl: barber.avatar_url,
            isInToday,
            statusLabel: isInToday ? statusLabel : (nextInLabel ? `In next at ${nextInLabel}` : "Off today"),
            startTime,
            todayRevenue,
            weekRevenue,
            occupancyPct,
            rentPct,
          };
        }
      );

      // In-today barbers first
      cardData.sort((a, b) => {
        if (a.isInToday === b.isInToday) return 0;
        return a.isInToday ? -1 : 1;
      });

      const weekTotal = cardData.reduce((sum, c) => sum + c.weekRevenue, 0);
      setCards(cardData);
      setTotalWeek(weekTotal);
      setPendingInvites(inviteCount ?? 0);
    } catch {
      setFetchError(true);
    }
  }, [shopId]);

  const { loading, refreshing, onRefresh } = useScreenData(
    fetchData,
    [fetchData],
    !!shopId,
  );

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <View style={styles.safe}>
      {loading ? (
        <View style={styles.loadingWrap}>
          <ActivityIndicator color={NOVA_GREEN} size="large" />
        </View>
      ) : fetchError ? (
        <View style={styles.loadingWrap}>
          <Text style={{ color: "#F5F3EF", fontSize: 15, fontFamily: "Satoshi-Medium", textAlign: "center", marginBottom: 12 }}>
            Couldn't load floor data
          </Text>
          <TouchableOpacity onPress={onRefresh} style={{ paddingHorizontal: 20, paddingVertical: 10, backgroundColor: "#24272E", borderRadius: 8 }}>
            <Text style={{ color: "#00D68F", fontSize: 14, fontFamily: "Satoshi-Medium" }}>Try again</Text>
          </TouchableOpacity>
        </View>
      ) : (
        <ScrollView
          style={styles.scroll}
          contentContainerStyle={styles.content}
          showsVerticalScrollIndicator={false}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={onRefresh}
              tintColor={NOVA_GREEN}
            />
          }
        >
          {/* ── Header ──────────────────────────────────────────────────── */}
          <View style={styles.header}>
            <View>
              <Text style={styles.headerDay}>{dayName}</Text>
              <Text style={styles.headerTitle}>Your floor</Text>
            </View>
            <View style={styles.headerRight}>
              <Text style={styles.headerWeekLabel}>THIS WEEK</Text>
              <Text style={styles.headerWeekTotal}>{fmtMoney(totalWeek)}</Text>
            </View>
          </View>

          {/* ── Pending invites badge ──────────────────────────────────── */}
          {pendingInvites > 0 && (
            <View style={styles.pendingBadge}>
              <View pointerEvents="none">
                <UserPlus size={16} color={NOVA_GREEN} />
              </View>
              <Text style={styles.pendingText}>
                {pendingInvites} pending invite{pendingInvites !== 1 ? "s" : ""}
              </Text>
            </View>
          )}

          {/* ── Cards ───────────────────────────────────────────────────── */}
          {cards.length === 0 ? (
            <View style={styles.emptyWrap}>
              <Text style={styles.emptyText}>No barbers on your floor.</Text>
            </View>
          ) : (
            cards.map((card) => (
              <BarberCard
                key={card.id}
                data={card}
                onPress={() => {
                  setSelectedBarber(card);
                  setShowDetail(true);
                }}
              />
            ))
          )}
        </ScrollView>
      )}

      <BarberDetailSheet
        visible={showDetail}
        onClose={() => {
          setShowDetail(false);
          setSelectedBarber(null);
        }}
        barber={selectedBarber}
        shopId={shopId!}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  safe: {
    flex: 1,
    backgroundColor: colors.obsidian950,
  },
  loadingWrap: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
  },
  scroll: {
    flex: 1,
  },
  content: {
    paddingHorizontal: 16,
    paddingTop: 8,
    paddingBottom: 48,
  },

  // Header
  header: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "flex-end",
    marginBottom: 20,
    paddingTop: 4,
  },
  headerDay: {
    fontSize: 13,
    fontFamily: "Satoshi-Regular",
    color: colors.textTertiary,
    lineHeight: 18,
  },
  headerTitle: {
    fontSize: 22,
    fontWeight: "600",
    fontFamily: "Satoshi-Medium",
    color: colors.textPrimary,
    lineHeight: 28,
  },
  headerRight: {
    alignItems: "flex-end",
  },
  headerWeekLabel: {
    fontSize: 13,
    fontWeight: "500",
    fontFamily: "Satoshi-Medium",
    color: colors.textTertiary,
    letterSpacing: 0.5,
    textTransform: "uppercase",
    lineHeight: 14,
  },
  headerWeekTotal: {
    fontSize: 22,
    fontWeight: "600",
    fontFamily: "DMSerifText-Regular",
    color: NOVA_GREEN,
    lineHeight: 28,
  },

  // Pending invites
  pendingBadge: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    backgroundColor: "rgba(0,214,143,0.08)",
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 10,
    marginBottom: 16,
  },
  pendingText: {
    fontSize: 13,
    fontFamily: "Satoshi-Medium",
    fontWeight: "500",
    color: NOVA_GREEN,
  },

  emptyWrap: {
    alignItems: "center",
    paddingTop: 60,
  },
  emptyText: {
    fontSize: 14,
    fontFamily: "Satoshi-Regular",
    color: colors.textTertiary,
  },
});
