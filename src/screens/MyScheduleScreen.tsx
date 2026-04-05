import { useState, useCallback, useMemo } from "react";
import {
  View,
  Text,
  ScrollView,
  TouchableOpacity,
  StyleSheet,
  ActivityIndicator,
  Switch,
  Alert,
  Modal,
  Pressable,
  TextInput,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useNavigation } from "@react-navigation/native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import { format } from "date-fns";
import { toZonedTime } from "date-fns-tz";
import {
  ChevronLeft,
  ChevronDown,
  ChevronUp,
  Copy,
  Plus,
  Trash2,
  CalendarOff,
  Clock,
} from "lucide-react-native";
import { supabase } from "../lib/supabase";
import { useAuth } from "../contexts/AuthContext";
import type { MoreStackParamList } from "../navigation/MoreStack";
import { colors, BG, NOVA_GREEN, STEEL, MUTED, DIM, LABEL, CARD_BG, BORDER } from "../theme/colors";
import { SHOP_TZ as TZ } from "../config/shop";
import { useScreenData } from "../hooks/useScreenData";
const TRACK_OFF = colors.trackOff;

const DEFAULT_START = "09:00:00";
const DEFAULT_END = "17:00:00";

const FIRST_SLOT_MIN = 5 * 60;
const LAST_SLOT_MIN = 22 * 60;

interface ScheduleRow {
  id: string;
  barber_id: string;
  day_of_week: number;
  start_time: string;
  end_time: string;
  is_available: boolean;
}

interface OverrideRow {
  id: string;
  barber_id: string;
  override_date: string;
  is_blocked: boolean;
  start_time: string | null;
  end_time: string | null;
  reason: string | null;
}

const DAYS: { dow: number; short: string; full: string }[] = [
  { dow: 1, short: "Mon", full: "Monday" },
  { dow: 2, short: "Tue", full: "Tuesday" },
  { dow: 3, short: "Wed", full: "Wednesday" },
  { dow: 4, short: "Thu", full: "Thursday" },
  { dow: 5, short: "Fri", full: "Friday" },
  { dow: 6, short: "Sat", full: "Saturday" },
  { dow: 0, short: "Sun", full: "Sunday" },
];

function minutesToDb(m: number): string {
  const h = Math.floor(m / 60);
  const mm = m % 60;
  return `${String(h).padStart(2, "0")}:${String(mm).padStart(2, "0")}:00`;
}

function dbToMinutes(s: string | null | undefined): number | null {
  if (s == null || s === "") return null;
  const [h, m] = s.slice(0, 5).split(":").map(Number);
  if (Number.isNaN(h) || Number.isNaN(m)) return null;
  return h * 60 + m;
}

function to12hr(hhmmss: string): string {
  const [hStr, mStr] = hhmmss.split(":");
  const h = parseInt(hStr, 10);
  const m = mStr?.slice(0, 2) || "00";
  const hour12 = h === 0 ? 12 : h > 12 ? h - 12 : h;
  const ampm = h < 12 ? "AM" : "PM";
  return `${hour12}:${m} ${ampm}`;
}

function formatHours(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return m ? `${h}h ${m}m` : `${h}h`;
}

function parseMinutes(timeStr: string): number {
  const [h, m] = timeStr.split(":").map(Number);
  return h * 60 + (m || 0);
}

const TIME_SLOTS: number[] = (() => {
  const out: number[] = [];
  for (let m = FIRST_SLOT_MIN; m <= LAST_SLOT_MIN; m += 30) out.push(m);
  return out;
})();

