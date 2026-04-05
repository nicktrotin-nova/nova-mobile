import { useState, useEffect, useCallback, useMemo, useRef } from "react";
import {
  View,
  Text,
  ScrollView,
  TouchableOpacity,
  StyleSheet,
  ActivityIndicator,
  Modal,
  Pressable,
  TextInput,
  Linking,
  Dimensions,
  RefreshControl,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useNavigation } from "@react-navigation/native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import type { BottomTabNavigationProp } from "@react-navigation/bottom-tabs";
import type { RootTabParamList } from "../navigation/RootTabParamList";
import { format, parseISO, differenceInDays, differenceInWeeks, differenceInMonths } from "date-fns";
import {
  ChevronLeft,
  ChevronRight,
  Phone,
  Mail,
  Users,
  Search,
} from "lucide-react-native";
import { supabase } from "../lib/supabase";
import { useAuth } from "../contexts/AuthContext";
import LoadingScreen from "../components/LoadingScreen";
import EmptyState from "../components/EmptyState";
import type { MoreStackParamList } from "../navigation/MoreStack";
import { colors, BG, NOVA_GREEN, STEEL, MUTED, DIM, LABEL, CARD_BG, BORDER } from "../theme/colors";
import { useScreenData } from "../hooks/useScreenData";
import {
  formatTime12,
  normalizeService,
  normalizeStatus,
  clientDisplayName as fmtClientName,
  clientInitials,
} from "../utils/formatters";
import { fetchRecentByClient } from "../api/appointments";

const SEARCH_DEBOUNCE_MS = 300;
const MODAL_MAX_H = Dimensions.get("window").height * 0.88;

type SortMode = "recent" | "visits" | "az";

/* ─── Interfaces ─── */

interface ClientEmbed {
  id: string;
  first_name: string | null;
  last_name: string | null;
  email: string | null;
  phone: string | null;
  notes: string | null;
  preferred_barber_id: string | null;
}

interface CbrRowRaw {
  visit_count: number | null;
  first_appointment_at: string | null;
  clients: ClientEmbed | ClientEmbed[] | null;
}

interface ApptAggRow {
  client_id: string;
  price_charged: number | null;
  appointment_date: string;
  status: string;
}

interface ClientListItem {
  id: string;
  first_name: string | null;
  last_name: string | null;
  email: string | null;
  phone: string | null;
  notes: string | null;
  preferred_barber_id: string | null;
  visit_count: number;
  first_appointment_at: string | null;
  totalRevenue: number;
  lastVisitDate: string | null;
}

interface ApptRowRaw {
  id: string;
  appointment_date: string;
  start_time: string;
  status: string;
  price_charged: number | null;
  services: { name: string } | { name: string }[] | null;
}

/* ─── Helpers ─── */

function normalizeClient(c: ClientEmbed | ClientEmbed[] | null): ClientEmbed | null {
  if (c == null) return null;
  if (Array.isArray(c)) return c[0] ?? null;
  return c;
}

function normalizeServiceName(s: ApptRowRaw["services"]): string | null {
  const n = normalizeService(s);
  return n?.name ?? null;
}

function formatRevenue(amount: number): string {
  if (amount === 0) return "$0";
  if (amount === Math.floor(amount)) return `$${amount.toLocaleString()}`;
  return `$${amount.toFixed(2)}`;
}

function relativeTime(dateStr: string | null): string {
  if (!dateStr) return "New client";
  try {
    const d = parseISO(dateStr);
    const now = new Date();
    const days = differenceInDays(now, d);
    if (days === 0) return "Today";
    if (days === 1) return "Yesterday";
    if (days <= 6) return `${days} days ago`;
    const weeks = differenceInWeeks(now, d);
    if (weeks <= 4) return `${weeks} ${weeks === 1 ? "week" : "weeks"} ago`;
    const months = differenceInMonths(now, d);
    if (months <= 11) return `${months} ${months === 1 ? "month" : "months"} ago`;
    return "Over a year ago";
  } catch {
    return "New client";
  }
}

function firstVisitLabel(iso: string | null): string {
  if (!iso) return "—";
  try {
    return format(parseISO(iso), "MMM yyyy");
  } catch {
    return "—";
  }
}