export default function MyScheduleScreen() {
  const navigation =
    useNavigation<NativeStackNavigationProp<MoreStackParamList>>();
  const { barberId, shopId } = useAuth();

  const [rows, setRows] = useState<ScheduleRow[]>([]);
  const [overrides, setOverrides] = useState<OverrideRow[]>([]);
  const [expandedDow, setExpandedDow] = useState<number | null>(null);
  const [draftStartMin, setDraftStartMin] = useState(480);
  const [draftEndMin, setDraftEndMin] = useState(1020);
  const [saving, setSaving] = useState(false);
  const [toggleBusy, setToggleBusy] = useState(false);

  // Override modal state
  const [overrideModalOpen, setOverrideModalOpen] = useState(false);
  const [overrideDate, setOverrideDate] = useState("");
  const [overrideType, setOverrideType] = useState<"blocked" | "custom">(
    "blocked",
  );
  const [overrideStartTime, setOverrideStartTime] = useState("09:00");
  const [overrideEndTime, setOverrideEndTime] = useState("17:00");
  const [overrideReason, setOverrideReason] = useState("");
  const [addingOverride, setAddingOverride] = useState(false);

  const now = toZonedTime(new Date(), TZ);
  const todayStr = format(now, "yyyy-MM-dd");
  const todayDow = now.getDay();

  const byDow = useMemo(() => {
    const m = new Map<number, ScheduleRow>();
    for (const r of rows) m.set(r.day_of_week, r);
    return m;
  }, [rows]);

  const workingDays = useMemo(
    () => rows.filter((r) => r.is_available).length,
    [rows],
  );

  const weeklyMinutes = useMemo(
    () =>
      rows.reduce((sum, s) => {
        if (!s.is_available) return sum;
        return sum + (parseMinutes(s.end_time) - parseMinutes(s.start_time));
      }, 0),
    [rows],
  );

  const load = useCallback(async () => {
    if (!barberId) return;
    const [schedRes, overRes] = await Promise.all([
      supabase
        .from("availability_schedules")
        .select(
          "id, barber_id, day_of_week, start_time, end_time, is_available",
        )
        .eq("barber_id", barberId),
      supabase
        .from("availability_overrides")
        .select(
          "id, barber_id, override_date, is_blocked, start_time, end_time, reason",
        )
        .eq("barber_id", barberId)
        .gte("override_date", todayStr)
        .order("override_date"),
    ]);
    setRows((schedRes.data ?? []) as ScheduleRow[]);
    setOverrides((overRes.data ?? []) as OverrideRow[]);
  }, [barberId, todayStr]);

  const { loading } = useScreenData(load, [load], !!barberId);

  // ── Day toggle ──────────────────────────────────────────────────────────────

  const handleToggleDay = async (dow: number, turnOn: boolean) => {
    if (!barberId || toggleBusy) return;
    setToggleBusy(true);
    const existing = byDow.get(dow);
    try {
      if (turnOn) {
        const startT =
          existing?.start_time && dbToMinutes(existing.start_time) != null
            ? existing.start_time
            : DEFAULT_START;
        const endT =
          existing?.end_time && dbToMinutes(existing.end_time) != null
            ? existing.end_time
            : DEFAULT_END;
        if (existing?.id) {
          await supabase
            .from("availability_schedules")
            .update({ is_available: true, start_time: startT, end_time: endT })
            .eq("id", existing.id);
        } else {
          await supabase.from("availability_schedules").insert({
            barber_id: barberId,
            shop_id: shopId,
            day_of_week: dow,
            start_time: startT,
            end_time: endT,
            is_available: true,
          });
        }
      } else {
        if (existing?.id) {
          await supabase
            .from("availability_schedules")
            .update({ is_available: false })
            .eq("id", existing.id);
        } else {
          await supabase.from("availability_schedules").insert({
            barber_id: barberId,
            shop_id: shopId,
            day_of_week: dow,
            start_time: DEFAULT_START,
            end_time: DEFAULT_END,
            is_available: false,
          });
        }
        if (expandedDow === dow) setExpandedDow(null);
      }
      await load();
    } catch (e: unknown) {
      Alert.alert(
        "Could not update",
        e instanceof Error ? e.message : "Something went wrong",
      );
    } finally {
      setToggleBusy(false);
    }
  };

  // ── Time editing ────────────────────────────────────────────────────────────

  const openTimesForDay = (dow: number) => {
    const row = byDow.get(dow);
    if (!row?.is_available) return;
    if (expandedDow === dow) {
      setExpandedDow(null);
      return;
    }
    const s = dbToMinutes(row.start_time) ?? 540;
    let e = dbToMinutes(row.end_time) ?? 1020;
    if (e <= s) e = Math.min(s + 30, LAST_SLOT_MIN);
    setDraftStartMin(s);
    setDraftEndMin(e);
    setExpandedDow(dow);
  };

  const saveTimesForDay = async (dow: number) => {
    if (!barberId || draftEndMin <= draftStartMin) {
      Alert.alert("Invalid times", "End time must be after start time.");
      return;
    }
    setSaving(true);
    const existing = byDow.get(dow);
    try {
      const fields = {
        start_time: minutesToDb(draftStartMin),
        end_time: minutesToDb(draftEndMin),
        is_available: true,
      };
      if (existing?.id) {
        await supabase
          .from("availability_schedules")
          .update(fields)
          .eq("id", existing.id);
      } else {
        await supabase.from("availability_schedules").insert({
          barber_id: barberId,
          shop_id: shopId,
          day_of_week: dow,
          ...fields,
        });
      }
      await load();
      setExpandedDow(null);
    } catch (e: unknown) {
      Alert.alert(
        "Could not save",
        e instanceof Error ? e.message : "Something went wrong",
      );
    } finally {
      setSaving(false);
    }
  };

  const copyMonToAll = async () => {
    const monday = rows.find((s) => s.day_of_week === 1 && s.is_available);
    if (!monday) {
      Alert.alert("Set Monday hours first");
      return;
    }
    const others = rows.filter((s) => s.id !== monday.id && s.is_available);
    try {
      await Promise.all(
        others.map((s) =>
          supabase
            .from("availability_schedules")
            .update({
              start_time: monday.start_time,
              end_time: monday.end_time,
            })
            .eq("id", s.id),
        ),
      );
      await load();
    } catch {
      Alert.alert("Could not copy hours");
    }
  };

  // ── Overrides ───────────────────────────────────────────────────────────────

  const addOverride = async () => {
    if (!barberId || !overrideDate) return;
    setAddingOverride(true);
    try {
      await supabase.from("availability_overrides").insert({
        barber_id: barberId,
        override_date: overrideDate,
        is_blocked: overrideType === "blocked",
        start_time:
          overrideType === "custom" ? overrideStartTime + ":00" : null,
        end_time: overrideType === "custom" ? overrideEndTime + ":00" : null,
        reason: overrideReason.trim() || null,
      });
      await load();
      setOverrideModalOpen(false);
      setOverrideDate("");
      setOverrideReason("");
      setOverrideType("blocked");
    } catch (e: unknown) {
      Alert.alert(
        "Could not add override",
        e instanceof Error ? e.message : "Something went wrong",
      );
    } finally {
      setAddingOverride(false);
    }
  };

  const deleteOverride = async (id: string) => {
    await supabase.from("availability_overrides").delete().eq("id", id);
    await load();
  };

  // ── Time pill helpers ───────────────────────────────────────────────────────

  const startPills = TIME_SLOTS.filter((m) => m < draftEndMin);
  const endPills = TIME_SLOTS.filter((m) => m > draftStartMin);
  const setStart = (m: number) => {
    setDraftStartMin(m);
    setDraftEndMin((prev) =>
      prev <= m ? Math.min(m + 30, LAST_SLOT_MIN) : prev,
    );
  };
  const setEnd = (m: number) => {
    setDraftEndMin(m);
    setDraftStartMin((prev) =>
      prev >= m ? Math.max(m - 30, FIRST_SLOT_MIN) : prev,
    );
  };

  // ── Render ──────────────────────────────────────────────────────────────────

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
          <Text style={styles.headerTitle}>My Schedule</Text>
        </View>
        <View style={styles.headerSpacer} />
      </View>

      {loading ? (
        <View style={styles.loadingWrap}>
          <ActivityIndicator color={NOVA_GREEN} size="large" />
        </View>
      ) : (
        <ScrollView
          style={styles.scroll}
          contentContainerStyle={styles.scrollContent}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          {/* Subtitle */}
          <Text style={styles.subtitle}>
            Set your regular working hours and days off
          </Text>

          {/* Stats row */}
          <View style={styles.statsRow}>
            <View style={styles.statCard}>
              <Text style={styles.statValue}>{workingDays}</Text>
              <Text style={styles.statLabel}>Days per week</Text>
            </View>
            <View style={styles.statCard}>
              <Text style={[styles.statValue, { color: NOVA_GREEN }]}>
                {formatHours(weeklyMinutes)}
              </Text>
              <Text style={styles.statLabel}>Weekly hours</Text>
            </View>
            <View style={styles.statCard}>
              <Text style={[styles.statValue, { color: colors.textPrimary }]}>
                {overrides.length}
              </Text>
              <Text style={styles.statLabel}>Overrides</Text>
            </View>
          </View>

          {/* Weekly schedule */}
          <View style={styles.dayList}>
            {DAYS.map(({ dow, short }) => {
              const row = byDow.get(dow);
              const working = row?.is_available === true;
              const isToday = dow === todayDow;
              const expanded = expandedDow === dow;
              const dayMins = working
                ? parseMinutes(row!.end_time) - parseMinutes(row!.start_time)
                : 0;

              if (!row) {
                return (
                  <TouchableOpacity
                    key={dow}
                    style={[
                      styles.dayRow,
                      isToday && styles.dayRowToday,
                      { borderStyle: "dashed" },
                    ]}
                    onPress={() => {
                      if (!barberId) return;
                      void (async () => {
                        await supabase
                          .from("availability_schedules")
                          .insert({
                            barber_id: barberId,
                            shop_id: shopId,
                            day_of_week: dow,
                            start_time: DEFAULT_START,
                            end_time: DEFAULT_END,
                            is_available: true,
                          });
                        await load();
                      })();
                    }}
                    activeOpacity={0.7}
                  >
                    <Text
                      style={[
                        styles.dayShort,
                        { color: isToday ? NOVA_GREEN : colors.textTertiary },
                      ]}
                    >
                      {short}
                    </Text>
                    <View pointerEvents="none" style={{ marginRight: 6 }}>
                      <Plus size={14} color={colors.textTertiary} strokeWidth={2} />
                    </View>
                    <Text style={styles.addText}>Add working hours</Text>
                  </TouchableOpacity>
                );
              }

              return (
                <View key={dow}>
                  <TouchableOpacity
                    style={[
                      styles.dayRow,
                      isToday && styles.dayRowToday,
                      !working && styles.dayRowOff,
                    ]}
                    onPress={() => openTimesForDay(dow)}
                    activeOpacity={working ? 0.75 : 1}
                    disabled={!working}
                  >
                    <Text
                      style={[
                        styles.dayShort,
                        {
                          color: isToday
                            ? NOVA_GREEN
                            : working
                              ? LABEL
                              : colors.textTertiary,
                        },
                      ]}
                    >
                      {short}
                    </Text>

                    <Switch
                      value={working}
                      onValueChange={(v) => void handleToggleDay(dow, v)}
                      trackColor={{ false: TRACK_OFF, true: colors.nova500 }}
                      thumbColor="#FFFFFF"
                      style={styles.switchCompact}
                    />

                    {working ? (
                      <View style={styles.timeInfo}>
                        <Text style={styles.timeText}>
                          {to12hr(row.start_time)}
                        </Text>
                        <Text style={styles.timeDash}>–</Text>
                        <Text style={styles.timeText}>
                          {to12hr(row.end_time)}
                        </Text>
                        <Text style={styles.durationText}>
                          {formatHours(dayMins)}
                        </Text>
                        <View pointerEvents="none">
                          {expanded ? (
                            <ChevronUp
                              size={14}
                              color={colors.textTertiary}
                              strokeWidth={2}
                            />
                          ) : (
                            <ChevronDown
                              size={14}
                              color={colors.textTertiary}
                              strokeWidth={2}
                            />
                          )}
                        </View>
                      </View>
                    ) : (
                      <Text style={styles.dayOffText}>Day off</Text>
                    )}
                  </TouchableOpacity>

                  {/* Expanded time picker */}
                  {expanded && working ? (
                    <View style={styles.editBlock}>
                      <View style={styles.timePickersRow}>
                        <TouchableOpacity
                          style={styles.timeButton}
                          onPress={() => {
                            /* scroll to start pill */
                          }}
                          activeOpacity={1}
                        >
                          <Text style={styles.timeButtonText}>
                            {to12hr(minutesToDb(draftStartMin))}
                          </Text>
                        </TouchableOpacity>
                        <Text style={styles.toText}>to</Text>
                        <TouchableOpacity
                          style={styles.timeButton}
                          onPress={() => {
                            /* scroll to end pill */
                          }}
                          activeOpacity={1}
                        >
                          <Text style={styles.timeButtonText}>
                            {to12hr(minutesToDb(draftEndMin))}
                          </Text>
                        </TouchableOpacity>
                      </View>

                      <View style={styles.pillSection}>
                        <Text style={styles.pillLabel}>START</Text>
                        <ScrollView
                          horizontal
                          showsHorizontalScrollIndicator={false}
                          contentContainerStyle={styles.pillScroll}
                        >
                          {startPills.map((m) => {
                            const sel = draftStartMin === m;
                            return (
                              <TouchableOpacity
                                key={m}
                                onPress={() => setStart(m)}
                                style={[
                                  styles.pill,
                                  sel && styles.pillSelected,
                                ]}
                                activeOpacity={0.85}
                              >
                                <Text
                                  style={[
                                    styles.pillText,
                                    sel && styles.pillTextSelected,
                                  ]}
                                >
                                  {to12hr(minutesToDb(m))}
                                </Text>
                              </TouchableOpacity>
                            );
                          })}
                        </ScrollView>
                      </View>

                      <View style={styles.pillSection}>
                        <Text style={styles.pillLabel}>END</Text>
                        <ScrollView
                          horizontal
                          showsHorizontalScrollIndicator={false}
                          contentContainerStyle={styles.pillScroll}
                        >
                          {endPills.map((m) => {
                            const sel = draftEndMin === m;
                            return (
                              <TouchableOpacity
                                key={m}
                                onPress={() => setEnd(m)}
                                style={[
                                  styles.pill,
                                  sel && styles.pillSelected,
                                ]}
                                activeOpacity={0.85}
                              >
                                <Text
                                  style={[
                                    styles.pillText,
                                    sel && styles.pillTextSelected,
                                  ]}
                                >
                                  {to12hr(minutesToDb(m))}
                                </Text>
                              </TouchableOpacity>
                            );
                          })}
                        </ScrollView>
                      </View>

                      <TouchableOpacity
                        style={[
                          styles.saveBtn,
                          saving && styles.saveBtnDisabled,
                        ]}
                        onPress={() => void saveTimesForDay(dow)}
                        disabled={saving}
                        activeOpacity={0.85}
                      >
                        <Text style={styles.saveBtnText}>
                          {saving ? "Saving…" : "Save"}
                        </Text>
                      </TouchableOpacity>
                    </View>
                  ) : null}
                </View>
              );
            })}
          </View>

          {/* Copy Mon to all */}
          <TouchableOpacity
            style={styles.copyBtn}
            onPress={() => void copyMonToAll()}
            activeOpacity={0.7}
          >
            <View pointerEvents="none" style={{ marginRight: 6 }}>
              <Copy size={14} color={MUTED} strokeWidth={2} />
            </View>
            <Text style={styles.copyBtnText}>Copy Mon to all</Text>
          </TouchableOpacity>

          {/* Overrides section */}
          <View style={styles.overridesHeader}>
            <View>
              <Text style={styles.overridesTitle}>Time Off & Overrides</Text>
              <Text style={styles.overridesSub}>
                Block days off or set custom hours
              </Text>
            </View>
            <TouchableOpacity
              style={styles.addOverrideBtn}
              onPress={() => setOverrideModalOpen(true)}
              activeOpacity={0.7}
            >
              <View pointerEvents="none" style={{ marginRight: 4 }}>
                <Plus size={14} color={MUTED} strokeWidth={2} />
              </View>
              <Text style={styles.addOverrideBtnText}>Add</Text>
            </TouchableOpacity>
          </View>

          {overrides.length === 0 ? (
            <View style={styles.emptyOverrides}>
              <View pointerEvents="none">
                <CalendarOff size={20} color={colors.textTertiary} strokeWidth={2} />
              </View>
              <Text style={styles.emptyOverridesText}>
                No upcoming overrides
              </Text>
            </View>
          ) : (
            overrides.map((ov) => (
              <View
                key={ov.id}
                style={[
                  styles.overrideRow,
                  ov.is_blocked
                    ? styles.overrideRowBlocked
                    : styles.overrideRowCustom,
                ]}
              >
                <View
                  style={[
                    styles.overrideIcon,
                    ov.is_blocked
                      ? styles.overrideIconBlocked
                      : styles.overrideIconCustom,
                  ]}
                >
                  <View pointerEvents="none">
                    {ov.is_blocked ? (
                      <CalendarOff size={16} color={colors.error} strokeWidth={2} />
                    ) : (
                      <Clock size={16} color={colors.textPrimary} strokeWidth={2} />
                    )}
                  </View>
                </View>
                <View style={styles.overrideInfo}>
                  <Text style={styles.overrideDate}>
                    {format(
                      new Date(ov.override_date + "T00:00"),
                      "EEE, MMM d",
                    )}
                  </Text>
                  <Text style={styles.overrideDetail}>
                    {ov.is_blocked
                      ? "Day off"
                      : `${to12hr(ov.start_time || "09:00:00")} – ${to12hr(ov.end_time || "17:00:00")}`}
                    {ov.reason ? ` · ${ov.reason}` : ""}
                  </Text>
                </View>
                <TouchableOpacity
                  onPress={() => void deleteOverride(ov.id)}
                  style={styles.deleteBtn}
                  activeOpacity={0.7}
                  hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                >
                  <View pointerEvents="none">
                    <Trash2 size={14} color={DIM} strokeWidth={2} />
                  </View>
                </TouchableOpacity>
              </View>
            ))
          )}
        </ScrollView>
      )}

      {/* Add Override Modal */}
      <Modal
        visible={overrideModalOpen}
        transparent
        animationType="slide"
        onRequestClose={() => setOverrideModalOpen(false)}
      >
        <View style={styles.modalOverlay}>
          <Pressable
            style={StyleSheet.absoluteFill}
            onPress={() => setOverrideModalOpen(false)}
          />
          <View style={styles.modalSheet}>
            <View style={styles.modalHandle} />
            <Text style={styles.modalTitle}>Add Override</Text>
            <Text style={styles.modalSub}>
              Block a day off or set custom hours for a specific date.
            </Text>

            {/* Date input */}
            <Text style={styles.fieldLabel}>Date (YYYY-MM-DD)</Text>
            <TextInput
              style={styles.textInput}
              value={overrideDate}
              onChangeText={setOverrideDate}
              placeholder="2026-04-15"
              placeholderTextColor={colors.textTertiary}
              keyboardType="numbers-and-punctuation"
            />

            {/* Type selection */}
            <Text style={styles.fieldLabel}>Type</Text>
            <View style={styles.typeRow}>
              <TouchableOpacity
                style={[
                  styles.typeOption,
                  overrideType === "blocked" && styles.typeOptionActiveRed,
                ]}
                onPress={() => setOverrideType("blocked")}
                activeOpacity={0.8}
              >
                <Text
                  style={[
                    styles.typeOptionTitle,
                    overrideType === "blocked" && { color: LABEL },
                  ]}
                >
                  Day Off
                </Text>
                <Text style={styles.typeOptionSub}>
                  No bookings for this day
                </Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[
                  styles.typeOption,
                  overrideType === "custom" && styles.typeOptionActiveBlue,
                ]}
                onPress={() => setOverrideType("custom")}
                activeOpacity={0.8}
              >
                <Text
                  style={[
                    styles.typeOptionTitle,
                    overrideType === "custom" && { color: LABEL },
                  ]}
                >
                  Custom Hours
                </Text>
                <Text style={styles.typeOptionSub}>
                  Override your regular hours
                </Text>
              </TouchableOpacity>
            </View>

            {overrideType === "custom" ? (
              <View style={styles.customTimeRow}>
                <TextInput
                  style={[styles.textInput, { flex: 1 }]}
                  value={overrideStartTime}
                  onChangeText={setOverrideStartTime}
                  placeholder="09:00"
                  placeholderTextColor={colors.textTertiary}
                />
                <Text style={styles.customTimeDash}>–</Text>
                <TextInput
                  style={[styles.textInput, { flex: 1 }]}
                  value={overrideEndTime}
                  onChangeText={setOverrideEndTime}
                  placeholder="17:00"
                  placeholderTextColor={colors.textTertiary}
                />
              </View>
            ) : null}

            <Text style={styles.fieldLabel}>Reason (optional)</Text>
            <TextInput
              style={styles.textInput}
              value={overrideReason}
              onChangeText={setOverrideReason}
              placeholder="e.g. Holiday, Training"
              placeholderTextColor={colors.textTertiary}
            />

            <TouchableOpacity
              style={[
                styles.modalSaveBtn,
                (!overrideDate || addingOverride) &&
                  styles.modalSaveBtnDisabled,
              ]}
              onPress={() => void addOverride()}
              disabled={!overrideDate || addingOverride}
              activeOpacity={0.85}
            >
              <Text style={styles.modalSaveBtnText}>
                {addingOverride ? "Adding…" : "Add Override"}
              </Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: BG },
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
  loadingWrap: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
  },
  scroll: { flex: 1 },
  scrollContent: { paddingHorizontal: 16, paddingBottom: 40 },

  subtitle: { fontSize: 12, fontFamily: "Satoshi-Regular", color: DIM, marginBottom: 16 },

  // Stats
  statsRow: { flexDirection: "row", gap: 8, marginBottom: 20 },
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

  // Day list
  dayList: { gap: 4, marginBottom: 12 },
  dayRow: {
    flexDirection: "row",
    alignItems: "center",
    borderRadius: 12,
    paddingVertical: 12,
    paddingHorizontal: 16,
    backgroundColor: CARD_BG,
    borderWidth: 1,
    borderColor: BORDER,
  },
  dayRowToday: { borderColor: "rgba(0,214,143,0.25)" },
  dayRowOff: { backgroundColor: "rgba(255,255,255,0.015)" },
  dayShort: {
    fontSize: 14,
    fontWeight: "600",
    fontFamily: "Satoshi-Medium",
    width: 36,
    color: LABEL,
  },
  switchCompact: { transform: [{ scale: 0.85 }], marginHorizontal: 4 },
  timeInfo: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "flex-end",
    gap: 4,
  },
  timeText: {
    fontSize: 13,
    fontWeight: "500",
    fontFamily: "Satoshi-Medium",
    color: LABEL,
    fontVariant: ["tabular-nums"],
  },
  timeDash: { fontSize: 12, color: colors.textTertiary },
  durationText: {
    fontSize: 10,
    color: colors.textTertiary,
    fontVariant: ["tabular-nums"],
    marginLeft: 4,
    marginRight: 4,
  },
  dayOffText: {
    flex: 1,
    textAlign: "right",
    fontSize: 12,
    fontWeight: "500",
    color: colors.textTertiary,
  },
  addText: { fontSize: 12, color: colors.textTertiary },

  // Edit block
  editBlock: {
    backgroundColor: CARD_BG,
    borderWidth: 1,
    borderColor: BORDER,
    borderTopWidth: 0,
    borderBottomLeftRadius: 12,
    borderBottomRightRadius: 12,
    marginTop: -4,
    paddingHorizontal: 16,
    paddingTop: 8,
    paddingBottom: 14,
  },
  timePickersRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    marginBottom: 12,
  },
  timeButton: {
    flex: 1,
    borderRadius: 12,
    paddingVertical: 12,
    alignItems: "center",
    backgroundColor: BORDER,
  },
  timeButtonText: { fontSize: 14, fontWeight: "500", fontFamily: "Satoshi-Medium", color: LABEL },
  toText: { fontSize: 12, color: colors.textTertiary },
  pillSection: { marginBottom: 8 },
  pillLabel: {
    fontSize: 10,
    fontWeight: "600",
    color: MUTED,
    letterSpacing: 0.5,
    marginBottom: 6,
  },
  pillScroll: { flexDirection: "row", gap: 6, paddingRight: 8 },
  pill: {
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 20,
    backgroundColor: BORDER,
  },
  pillSelected: { backgroundColor: "rgba(245,243,239,0.15)" },
  pillText: { fontSize: 13, fontWeight: "500", fontFamily: "Satoshi-Medium", color: MUTED },
  pillTextSelected: { color: "#FFFFFF" },
  saveBtn: {
    marginTop: 6,
    height: 44,
    borderRadius: 10,
    backgroundColor: NOVA_GREEN,
    alignItems: "center",
    justifyContent: "center",
  },
  saveBtnDisabled: { opacity: 0.6 },
  saveBtnText: { fontSize: 15, fontWeight: "600", fontFamily: "Satoshi-Medium", color: BG },

  // Copy button
  copyBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 10,
    borderWidth: 1,
    borderColor: colors.borderMedium,
    backgroundColor: "rgba(255,255,255,0.03)",
    paddingVertical: 10,
    marginBottom: 28,
  },
  copyBtnText: { fontSize: 13, fontWeight: "500", fontFamily: "Satoshi-Medium", color: MUTED },

  // Overrides
  overridesHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 12,
  },
  overridesTitle: { fontSize: 14, fontWeight: "600", fontFamily: "Satoshi-Medium", color: LABEL },
  overridesSub: { fontSize: 11, color: DIM, marginTop: 2 },
  addOverrideBtn: {
    flexDirection: "row",
    alignItems: "center",
    borderRadius: 8,
    borderWidth: 1,
    borderColor: colors.borderMedium,
    backgroundColor: "rgba(255,255,255,0.03)",
    paddingVertical: 6,
    paddingHorizontal: 10,
  },
  addOverrideBtnText: { fontSize: 12, fontWeight: "500", fontFamily: "Satoshi-Medium", color: MUTED },
  emptyOverrides: {
    alignItems: "center",
    paddingVertical: 28,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: BORDER,
    borderStyle: "dashed",
  },
  emptyOverridesText: { fontSize: 12, color: colors.textTertiary, marginTop: 8 },
  overrideRow: {
    flexDirection: "row",
    alignItems: "center",
    borderRadius: 12,
    paddingVertical: 12,
    paddingHorizontal: 16,
    marginBottom: 6,
  },
  overrideRowBlocked: {
    backgroundColor: "rgba(248,113,113,0.04)",
    borderWidth: 1,
    borderColor: "rgba(248,113,113,0.15)",
  },
  overrideRowCustom: {
    backgroundColor: "rgba(148,163,187,0.04)",
    borderWidth: 1,
    borderColor: "rgba(148,163,187,0.15)",
  },
  overrideIcon: {
    width: 32,
    height: 32,
    borderRadius: 8,
    alignItems: "center",
    justifyContent: "center",
    marginRight: 12,
  },
  overrideIconBlocked: { backgroundColor: "rgba(248,113,113,0.1)" },
  overrideIconCustom: { backgroundColor: "rgba(148,163,187,0.1)" },
  overrideInfo: { flex: 1 },
  overrideDate: { fontSize: 14, fontWeight: "500", fontFamily: "Satoshi-Medium", color: LABEL },
  overrideDetail: { fontSize: 11, color: DIM, marginTop: 2 },
  deleteBtn: {
    width: 32,
    height: 32,
    alignItems: "center",
    justifyContent: "center",
  },

  // Modal
  modalOverlay: { flex: 1, justifyContent: "flex-end" },
  modalSheet: {
    backgroundColor: colors.obsidian700,
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    paddingHorizontal: 20,
    paddingBottom: 40,
  },
  modalHandle: {
    alignSelf: "center",
    width: 40,
    height: 4,
    borderRadius: 2,
    backgroundColor: "rgba(255,255,255,0.25)",
    marginTop: 12,
    marginBottom: 16,
  },
  modalTitle: { fontSize: 18, fontWeight: "600", fontFamily: "Satoshi-Medium", color: LABEL },
  modalSub: { fontSize: 12, color: DIM, marginTop: 4, marginBottom: 20 },
  fieldLabel: {
    fontSize: 12,
    color: MUTED,
    marginBottom: 6,
    marginTop: 12,
  },
  textInput: {
    height: 48,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.10)",
    backgroundColor: CARD_BG,
    color: LABEL,
    fontSize: 14,
    paddingHorizontal: 14,
  },
  typeRow: { flexDirection: "row", gap: 8 },
  typeOption: {
    flex: 1,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: BORDER,
    backgroundColor: "rgba(255,255,255,0.03)",
    padding: 12,
  },
  typeOptionActiveRed: {
    borderColor: "rgba(248,113,113,0.2)",
    backgroundColor: "rgba(248,113,113,0.06)",
  },
  typeOptionActiveBlue: {
    borderColor: "rgba(148,163,187,0.2)",
    backgroundColor: "rgba(148,163,187,0.06)",
  },
  typeOptionTitle: { fontSize: 14, fontWeight: "500", fontFamily: "Satoshi-Medium", color: colors.textTertiary },
  typeOptionSub: { fontSize: 11, color: DIM, marginTop: 2 },
  customTimeRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    marginTop: 12,
  },
  customTimeDash: { color: DIM },
  modalSaveBtn: {
    marginTop: 20,
    height: 48,
    borderRadius: 10,
    backgroundColor: NOVA_GREEN,
    alignItems: "center",
    justifyContent: "center",
  },
  modalSaveBtnDisabled: { opacity: 0.4 },
  modalSaveBtnText: { fontSize: 15, fontWeight: "600", fontFamily: "Satoshi-Medium", color: BG },
});