function matchesSearch(item: ClientListItem, q: string): boolean {
  const needle = q.trim().toLowerCase();
  if (!needle) return true;
  return [
    (item.first_name ?? "").toLowerCase(),
    (item.last_name ?? "").toLowerCase(),
    (item.phone ?? "").toLowerCase(),
    (item.email ?? "").toLowerCase(),
  ].some((p) => p.includes(needle));
}

/* ─── Component ─── */

export default function ClientsScreen() {
  const navigation = useNavigation<NativeStackNavigationProp<MoreStackParamList>>();
  const { barberId } = useAuth();

  const [items, setItems] = useState<ClientListItem[]>([]);
  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [sortMode, setSortMode] = useState<SortMode>("recent");
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const [detailOpen, setDetailOpen] = useState(false);
  const [selected, setSelected] = useState<ClientListItem | null>(null);
  const [recentAppts, setRecentAppts] = useState<ApptRowRaw[]>([]);
  const [apptsLoading, setApptsLoading] = useState(false);
  const [fetchError, setFetchError] = useState(false);

  // Debounce search
  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => setDebouncedSearch(search), SEARCH_DEBOUNCE_MS);
    return () => { if (debounceRef.current) clearTimeout(debounceRef.current); };
  }, [search]);

  const load = useCallback(async () => {
    if (!barberId) return;
    setFetchError(false);

    // Query 1 — client relationships
    const { data: rels, error: relsError } = await supabase
      .from("client_barber_relationships")
      .select(`
        visit_count,
        first_appointment_at,
        clients!inner (
          id, first_name, last_name, email, phone, notes, preferred_barber_id
        )
      `)
      .eq("barber_id", barberId)
      .eq("is_active", true);

    if (relsError) {
      setFetchError(true);
      return;
    }

    if (!rels || rels.length === 0) {
      setItems([]);
      return;
    }

    // Flatten client embeds
    const clientMap = new Map<string, ClientListItem>();
    for (const row of rels as CbrRowRaw[]) {
      const c = normalizeClient(row.clients);
      if (!c?.id) continue;
      clientMap.set(c.id, {
        id: c.id,
        first_name: c.first_name,
        last_name: c.last_name,
        email: c.email,
        phone: c.phone,
        notes: c.notes,
        preferred_barber_id: c.preferred_barber_id,
        visit_count: Number(row.visit_count ?? 0),
        first_appointment_at: row.first_appointment_at,
        totalRevenue: 0,
        lastVisitDate: null,
      });
    }

    const clientIds = Array.from(clientMap.keys());

    // Query 2 — revenue + last visit (completed appointments only)
    const { data: apptData, error: apptError } = await supabase
      .from("appointments")
      .select("client_id, price_charged, appointment_date, status")
      .eq("barber_id", barberId)
      .eq("status", "completed")
      .in("client_id", clientIds);

    if (apptError) {
      setFetchError(true);
      return;
    }

    if (apptData) {
      for (const a of apptData as ApptAggRow[]) {
        const entry = clientMap.get(a.client_id);
        if (!entry) continue;
        entry.totalRevenue += Number(a.price_charged ?? 0);
        if (!entry.lastVisitDate || a.appointment_date > entry.lastVisitDate) {
          entry.lastVisitDate = a.appointment_date;
        }
      }
    }

    setItems(Array.from(clientMap.values()));
  }, [barberId]);

  const { loading, refreshing, onRefresh } = useScreenData(
    load,
    [load],
    !!barberId,
  );

  // Summary stats
  const totalClients = items.length;
  const regulars = useMemo(() => items.filter((i) => i.preferred_barber_id === barberId).length, [items, barberId]);
  const avgRevenue = useMemo(() => {
    if (items.length === 0) return 0;
    const total = items.reduce((s, i) => s + i.totalRevenue, 0);
    return Math.round(total / items.length);
  }, [items]);

  // Filter + sort
  const filtered = useMemo(() => {
    const list = items.filter((i) => matchesSearch(i, debouncedSearch));
    if (sortMode === "recent") {
      list.sort((a, b) => {
        const da = a.lastVisitDate ?? "";
        const db = b.lastVisitDate ?? "";
        return db.localeCompare(da);
      });
    } else if (sortMode === "visits") {
      list.sort((a, b) => b.visit_count - a.visit_count);
    } else {
      list.sort((a, b) => {
        const na = (a.first_name ?? "").toLowerCase();
        const nb = (b.first_name ?? "").toLowerCase();
        return na.localeCompare(nb);
      });
    }
    return list;
  }, [items, debouncedSearch, sortMode]);

  // Detail sheet
  const fetchRecentAppts = useCallback(async (clientId: string) => {
    if (!barberId) return;
    setApptsLoading(true);
    const { data } = await fetchRecentByClient(supabase, {
      clientId,
      barberId,
    });
    setRecentAppts((data ?? []) as ApptRowRaw[]);
    setApptsLoading(false);
  }, [barberId]);

  const openDetail = (c: ClientListItem) => {
    setSelected(c);
    setDetailOpen(true);
    void fetchRecentAppts(c.id);
  };

  const closeDetail = () => {
    setDetailOpen(false);
    setSelected(null);
    setRecentAppts([]);
  };

  const isPreferred = selected?.preferred_barber_id === barberId;

  return (
    <SafeAreaView style={styles.safe} edges={["top"]}>
      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity
          onPress={() => navigation.goBack()}
          style={styles.backBtn}
          hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
          activeOpacity={0.7}
        >
          <View pointerEvents="none">
            <ChevronLeft size={24} color={LABEL} strokeWidth={2} />
          </View>
        </TouchableOpacity>
        <View style={styles.headerTitleWrap} pointerEvents="none">
          <Text style={styles.headerTitle}>Clients</Text>
        </View>
        {!loading ? (
          <View style={styles.countBadge}>
            <Text style={styles.countBadgeText}>{totalClients}</Text>
          </View>
        ) : (
          <View style={styles.headerSpacer} />
        )}
      </View>

      {loading ? (
        <LoadingScreen />
      ) : items.length === 0 && fetchError ? (
        <View style={styles.emptyWrap}>
          <View pointerEvents="none">
            <Users size={48} color={DIM} strokeWidth={1.8} />
          </View>
          <Text style={styles.emptyTitle}>Couldn't load clients</Text>
          <Text style={styles.emptySub}>Check your connection and pull to refresh.</Text>
        </View>
      ) : items.length === 0 ? (
        <EmptyState
          icon={<Users size={48} color={DIM} strokeWidth={1.8} />}
          title="No clients yet"
          subtitle="They'll show up after their first booking."
        />
      ) : (
        <ScrollView
          style={styles.scroll}
          contentContainerStyle={styles.scrollContent}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={onRefresh}
              tintColor={NOVA_GREEN}
            />
          }
        >
          {/* Summary strip */}
          <View style={styles.statsRow}>
            <View style={styles.statCard}>
              <Text style={styles.statValue}>{totalClients}</Text>
              <Text style={styles.statLabel}>Total</Text>
            </View>
            <View style={styles.statCard}>
              <Text style={[styles.statValue, { color: NOVA_GREEN }]}>{regulars}</Text>
              <Text style={styles.statLabel}>Regulars</Text>
            </View>
          </View>

          {/* Search */}
          <View style={styles.searchWrap}>
            <View pointerEvents="none" style={styles.searchIcon}>
              <Search size={16} color={DIM} strokeWidth={2} />
            </View>
            <TextInput
              value={search}
              onChangeText={setSearch}
              placeholder="Search by name, phone, or email..."
              placeholderTextColor={MUTED}
              style={styles.searchInput}
              autoCapitalize="none"
              autoCorrect={false}
            />
          </View>

          {/* Sort pills */}
          <View style={styles.pillRow}>
            {([
              { key: "recent" as SortMode, label: "Recent" },
              { key: "visits" as SortMode, label: "Most visits" },
              { key: "az" as SortMode, label: "A\u2013Z" },
            ]).map((p) => {
              const active = sortMode === p.key;
              return (
                <TouchableOpacity
                  key={p.key}
                  style={[styles.pill, active ? styles.pillActive : styles.pillInactive]}
                  onPress={() => setSortMode(p.key)}
                  activeOpacity={0.7}
                >
                  <Text style={[styles.pillText, active ? styles.pillTextActive : styles.pillTextInactive]}>
                    {p.label}
                  </Text>
                </TouchableOpacity>
              );
            })}
          </View>

          {/* Client list */}
          {filtered.length === 0 ? (
            <View style={styles.noMatchWrap}>
              <View pointerEvents="none">
                <Search size={36} color={DIM} strokeWidth={1.8} />
              </View>
              <Text style={styles.noMatchTitle}>
                No one matches '{debouncedSearch}'
              </Text>
              <Text style={styles.noMatchSub}>
                Try a different name or number.
              </Text>
            </View>
          ) : (
            <View style={styles.clientList}>
              {filtered.map((c) => {
                const isPref = c.preferred_barber_id === barberId;
                return (
                  <TouchableOpacity
                    key={c.id}
                    style={styles.clientRow}
                    onPress={() => openDetail(c)}
                    activeOpacity={0.7}
                    delayPressIn={0}
                  >
                    <View
                      style={[
                        styles.initialsCircle,
                        isPref ? styles.initialsPref : styles.initialsReg,
                      ]}
                    >
                      <Text
                        style={[
                          styles.initialsText,
                          { color: isPref ? NOVA_GREEN : MUTED },
                        ]}
                      >
                        {clientInitials(c.first_name, c.last_name)}
                      </Text>
                    </View>
                    <View style={styles.clientMid}>
                      <Text style={styles.clientName} numberOfLines={1}>
                        {fmtClientName(c.first_name, c.last_name)}
                        {isPref ? (
                          <Text style={styles.starChar}> ★</Text>
                        ) : null}
                      </Text>
                      {c.email?.trim() ? (
                        <Text style={styles.clientContact} numberOfLines={1}>
                          {c.email.trim()}
                        </Text>
                      ) : null}
                      <Text style={styles.clientContact} numberOfLines={1}>
                        {c.phone?.trim() || (
                          <Text style={styles.clientNoPhone}>No phone on file</Text>
                        )}
                      </Text>
                    </View>
                    <View pointerEvents="none" style={styles.chevronWrap}>
                      <ChevronRight size={16} color={colors.white15} strokeWidth={2} />
                    </View>
                  </TouchableOpacity>
                );
              })}
            </View>
          )}
        </ScrollView>
      )}

      {/* Detail bottom sheet */}
      <Modal
        visible={detailOpen}
        transparent
        animationType="slide"
        onRequestClose={closeDetail}
      >
        <View style={styles.modalOverlay}>
          <Pressable style={styles.modalScrim} onPress={closeDetail} />
          <View style={[styles.modalSheet, { maxHeight: MODAL_MAX_H }]}>
            <View style={styles.modalHandle} />
            <ScrollView
              showsVerticalScrollIndicator={false}
              keyboardShouldPersistTaps="handled"
              contentContainerStyle={styles.modalScrollContent}
            >
              {selected ? (
                <>
                  {/* Name */}
                  <Text style={styles.detailName}>
                    {fmtClientName(selected.first_name, selected.last_name)}
                  </Text>
                  {isPreferred ? (
                    <Text style={styles.detailRegular}>Your regular</Text>
                  ) : null}

                  {/* Contact */}
                  <View style={styles.contactBlock}>
                    {selected.phone?.trim() ? (
                      <TouchableOpacity
                        style={styles.contactRow}
                        onPress={() => {
                          const cleaned = selected.phone!.replace(/[^\d+]/g, "");
                          if (cleaned) void Linking.openURL(`tel:${cleaned}`);
                        }}
                        activeOpacity={0.7}
                        delayPressIn={0}
                      >
                        <View pointerEvents="none" style={styles.contactIcon}>
                          <Phone size={16} color={MUTED} strokeWidth={2} />
                        </View>
                        <Text style={styles.contactText}>{selected.phone.trim()}</Text>
                      </TouchableOpacity>
                    ) : (
                      <View style={styles.contactRow}>
                        <View pointerEvents="none" style={styles.contactIcon}>
                          <Phone size={16} color={MUTED} strokeWidth={2} />
                        </View>
                        <Text style={styles.contactTextDim}>No phone on file</Text>
                      </View>
                    )}
                    {selected.email?.trim() ? (
                      <TouchableOpacity
                        style={styles.contactRow}
                        onPress={() => void Linking.openURL(`mailto:${selected.email!.trim()}`)}
                        activeOpacity={0.7}
                        delayPressIn={0}
                      >
                        <View pointerEvents="none" style={styles.contactIcon}>
                          <Mail size={16} color={MUTED} strokeWidth={2} />
                        </View>
                        <Text style={styles.contactText} numberOfLines={1}>
                          {selected.email.trim()}
                        </Text>
                      </TouchableOpacity>
                    ) : null}
                  </View>

                  {/* Stats 2×2 */}
                  <View style={styles.detailStatsGrid}>
                    <View style={styles.detailStatCard}>
                      <Text style={styles.detailStatValue}>{selected.visit_count}</Text>
                      <Text style={styles.detailStatLabel}>total visits</Text>
                    </View>
                    <View style={styles.detailStatCard}>
                      <Text style={[styles.detailStatValue, { color: NOVA_GREEN }]}>
                        {formatRevenue(selected.totalRevenue)}
                      </Text>
                      <Text style={styles.detailStatLabel}>earned</Text>
                    </View>
                    <View style={styles.detailStatCard}>
                      <Text style={styles.detailStatValue}>
                        {firstVisitLabel(selected.first_appointment_at)}
                      </Text>
                      <Text style={styles.detailStatLabel}>first visit</Text>
                    </View>
                    <View style={styles.detailStatCard}>
                      <Text style={styles.detailStatValue}>
                        {relativeTime(selected.lastVisitDate)}
                      </Text>
                      <Text style={styles.detailStatLabel}>last seen</Text>
                    </View>
                  </View>

                  {/* Notes */}
                  {selected.notes?.trim() ? (
                    <>
                      <Text style={styles.sectionLabel}>NOTES</Text>
                      <View style={styles.notesCard}>
                        <Text style={styles.notesBody}>{selected.notes.trim()}</Text>
                      </View>
                    </>
                  ) : null}

                  {/* Recent appointments */}
                  <Text style={styles.sectionLabel}>RECENT</Text>
                  {apptsLoading ? (
                    <ActivityIndicator color={NOVA_GREEN} style={{ marginVertical: 16 }} />
                  ) : recentAppts.length === 0 ? (
                    <Text style={styles.noAppts}>No appointments yet</Text>
                  ) : (
                    <View style={styles.apptList}>
                      {recentAppts.map((a) => {
                        const svc = normalizeServiceName(a.services);
                        const status = normalizeStatus(a.status);
                        const dateLabel = format(parseISO(a.appointment_date), "EEE, d MMM");
                        const timeLabel = formatTime12(a.start_time);
                        const price = Number(a.price_charged ?? 0);
                        return (
                          <View key={a.id} style={styles.apptRow}>
                            <View style={styles.apptLeft}>
                              <Text style={styles.apptDate} numberOfLines={1}>
                                {dateLabel} · {timeLabel}
                                {status === "no_show" ? (
                                  <Text style={styles.apptNoShow}> No show</Text>
                                ) : status === "cancelled" ? (
                                  <Text style={styles.apptCancelled}> Cancelled</Text>
                                ) : null}
                              </Text>
                            </View>
                            <Text style={styles.apptPrice}>
                              {formatRevenue(price)}
                            </Text>
                          </View>
                        );
                      })}
                    </View>
                  )}

                  {/* Book again */}
                  <TouchableOpacity
                    style={styles.bookAgainBtn}
                    onPress={() => {
                      const name = fmtClientName(selected!.first_name, selected!.last_name);
                      const phone = selected!.phone?.trim() ?? "";
                      closeDetail();
                      const tabNav = navigation.getParent<BottomTabNavigationProp<RootTabParamList>>();
                      if (tabNav) {
                        tabNav.navigate("Calendar", {
                          prefillClientName: name,
                          prefillClientPhone: phone,
                        });
                      }
                    }}
                    activeOpacity={0.8}
                  >
                    <Text style={styles.bookAgainText}>Book again</Text>
                  </TouchableOpacity>
                </>
              ) : null}
            </ScrollView>
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: BG },

  // Header
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 8,
    height: 52,
  },
  backBtn: {
    width: 44,
    height: 44,
    alignItems: "center",
    justifyContent: "center",
    zIndex: 2,
  },
  headerTitleWrap: {
    ...StyleSheet.absoluteFillObject,
    justifyContent: "center",
    alignItems: "center",
    zIndex: 1,
  },
  headerTitle: { fontSize: 17, fontWeight: "600", fontFamily: "Satoshi-Medium", color: LABEL },
  headerSpacer: { width: 44, zIndex: 2 },
  countBadge: {
    zIndex: 2,
    minWidth: 36,
    paddingHorizontal: 10,
    height: 28,
    borderRadius: 14,
    backgroundColor: CARD_BG,
    borderWidth: 1,
    borderColor: BORDER,
    alignItems: "center",
    justifyContent: "center",
    marginRight: 8,
  },
  countBadgeText: {
    fontSize: 13,
    fontWeight: "600",
    fontFamily: "Satoshi-Medium",
    color: LABEL,
    fontVariant: ["tabular-nums"],
  },

  // Loading / empty
  loadingWrap: { flex: 1, justifyContent: "center", alignItems: "center" },
  emptyWrap: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    paddingHorizontal: 32,
  },
  emptyTitle: { marginTop: 16, fontSize: 16, fontWeight: "500", fontFamily: "Satoshi-Medium", color: LABEL },
  emptySub: { marginTop: 4, fontSize: 13, fontFamily: "Satoshi-Regular", color: DIM, textAlign: "center" },

  // Scroll
  scroll: { flex: 1 },
  scrollContent: { paddingHorizontal: 16, paddingBottom: 40 },

  // Stats
  statsRow: { flexDirection: "row", gap: 8, marginBottom: 12 },
  statCard: {
    flex: 1,
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 10,
    backgroundColor: CARD_BG,
    borderWidth: 1,
    borderColor: BORDER,
  },
  statValue: { fontSize: 18, fontWeight: "700", fontFamily: "Satoshi-Bold", color: LABEL },
  statLabel: { fontSize: 11, fontFamily: "Satoshi-Regular", color: DIM, marginTop: 2 },

  // Search
  searchWrap: {
    flexDirection: "row",
    alignItems: "center",
    height: 44,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: BORDER,
    backgroundColor: CARD_BG,
    paddingHorizontal: 14,
    marginBottom: 12,
  },
  searchIcon: { marginRight: 10 },
  searchInput: {
    flex: 1,
    height: 44,
    color: LABEL,
    fontSize: 15,
    fontFamily: "Satoshi-Regular",
  },

  // Sort pills
  pillRow: { flexDirection: "row", gap: 8, marginBottom: 16 },
  pill: { borderRadius: 20, paddingHorizontal: 14, paddingVertical: 8 },
  pillActive: { backgroundColor: colors.warmWhite15 },
  pillInactive: { backgroundColor: colors.white06 },
  pillText: { fontSize: 13, fontWeight: "500", fontFamily: "Satoshi-Medium" },
  pillTextActive: { color: "#FFFFFF" },
  pillTextInactive: { color: MUTED },

  // No match
  noMatchWrap: { alignItems: "center", paddingTop: 48 },
  noMatchTitle: { fontSize: 14, fontFamily: "Satoshi-Regular", color: LABEL, marginTop: 12 },
  noMatchSub: { fontSize: 12, fontFamily: "Satoshi-Regular", color: DIM, marginTop: 4 },

  // Client list
  clientList: { gap: 6 },
  clientRow: {
    flexDirection: "row",
    alignItems: "center",
    borderRadius: 12,
    paddingVertical: 14,
    paddingHorizontal: 16,
    backgroundColor: CARD_BG,
    borderWidth: 1,
    borderColor: BORDER,
  },
  initialsCircle: {
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: "center",
    justifyContent: "center",
  },
  initialsReg: { backgroundColor: colors.steel12 },
  initialsPref: { backgroundColor: colors.nova12 },
  initialsText: { fontSize: 15, fontWeight: "600", fontFamily: "Satoshi-Medium" },
  clientMid: { flex: 1, marginLeft: 14, minWidth: 0 },
  clientName: { fontSize: 15, fontWeight: "500", fontFamily: "Satoshi-Medium", color: LABEL },
  starChar: { fontSize: 12, color: NOVA_GREEN },
  clientContact: { fontSize: 12, fontFamily: "Satoshi-Regular", color: DIM, marginTop: 2 },
  clientNoPhone: { color: colors.white25 },
  chevronWrap: { marginLeft: 8 },

  // Modal
  modalOverlay: { flex: 1, justifyContent: "flex-end" },
  modalScrim: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: colors.black60,
  },
  modalSheet: {
    backgroundColor: colors.obsidian700,
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    paddingHorizontal: 20,
    paddingBottom: 28,
  },
  modalHandle: {
    alignSelf: "center",
    width: 40,
    height: 4,
    borderRadius: 2,
    backgroundColor: colors.white25,
    marginTop: 12,
    marginBottom: 16,
  },
  modalScrollContent: { paddingBottom: 24 },

  // Detail header
  detailName: { fontSize: 22, fontWeight: "600", fontFamily: "Satoshi-Medium", color: LABEL },
  detailRegular: { fontSize: 12, fontFamily: "Satoshi-Regular", color: NOVA_GREEN, marginTop: 4, marginBottom: 8 },

  // Contact
  contactBlock: { marginTop: 16, marginBottom: 20, gap: 12 },
  contactRow: { flexDirection: "row", alignItems: "center", height: 40 },
  contactIcon: { width: 28, alignItems: "center", marginRight: 8 },
  contactText: { flex: 1, fontSize: 15, fontFamily: "Satoshi-Regular", color: LABEL },
  contactTextDim: { flex: 1, fontSize: 15, fontFamily: "Satoshi-Regular", color: DIM },

  // Detail stats 2×2
  detailStatsGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
    marginBottom: 20,
  },
  detailStatCard: {
    width: "48%" as unknown as number,
    flexGrow: 1,
    borderRadius: 12,
    padding: 12,
    backgroundColor: CARD_BG,
    borderWidth: 1,
    borderColor: BORDER,
  },
  detailStatValue: { fontSize: 16, fontWeight: "700", fontFamily: "Satoshi-Bold", color: LABEL },
  detailStatLabel: { fontSize: 11, fontFamily: "Satoshi-Regular", color: DIM, marginTop: 2 },

  // Section labels
  sectionLabel: {
    fontSize: 13,
    fontWeight: "500",
    fontFamily: "Satoshi-Medium",
    color: DIM,
    letterSpacing: 0.5,
    textTransform: "uppercase",
    marginTop: 20,
    marginBottom: 8,
  },

  // Notes
  notesCard: {
    borderRadius: 10,
    padding: 12,
    backgroundColor: CARD_BG,
    borderWidth: 1,
    borderColor: BORDER,
  },
  notesBody: { fontSize: 13, fontFamily: "Satoshi-Regular", color: MUTED, lineHeight: 19 },

  // Recent appointments
  noAppts: { fontSize: 13, fontFamily: "Satoshi-Regular", color: DIM, marginBottom: 8 },
  apptList: {},
  apptRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    height: 40,
    paddingHorizontal: 4,
    borderBottomWidth: 1,
    borderBottomColor: colors.white04,
  },
  apptLeft: { flex: 1, minWidth: 0 },
  apptDate: { fontSize: 13, fontFamily: "Satoshi-Regular", color: LABEL },
  apptNoShow: { fontSize: 10, color: colors.error },
  apptCancelled: { fontSize: 10, color: DIM },
  apptPrice: { fontSize: 13, fontWeight: "500", fontFamily: "Satoshi-Medium", color: NOVA_GREEN },

  // Book again
  bookAgainBtn: {
    marginTop: 20,
    height: 48,
    borderRadius: 10,
    backgroundColor: NOVA_GREEN,
    alignItems: "center",
    justifyContent: "center",
  },
  bookAgainText: { fontSize: 15, fontWeight: "600", fontFamily: "Satoshi-Medium", color: BG },
});
