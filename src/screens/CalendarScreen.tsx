import {
  useState,
  useEffect,
  useCallback,
  useMemo,
  useRef,
} from "react";
import {
  View,
  Text,
  ScrollView,
  TouchableOpacity,
  Dimensions,
  StyleSheet,
  ActivityIndicator,
  Animated,
  LayoutChangeEvent,
  LayoutAnimation,
  RefreshControl,
} from "react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { SafeAreaView } from "react-native-safe-area-context";
import { useNavigation, useRoute, useFocusEffect } from "@react-navigation/native";
import type { RouteProp } from "@react-navigation/native";
import type { RootTabParamList } from "../navigation/RootTabParamList";
import { format, addDays, parse } from "date-fns";
import { toZonedTime } from "date-fns-tz";
import { Plus, Repeat } from "lucide-react-native";
import * as Haptics from "expo-haptics";
import BarberPoleStripes from "../components/BarberPoleStripes";
import FullyBookedCelebration, { RainbowPaperOverlay } from "../components/FullyBookedCelebration";
import { supabase } from "../lib/supabase";
import { useAuth } from "../contexts/AuthContext";
import AppointmentDetailSheet from "../components/AppointmentDetailSheet";
import BlockDetailSheet from "../components/BlockDetailSheet";
import CreateBookingSheet from "../components/CreateBookingSheet";
import BlockCreationSheet from "../components/BlockCreationSheet";
import { colors } from "../theme/colors";
import TeamStrip from "../components/calendar/TeamStrip";
import {
  timeToMinutes,
  formatTime12,
  normalizeStatus,
  normalizeService,
} from "../utils/formatters";
import {
  generateRecurringInstances,
  layoutOverlappingAppointments,
  isFullDayBlock,
} from "../utils/calendarLayout";
import { fetchShopDayAppointments, fetchAppointmentCounts } from "../api/appointments";
import { fetchSchedules, fetchOverridesInRange, fetchRecurringOverrides } from "../api/schedules";
import { fetchShopBarbers } from "../api/barbers";
import { SHOP_TZ as TZ } from "../config/shop";
import { useRealtimeSync } from "../hooks/useRealtimeSync";
import type { Appointment, Barber, Schedule, Override } from "../types/domain";

// Calendar maps to shared theme
const COLORS = {
  abyss: colors.obsidian950,
  deep: colors.obsidian900,
  ocean: colors.obsidian800,
  novaGold: colors.nova500,
  steel: colors.textPrimary,
  now: colors.now,
  mist: colors.textSecondary,
  slate: colors.textTertiary,
  warmBg: colors.calendarBody,
  unavailable: colors.calendarUnavailable,
  white: colors.white,
  cardBorder: "rgba(0,0,0,0.06)",
  blockBg: colors.calendarBlockBg,
  red: colors.error,
  amber: colors.warning,
};

// ── Feature flags ─────────────────────────────────────────────────────────────
const SHOW_DATE_BUSYNESS = true; // flip to false to hide appointment counts on date strip

const GRID_START = 5;
const GRID_END = 22;
const DATE_STRIP_LEN = 28;
const DATE_PAST_DAYS = 7;
const TEAM_ITEM_APPROX_WIDTH = 84;
const DATE_CHIP_APPROX_WIDTH = 56;
const GUTTER_W = 48;
const ZOOM_KEY = "nova_calendar_zoom";
const SLOT_KEY = "nova_slot_size";
const CELEBRATED_KEY = "nova_fully_booked_celebrated";


/** Supabase embed often types `services` as an array; runtime is usually a single object. */
function mapAppointmentRow(row: unknown): Appointment {
  const r = row as Appointment & {
    services?: { name: string } | { name: string }[] | null;
  };
  return {
    ...r,
    status: normalizeStatus(r.status),
    services: normalizeService(r.services),
  };
}


interface AptLayout extends Appointment {
  startMin: number;
  endMin: number;
  col: number;
  colCount: number;
  showOverlapDot: boolean;
}

interface BlockLayout extends Override {
  startMin: number;
  endMin: number;
}


function formatTimeRange12Short(start: string, end: string): string {
  const stripAmPm = (s: string) => s.replace(/\s*(AM|PM|am|pm)\s*$/i, "").trim();
  const s = stripAmPm(formatTime12(start));
  const e = stripAmPm(formatTime12(end));
  return `${s} - ${e}`;
}

function hourLineLabel(hour24: number): string {
  if (hour24 === 21) return "10 PM";
  return format(new Date(2000, 0, 1, hour24, 0, 0), "h a");
}



export default function CalendarScreen() {
  const { barberId, shopId } = useAuth();
  const navigation = useNavigation();
  const route = useRoute<RouteProp<RootTabParamList, "Calendar">>();
  const screenRef = useRef<View>(null);
  const teamScrollRef = useRef<ScrollView>(null);
  const dateScrollRef = useRef<ScrollView>(null);
  const gridScrollRef = useRef<ScrollView>(null);
  const paperColumnRef = useRef<View>(null);

  const [zoomLevel, setZoomLevel] = useState(190);
  const [slotSize, setSlotSize] = useState(15);
  const [selectedBarberId, setSelectedBarberId] = useState<string | null>(null);
  const initialToday = useMemo(
    () => format(toZonedTime(new Date(), TZ), "yyyy-MM-dd"),
    [],
  );
  const [selectedDateStr, setselectedDateStr] = useState(initialToday);

  const [barbers, setBarbers] = useState<Barber[]>([]);
  const [appointmentsDay, setAppointmentsDay] = useState<Appointment[]>([]);
  const [schedules, setSchedules] = useState<Schedule[]>([]);
  const [appointmentCountsByDate, setAppointmentCountsByDate] = useState<Record<string, number>>({});
  const [mergedOverrides, setMergedOverrides] = useState<Override[]>([]);
  const apptCacheRef = useRef<Record<string, Appointment[]>>({});
  const fetchSeqRef = useRef(0);

  const [loading, setLoading] = useState(true);
  const [selectedAppointment, setSelectedAppointment] =
    useState<Appointment | null>(null);
  const [showDetail, setShowDetail] = useState(false);
  const [selectedBlock, setSelectedBlock] = useState<Override | null>(null);
  const [showBlockDetail, setShowBlockDetail] = useState(false);
  const [showCreateBooking, setShowCreateBooking] = useState(false);
  const [createBookingTime, setCreateBookingTime] = useState<string | undefined>(undefined);
  const [showBlockCreation, setShowBlockCreation] = useState(false);
  const [blockCreationTime, setBlockCreationTime] = useState<string | undefined>(undefined);
  const [dragSlot, setDragSlot] = useState<{ y: number; mins: number; label: string } | null>(null);
  const dragSlotActiveRef = useRef(false);
  const prevSlotMinsRef = useRef<number | null>(null);
  const [scrollLocked, setScrollLocked] = useState(false);
  const autoScrollRef = useRef<number | null>(null);
  const gridScrollYRef = useRef(0);
  const renderFrameRef = useRef<number | null>(null);

  // Drag-to-reschedule state
  const [draggingAppt, setDraggingAppt] = useState<AptLayout | null>(null);
  const [draggingY, setDraggingY] = useState<number>(0);
  const draggingYRef = useRef<number>(0);
  const longPressTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const isDraggingApptRef = useRef(false);
  const [draggingBlock, setDraggingBlock] = useState<typeof blockLayouts[0] | null>(null);
  const [draggingBlockY, setDraggingBlockY] = useState(0);
  const draggingBlockYRef = useRef(0);
  const isDraggingBlockRef = useRef(false);
  const touchedApptRef = useRef<AptLayout | null>(null);
  const touchedBlockRef = useRef<typeof blockLayouts[0] | null>(null);
  const touchStartYRef = useRef<number>(0);
  const didMoveRef = useRef(false);
  const pendingSlotRef = useRef<{ y: number; mins: number; label: string } | null>(null);
  const [slotMenu, setSlotMenu] = useState<{ y: number; mins: number; label: string } | null>(null);
  const [gridViewportH, setGridViewportH] = useState(
    Dimensions.get("window").height * 0.45,
  );
  const [nowTick, setNowTick] = useState(0);
  const [prefillClient, setPrefillClient] = useState<{ name: string; phone: string } | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [liftingId, setLiftingId] = useState<string | null>(null);
  const liftTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const gridFade = useRef(new Animated.Value(1)).current;
  const gridFadeInScheduled = useRef(false);

  const dateStripDates = useMemo(() => {
    const today = toZonedTime(new Date(), TZ);
    const start = addDays(today, -DATE_PAST_DAYS);
    return Array.from({ length: DATE_STRIP_LEN }, (_, i) => addDays(start, i));
  }, []);

  const stripRange = useMemo(() => {
    const start = format(dateStripDates[0], "yyyy-MM-dd");
    const end = format(
      dateStripDates[DATE_STRIP_LEN - 1],
      "yyyy-MM-dd",
    );
    return { start, end };
  }, [dateStripDates]);

  const hourHeight = (64 * zoomLevel) / 100;
  const gridHeight = (GRID_END - GRID_START) * hourHeight;
  const gridLineMins = useMemo(() => {
    const safeStep = [5, 10, 15, 20, 30, 45, 60].includes(slotSize)
      ? slotSize
      : 15;
    const out: number[] = [];
    const total = (GRID_END - GRID_START) * 60;
    for (let m = 0; m <= total; m += safeStep) {
      out.push(m);
    }
    return out;
  }, [slotSize]);

  useFocusEffect(
    useCallback(() => {
      let cancelled = false;
      (async () => {
        const [storedZoom, storedSlot] = await Promise.all([
          AsyncStorage.getItem(ZOOM_KEY),
          AsyncStorage.getItem(SLOT_KEY),
        ]);
        if (cancelled) return;
        const z = Number(storedZoom);
        const s = Number(storedSlot);
        if (!Number.isNaN(z) && z >= 200) {
          setZoomLevel(Math.max(200, Math.min(400, Math.round(z / 10) * 10)));
        }
        if (!Number.isNaN(s) && [5, 10, 15, 20, 30, 45, 60].includes(s)) {
          setSlotSize(s);
        }
      })();
      return () => { cancelled = true; };
    }, []),
  );

  // Track whether barbers/schedules/overrides have been loaded (don't re-fetch on date change)
  const barbersLoadedRef = useRef(false);
  const lastBarberIdRef = useRef<string | null>(null);

  const fetchCalendarData = useCallback(async () => {
    if (!shopId || !selectedBarberId) {
      setLoading(false);
      return;
    }

    try {
    const seq = ++fetchSeqRef.current;
    const { start: rangeStart, end: rangeEnd } = stripRange;
    const needsFullLoad = !barbersLoadedRef.current || lastBarberIdRef.current !== selectedBarberId;

    if (needsFullLoad) {
      // Full load: barbers, schedules, overrides, appointment counts
      const barbersRes = await fetchShopBarbers(supabase, { shopId });

      let list: Barber[] = (barbersRes.data as Barber[]) ?? [];
      if (barberId) {
        list = [...list].sort((a, b) => {
          if (a.id === barberId) return -1;
          if (b.id === barberId) return 1;
          return 0;
        });
      }

      const barberIds = list.map((b) => b.id);
      if (barberIds.length === 0) {
        setBarbers(list);
        return;
      }

      const [
        apptsRes,
        schedRes,
        overridesRangeRes,
        recurringRes,
        apptsRangeRes,
      ] = await Promise.all([
        fetchShopDayAppointments(supabase, { shopId, date: selectedDateStr }),
        fetchSchedules(supabase, { barberIds }),
        fetchOverridesInRange(supabase, { barberIds, dateFrom: rangeStart, dateTo: rangeEnd }),
        fetchRecurringOverrides(supabase, { barberIds, dateTo: rangeEnd }),
        fetchAppointmentCounts(supabase, { shopId, barberId: selectedBarberId, dateFrom: rangeStart, dateTo: rangeEnd }),
      ]);

      // Batch all state updates together
      const appts = (apptsRes.data ?? []).map(mapAppointmentRow);
      const existingNonRecurring = (overridesRangeRes.data ?? []) as Override[];
      const recurring = (recurringRes.data ?? []) as Override[];
      const virtuals = generateRecurringInstances(recurring, rangeStart, rangeEnd, existingNonRecurring);
      const counts: Record<string, number> = {};
      for (const row of apptsRangeRes.data ?? []) {
        const d = (row as { appointment_date: string }).appointment_date;
        counts[d] = (counts[d] ?? 0) + 1;
      }

      if (seq !== fetchSeqRef.current) return; // stale response — discard
      setBarbers(list);
      setAppointmentsDay(appts);
      setSchedules((schedRes.data ?? []) as Schedule[]);
      setMergedOverrides([...existingNonRecurring, ...virtuals]);
      setAppointmentCountsByDate(counts);
      apptCacheRef.current = { [selectedDateStr]: appts }; // seed cache
      Animated.timing(gridFade, { toValue: 1, duration: 150, useNativeDriver: true }).start();

      barbersLoadedRef.current = true;
      lastBarberIdRef.current = selectedBarberId;
    } else {
      // Light load: always fetch fresh for current day (handles onActionComplete + date change)
      const apptsRes = await fetchShopDayAppointments(supabase, { shopId, date: selectedDateStr });
      if (seq !== fetchSeqRef.current) return; // stale response — discard
      const appts = (apptsRes.data ?? []).map(mapAppointmentRow);
      apptCacheRef.current[selectedDateStr] = appts;
      setAppointmentsDay(appts);
      Animated.timing(gridFade, { toValue: 1, duration: 150, useNativeDriver: true }).start();

      // Prefetch nearby days in background — stagger to avoid hammering DB
      const prefetchDay = async (d: string) => {
        if (apptCacheRef.current[d]) return;
        const res = await fetchShopDayAppointments(supabase, { shopId, date: d });
        apptCacheRef.current[d] = (res.data ?? []).map(mapAppointmentRow);
      };
      const sel = parse(selectedDateStr, "yyyy-MM-dd", new Date());
      void prefetchDay(format(addDays(sel, 1), "yyyy-MM-dd"));
      void prefetchDay(format(addDays(sel, -1), "yyyy-MM-dd"));
      setTimeout(() => {
        for (let i = 2; i <= 5; i++) {
          void prefetchDay(format(addDays(sel, i), "yyyy-MM-dd"));
        }
      }, 500);
    }
    } finally {
      setLoading(false);
    }
  }, [
    shopId,
    barberId,
    selectedBarberId,
    selectedDateStr,
    stripRange.start,
    stripRange.end,
  ]);

  useEffect(() => {
    if (barberId && !selectedBarberId) {
      setSelectedBarberId(barberId);
    }
  }, [barberId, selectedBarberId]);

  useEffect(() => {
    if (!shopId || !selectedBarberId) return;
    fetchCalendarData();
  }, [shopId, selectedBarberId, selectedDateStr, fetchCalendarData]);

  const calTables = useMemo(
    () => [{ table: "appointments", filter: `shop_id=eq.${shopId}` }],
    [shopId],
  );
  const onRealtimeSync = useCallback(() => {
    apptCacheRef.current = {}; // invalidate cache on realtime changes
    fetchCalendarData();
  }, [fetchCalendarData]);
  useRealtimeSync({
    channelName: "cal",
    key: shopId,
    tables: calTables,
    onSync: onRealtimeSync,
    pollInterval: 60_000,
  });

  useEffect(() => {
    const id = setInterval(() => setNowTick((t) => t + 1), 60_000);
    return () => clearInterval(id);
  }, []);

  // "Book again" prefill from ClientsScreen
  useEffect(() => {
    const params = route.params;
    if (params?.prefillClientName) {
      setPrefillClient({
        name: params.prefillClientName,
        phone: params.prefillClientPhone ?? "",
      });
      setShowCreateBooking(true);
      navigation.setParams({ prefillClientName: undefined, prefillClientPhone: undefined } as any);
    }
  }, [route.params, navigation]);

  const todayStr = format(toZonedTime(new Date(), TZ), "yyyy-MM-dd");
  const nowBrisbane = useMemo(
    () => toZonedTime(new Date(), TZ),
    [nowTick],
  );
  const nowMinutes = nowBrisbane.getHours() * 60 + nowBrisbane.getMinutes();

  const overridesForSelectedDay = useMemo(() => {
    return mergedOverrides.filter((o) => o.override_date === selectedDateStr);
  }, [mergedOverrides, selectedDateStr]);

  const fullDayBlock = useMemo(() => {
    return overridesForSelectedDay.some(isFullDayBlock);
  }, [overridesForSelectedDay]);

  const selectedDateParsed = useMemo(
    () => parse(selectedDateStr, "yyyy-MM-dd", new Date()),
    [selectedDateStr],
  );
  const selectedDow = selectedDateParsed.getDay();

  const daySchedule = useMemo(() => {
    if (!selectedBarberId) return null;
    return (
      schedules.find(
        (s) =>
          s.barber_id === selectedBarberId &&
          s.day_of_week === selectedDow &&
          s.is_available,
      ) ?? null
    );
  }, [schedules, selectedBarberId, selectedDow]);

  const workingStartMin = daySchedule
    ? timeToMinutes(daySchedule.start_time.slice(0, 5))
    : null;
  const workingEndMin = daySchedule
    ? timeToMinutes(daySchedule.end_time.slice(0, 5))
    : null;

  const gridAppointments = useMemo(() => {
    if (fullDayBlock) return [];
    return appointmentsDay.filter((a) => a.barber_id === selectedBarberId);
  }, [appointmentsDay, selectedBarberId, fullDayBlock]);

  const laidOutAppointments = useMemo(
    () => layoutOverlappingAppointments(gridAppointments),
    [gridAppointments],
  );

  const timeBlocks = useMemo(() => {
    return overridesForSelectedDay.filter(
      (o) =>
        o.is_blocked &&
        o.start_time &&
        o.end_time &&
        o.barber_id === selectedBarberId,
    ) as BlockLayout[];
  }, [overridesForSelectedDay, selectedBarberId]);

  const blockLayouts = useMemo(() => {
    return timeBlocks.map((o) => ({
      ...o,
      startMin: timeToMinutes((o.start_time as string).slice(0, 5)),
      endMin: timeToMinutes((o.end_time as string).slice(0, 5)),
    }));
  }, [timeBlocks]);

  // ── Easter Egg: "Superstar Mode" — fully booked day celebration ──────────
  const [showCelebration, setShowCelebration] = useState(false);
  const [celebrationMode, setCelebrationMode] = useState<"auto" | "badge">("auto");
  // Persists while viewing a fully booked day — drives star badge + rainbow paper
  const [superstarActive, setSuperstarActive] = useState(false);

  const isFullyBooked = useMemo(() => {
    if (!daySchedule || fullDayBlock) return false;
    if (workingStartMin == null || workingEndMin == null) return false;
    if (gridAppointments.length === 0) return false;

    const totalSlots = Math.floor((workingEndMin - workingStartMin) / 5);
    if (totalSlots <= 0) return false;
    const covered = new Array(totalSlots).fill(false);

    for (const apt of gridAppointments) {
      if (apt.status === "cancelled") continue;
      const aStart = timeToMinutes(apt.start_time.slice(0, 5));
      const aEnd = timeToMinutes(apt.end_time.slice(0, 5));
      for (let m = aStart; m < aEnd; m += 5) {
        const idx = Math.floor((m - workingStartMin) / 5);
        if (idx >= 0 && idx < totalSlots) covered[idx] = true;
      }
    }

    for (const blk of blockLayouts) {
      for (let m = blk.startMin; m < blk.endMin; m += 5) {
        const idx = Math.floor((m - workingStartMin) / 5);
        if (idx >= 0 && idx < totalSlots) covered[idx] = true;
      }
    }

    return covered.every(Boolean);
  }, [daySchedule, fullDayBlock, workingStartMin, workingEndMin, gridAppointments, blockLayouts]);

  // Clear superstar when navigating away from a fully booked day
  useEffect(() => {
    if (!isFullyBooked) {
      setSuperstarActive(false);
    }
  }, [isFullyBooked]);

  // Fire celebration once per barber+date
  useEffect(() => {
    if (!isFullyBooked || !selectedBarberId) return;

    // __DEV__ = true in Expo Go — re-fires every time so you can test it
    if (__DEV__) {
      setCelebrationMode("auto");
      setShowCelebration(true);
      return;
    }

    const key = `${selectedBarberId}:${selectedDateStr}`;
    (async () => {
      const raw = await AsyncStorage.getItem(CELEBRATED_KEY);
      const celebrated: string[] = raw ? JSON.parse(raw) : [];
      if (celebrated.includes(key)) {
        // Already celebrated — just activate persistent state
        setSuperstarActive(true);
        return;
      }

      setCelebrationMode("auto");
      setShowCelebration(true);

      celebrated.push(key);
      const trimmed = celebrated.slice(-100);
      await AsyncStorage.setItem(CELEBRATED_KEY, JSON.stringify(trimmed));
    })();
  }, [isFullyBooked, selectedBarberId, selectedDateStr]);

  const showNowLine =
    selectedDateStr === todayStr &&
    nowMinutes >= GRID_START * 60 &&
    nowMinutes < GRID_END * 60;
  const nowLineTop =
    ((nowMinutes - GRID_START * 60) / 60) * hourHeight;

  const scrollCalendarToNow = useCallback(() => {
    if (!showNowLine) return;
    const target =
      ((nowMinutes - GRID_START * 60) / 60) * hourHeight - gridViewportH / 2;
    setTimeout(() => {
      gridScrollRef.current?.scrollTo({
        y: Math.max(0, target),
        animated: false,
      });
    }, 150);
  }, [showNowLine, nowMinutes, hourHeight, gridViewportH]);

  useEffect(() => {
    if (!loading && showNowLine) {
      scrollCalendarToNow();
    }
  }, [loading, showNowLine, selectedDateStr, scrollCalendarToNow]);

  const teamCenteredRef = useRef(false);
  useEffect(() => {
    if (!barberId || barbers.length === 0 || teamCenteredRef.current) return;
    const idx = barbers.findIndex((b) => b.id === barberId);
    if (idx < 0) return;
    const { width } = Dimensions.get("window");
    const x = Math.max(
      0,
      idx * TEAM_ITEM_APPROX_WIDTH - width / 2 + TEAM_ITEM_APPROX_WIDTH / 2,
    );
    setTimeout(() => {
      teamScrollRef.current?.scrollTo({ x, animated: false });
      teamCenteredRef.current = true;
    }, 100);
  }, [barbers, barberId]);

  const dateCenteredRef = useRef(false);
  useEffect(() => {
    if (dateCenteredRef.current) return;
    const { width } = Dimensions.get("window");
    const x = Math.max(
      0,
      DATE_PAST_DAYS * DATE_CHIP_APPROX_WIDTH -
        width / 2 +
        DATE_CHIP_APPROX_WIDTH / 2,
    );
    setTimeout(() => {
      dateScrollRef.current?.scrollTo({ x, animated: false });
      dateCenteredRef.current = true;
    }, 100);
  }, []);

  const onGridLayout = useCallback((e: LayoutChangeEvent) => {
    setGridViewportH(e.nativeEvent.layout.height);
    // Measure the ScrollView viewport's position on screen (stays fixed)
    (e.target as any).measureInWindow?.((_x: number, y: number) => {
      gridTopPageY.current = y;
    });
  }, []);

  /** Convert pageY → content Y inside the grid.
   *  gridTopPageY = ScrollView viewport top (fixed on screen).
   *  gridScrollYRef = current scroll offset within the ScrollView. */
  const pageYToContentY = useCallback((pageY: number): number => {
    return pageY - gridTopPageY.current + gridScrollYRef.current;
  }, []);

  const shadingSlices = useMemo(() => {
    const gridStartMin = GRID_START * 60;
    const gridEndMin = GRID_END * 60;
    if (fullDayBlock) {
      return [
        {
          top: 0,
          height: gridHeight,
          key: "full",
        },
      ];
    }
    if (
      workingStartMin == null ||
      workingEndMin == null ||
      !daySchedule
    ) {
      return [{ top: 0, height: gridHeight, key: "all" }];
    }
    const slices: { top: number; height: number; key: string }[] = [];
    const y1 = ((workingStartMin - gridStartMin) / 60) * hourHeight;
    const y2 = ((workingEndMin - gridStartMin) / 60) * hourHeight;
    if (y1 > 0) {
      slices.push({ top: 0, height: Math.max(0, y1), key: "b" });
    }
    if (y2 < gridHeight) {
      slices.push({
        top: y2,
        height: Math.max(0, gridHeight - y2),
        key: "a",
      });
    }
    return slices;
  }, [
    fullDayBlock,
    workingStartMin,
    workingEndMin,
    daySchedule,
    gridHeight,
    hourHeight,
  ]);

  const dateStripMeta = useMemo(() => {
    return dateStripDates.map((d) => {
      const dateStr = format(d, "yyyy-MM-dd");
      const dow = d.getDay();
      const hasWorkingSchedule =
        selectedBarberId != null &&
        schedules.some(
          (s) =>
            s.barber_id === selectedBarberId &&
            s.day_of_week === dow &&
            s.is_available,
        );
      const dayOverrides = mergedOverrides.filter(
        (o) => o.override_date === dateStr,
      );
      const fullBlockForBarber =
        selectedBarberId != null &&
        dayOverrides.some(
          (o) =>
            o.barber_id === selectedBarberId && isFullDayBlock(o),
        );
      const isWorkingChip =
        hasWorkingSchedule && !fullBlockForBarber;
      const dimmed = !isWorkingChip;
      const showDot = isWorkingChip;
      const apptCount = appointmentCountsByDate[dateStr] ?? 0;
      return { dateStr, d, isWorkingChip, dimmed, showDot, apptCount };
    });
  }, [dateStripDates, selectedBarberId, schedules, mergedOverrides, appointmentCountsByDate]);

  const firstName = (b: Barber) => {
    const raw = b.display_name?.trim() || b.name.trim();
    return raw.split(/\s+/)[0] || raw;
  };

  const blockSheetBarberName = useMemo(() => {
    if (!selectedBlock) return "";
    const b = barbers.find((x) => x.id === selectedBlock.barber_id);
    if (b) return firstName(b);
    const me = barbers.find((x) => x.id === barberId);
    return me ? firstName(me) : "";
  }, [selectedBlock, barbers, barberId]);

  const activeBarberName = useMemo(() => {
    const bid = selectedBarberId ?? barberId;
    if (!bid) return "";
    const b = barbers.find((x) => x.id === bid);
    return b ? firstName(b) : "";
  }, [selectedBarberId, barberId, barbers]);

  const lastAutoScrollPageY = useRef(0);
  const gridTopPageY = useRef(0);

  const startAutoScroll = useCallback((pageY: number) => {
    lastAutoScrollPageY.current = pageY;
    if (autoScrollRef.current) return;
    const EDGE = 70;
    const MAX_SPEED = 8;
    const tick = () => {
      const py = lastAutoScrollPageY.current;
      const gridTop = gridTopPageY.current;
      const gridBottom = gridTop + gridViewportH;
      let speed = 0;
      if (py < gridTop + EDGE) {
        speed = -MAX_SPEED * Math.max(0, 1 - (py - gridTop) / EDGE);
      } else if (py > gridBottom - EDGE) {
        speed = MAX_SPEED * Math.max(0, 1 - (gridBottom - py) / EDGE);
      }
      if (speed !== 0) {
        const next = Math.max(0, gridScrollYRef.current + speed);
        gridScrollRef.current?.scrollTo({ y: next, animated: false });
        gridScrollYRef.current = next;
      }
      autoScrollRef.current = requestAnimationFrame(tick);
    };
    autoScrollRef.current = requestAnimationFrame(tick);
  }, [gridViewportH]);

  const stopAutoScroll = useCallback(() => {
    if (autoScrollRef.current) {
      cancelAnimationFrame(autoScrollRef.current as number);
      autoScrollRef.current = null;
    }
  }, []);

  const findItemAtY = useCallback(
    (y: number): { type: "appt"; item: AptLayout } | { type: "block"; item: typeof blockLayouts[0] } | null => {
      for (const apt of laidOutAppointments) {
        const aTop = ((apt.startMin - GRID_START * 60) / 60) * hourHeight;
        const aH = Math.max(32, ((apt.endMin - apt.startMin) / 60) * hourHeight);
        if (y >= aTop && y <= aTop + aH && apt.status !== "completed" && apt.status !== "no_show") {
          return { type: "appt", item: apt };
        }
      }
      for (const blk of blockLayouts) {
        const bTop = ((blk.startMin - GRID_START * 60) / 60) * hourHeight;
        const bH = Math.max(32, ((blk.endMin - blk.startMin) / 60) * hourHeight);
        if (y >= bTop && y <= bTop + bH) {
          return { type: "block", item: blk };
        }
      }
      return null;
    },
    [laidOutAppointments, blockLayouts, hourHeight],
  );

  const yToSlot = useCallback(
    (y: number) => {
      const totalMins = GRID_START * 60 + (y / hourHeight) * 60;
      const snapped = Math.floor(totalMins / 15) * 15;
      const clamped = Math.max(GRID_START * 60, Math.min((GRID_END - 1) * 60 + 45, snapped));
      const h = Math.floor(clamped / 60);
      const m = clamped % 60;
      const label = formatTime12(`${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`);
      const snapY = ((clamped - GRID_START * 60) / 60) * hourHeight;
      return { y: snapY, mins: clamped, label };
    },
    [hourHeight],
  );

  if (!shopId || !barberId) {
    return (
      <SafeAreaView style={styles.safe} edges={["top"]}>
        <View style={styles.loadingContainer}>
          <ActivityIndicator color={COLORS.novaGold} size="large" />
        </View>
      </SafeAreaView>
    );
  }

  if (loading && barbers.length === 0) {
    return (
      <SafeAreaView style={styles.safe} edges={["top"]}>
        <View style={styles.loadingContainer}>
          <ActivityIndicator color={COLORS.novaGold} size="large" />
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.safe} edges={["top"]}>
      <View ref={screenRef} style={styles.root} collapsable={false}>
        <TeamStrip
          barbers={barbers}
          selectedBarberId={selectedBarberId}
          onSelectBarber={setSelectedBarberId}
          scrollRef={teamScrollRef}
        />

        <ScrollView
          ref={dateScrollRef}
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.dateStripContent}
          style={styles.dateStrip}
        >
          {dateStripMeta.map(
            ({ dateStr, d, dimmed, showDot, apptCount }) => {
              const sel = dateStr === selectedDateStr;
              const isToday = dateStr === todayStr;
              return (
                <TouchableOpacity
                  key={dateStr}
                  style={[
                    styles.dateChip,
                    sel && styles.dateChipSelected,
                    !sel && isToday && styles.dateChipToday,
                    dimmed && styles.dateChipDim,
                  ]}
                  onPress={() => {
                    if (dateStr === selectedDateStr) return;
                    const cached = apptCacheRef.current[dateStr];
                    if (cached) {
                      // Instant swap — apply cached data + date in same render batch
                      setAppointmentsDay(cached);
                      gridFade.setValue(0.85);
                      setselectedDateStr(dateStr);
                      Animated.timing(gridFade, { toValue: 1, duration: 60, useNativeDriver: true }).start();
                    } else {
                      // Clear stale cards + hide grid instantly, then fetch
                      setAppointmentsDay([]);
                      gridFade.setValue(0);
                      setselectedDateStr(dateStr);
                    }
                    Haptics.selectionAsync();
                  }}
                  activeOpacity={0.85}
                >
                  <Text
                    style={[
                      styles.dateChipDow,
                      sel && styles.dateChipDowSelected,
                      !sel && isToday && styles.dateChipDowToday,
                    ]}
                  >
                    {format(d, "EEE")}
                  </Text>
                  <Text
                    style={[
                      styles.dateChipNum,
                      sel && styles.dateChipNumSelected,
                      !sel && isToday && styles.dateChipNumToday,
                      !sel && !isToday && styles.dateChipNumIdle,
                    ]}
                  >
                    {format(d, "d")}
                  </Text>
                  {showDot ? (
                    <View style={styles.workingDotRow}>
                      <View style={styles.workingDot} />
                      {SHOW_DATE_BUSYNESS && apptCount > 0 && !sel ? (
                        <Text style={styles.dateChipCount}>{apptCount}</Text>
                      ) : null}
                    </View>
                  ) : null}
                </TouchableOpacity>
              );
            },
          )}
        </ScrollView>

        <ScrollView
          ref={gridScrollRef}
          style={styles.gridScroll}
          contentContainerStyle={styles.gridScrollContent}
          onLayout={onGridLayout}
          showsVerticalScrollIndicator={false}
          scrollEnabled={!scrollLocked}
          keyboardShouldPersistTaps="handled"
          onScroll={(e) => { gridScrollYRef.current = e.nativeEvent.contentOffset.y; }}
          scrollEventThrottle={16}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={async () => {
                setRefreshing(true);
                await fetchCalendarData();
                setRefreshing(false);
              }}
              tintColor={COLORS.novaGold}
            />
          }
        >
          <View style={styles.gridRow}>
            <View style={styles.gutterCol}>
              <View style={[styles.gutterInner, { height: gridHeight }]}>
                {Array.from(
                  { length: GRID_END - GRID_START },
                  (_, i) => GRID_START + i,
                ).map((h, i) => (
                  <Text
                    key={h}
                    style={[
                      styles.gutterLabel,
                      { top: iToHourTop(i, hourHeight) },
                    ]}
                  >
                    {hourLineLabel(h)}
                  </Text>
                ))}
                {showNowLine ? (
                  <View
                    style={[
                      styles.nowBadgeWrap,
                      { top: nowLineTop + 6 },
                    ]}
                  >
                    <Text style={styles.nowBadge}>
                      {format(nowBrisbane, "h:mm a")}
                    </Text>
                  </View>
                ) : null}
              </View>
            </View>
            <View style={styles.gridDivider} />
            <View style={styles.calendarCol}>
              <View
                ref={paperColumnRef}
                style={[
                  styles.paperColumn,
                  { height: gridHeight },
                ]}
                onStartShouldSetResponder={() => true}
                onMoveShouldSetResponder={() => isDraggingApptRef.current || isDraggingBlockRef.current || dragSlotActiveRef.current}
                onResponderTerminationRequest={() => {
                  if (isDraggingApptRef.current || isDraggingBlockRef.current || dragSlotActiveRef.current) return false;
                  return true;
                }}
                onResponderGrant={(e) => {
                  const locY = pageYToContentY(e.nativeEvent.pageY);
                  setSlotMenu(null);
                  didMoveRef.current = false;
                  touchStartYRef.current = locY;

                  // Check if touching an appointment or block
                  const hit = findItemAtY(locY);
                  touchedApptRef.current = hit?.type === "appt" ? hit.item : null;
                  touchedBlockRef.current = hit?.type === "block" ? hit.item : null;

                  // Visual lift preview at 150ms
                  if (hit?.type === "appt" || hit?.type === "block") {
                    const itemId = hit.item.id;
                    liftTimerRef.current = setTimeout(() => {
                      setLiftingId(itemId);
                    }, 150);
                  }

                  // Start long-press timer
                  longPressTimerRef.current = setTimeout(() => {
                    setLiftingId(null);
                    if (hit?.type === "appt") {
                      isDraggingApptRef.current = true;
                      const aTop = ((hit.item.startMin - GRID_START * 60) / 60) * hourHeight;
                      setDraggingAppt(hit.item);
                      setDraggingY(aTop);
                      draggingYRef.current = aTop;
                      setScrollLocked(true);
                      prevSlotMinsRef.current = hit.item.startMin;
                      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
                    } else if (hit?.type === "block" && !hit.item._virtual) {
                      isDraggingBlockRef.current = true;
                      const bTop = ((hit.item.startMin - GRID_START * 60) / 60) * hourHeight;
                      setDraggingBlock(hit.item);
                      setDraggingBlockY(bTop);
                      draggingBlockYRef.current = bTop;
                      setScrollLocked(true);
                      prevSlotMinsRef.current = hit.item.startMin;
                      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
                    } else {
                      const slot = yToSlot(locY);
                      setDragSlot(slot);
                      dragSlotActiveRef.current = true;
                      prevSlotMinsRef.current = slot.mins;
                      setScrollLocked(true);
                      Haptics.selectionAsync();
                    }
                  }, 350);
                }}
                onResponderMove={(e) => {
                  const locY = pageYToContentY(e.nativeEvent.pageY);
                  const moved = Math.abs(locY - touchStartYRef.current) > 8;
                  if (moved) didMoveRef.current = true;

                  const slot = yToSlot(locY);
                  const slotChanged = prevSlotMinsRef.current !== slot.mins;

                  if (slotChanged) {
                    prevSlotMinsRef.current = slot.mins;
                    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Rigid);
                  }

                  if (isDraggingApptRef.current) {
                    const snapY = ((slot.mins - GRID_START * 60) / 60) * hourHeight;
                    draggingYRef.current = snapY;
                    if (!renderFrameRef.current) {
                      renderFrameRef.current = requestAnimationFrame(() => {
                        renderFrameRef.current = null;
                        setDraggingY(draggingYRef.current);
                      });
                    }
                    startAutoScroll(e.nativeEvent.pageY);
                    return;
                  }

                  if (isDraggingBlockRef.current) {
                    const snapY = ((slot.mins - GRID_START * 60) / 60) * hourHeight;
                    draggingBlockYRef.current = snapY;
                    if (!renderFrameRef.current) {
                      renderFrameRef.current = requestAnimationFrame(() => {
                        renderFrameRef.current = null;
                        setDraggingBlockY(draggingBlockYRef.current);
                      });
                    }
                    startAutoScroll(e.nativeEvent.pageY);
                    return;
                  }

                  if (dragSlotActiveRef.current) {
                    pendingSlotRef.current = slot;
                    if (!renderFrameRef.current) {
                      renderFrameRef.current = requestAnimationFrame(() => {
                        renderFrameRef.current = null;
                        if (pendingSlotRef.current) {
                          setDragSlot(pendingSlotRef.current);
                        }
                      });
                    }
                    startAutoScroll(e.nativeEvent.pageY);
                  }
                }}
                onResponderRelease={async () => {
                  if (liftTimerRef.current) {
                    clearTimeout(liftTimerRef.current);
                    liftTimerRef.current = null;
                  }
                  setLiftingId(null);
                  if (longPressTimerRef.current) {
                    clearTimeout(longPressTimerRef.current);
                    longPressTimerRef.current = null;
                  }
                  stopAutoScroll();
                  setScrollLocked(false);

                  // Cancel any pending render frame
                  if (renderFrameRef.current) {
                    cancelAnimationFrame(renderFrameRef.current);
                    renderFrameRef.current = null;
                  }

                  // Appointment drop
                  if (isDraggingApptRef.current && draggingAppt) {
                    const slot = yToSlot(draggingYRef.current);
                    const newMins = slot.mins;
                    const oldMins = draggingAppt.startMin;
                    isDraggingApptRef.current = false;

                    if (newMins !== oldMins) {
                      const duration = draggingAppt.endMin - oldMins;
                      const newStartH = Math.floor(newMins / 60);
                      const newStartM = newMins % 60;
                      const newEndMins = newMins + duration;
                      const newEndH = Math.floor(newEndMins / 60);
                      const newEndM = newEndMins % 60;
                      const pad = (n: number) => String(n).padStart(2, "0");
                      const newStart = `${pad(newStartH)}:${pad(newStartM)}:00`;
                      const newEnd = `${pad(newEndH)}:${pad(newEndM)}:00`;

                      // Optimistically update with spring animation
                      LayoutAnimation.configureNext(
                        LayoutAnimation.create(200, LayoutAnimation.Types.easeInEaseOut, LayoutAnimation.Properties.opacity),
                      );
                      const movedId = draggingAppt.id;
                      setAppointmentsDay((prev) =>
                        prev.map((a) =>
                          a.id === movedId
                            ? { ...a, start_time: newStart, end_time: newEnd }
                            : a,
                        ),
                      );

                      setDraggingAppt(null);
                      prevSlotMinsRef.current = null;
                      touchedApptRef.current = null;

                      await supabase
                        .from("appointments")
                        .update({ start_time: newStart, end_time: newEnd })
                        .eq("id", movedId);

                      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
                      fetchCalendarData();
                    } else {
                      setDraggingAppt(null);
                      prevSlotMinsRef.current = null;
                      touchedApptRef.current = null;
                    }
                    return;
                  }

                  // Block drop
                  if (isDraggingBlockRef.current && draggingBlock) {
                    const slot = yToSlot(draggingBlockYRef.current);
                    const newMins = slot.mins;
                    const oldMins = draggingBlock.startMin;
                    isDraggingBlockRef.current = false;

                    if (newMins !== oldMins) {
                      const duration = draggingBlock.endMin - oldMins;
                      const newStartH = Math.floor(newMins / 60);
                      const newStartM = newMins % 60;
                      const newEndMins = newMins + duration;
                      const newEndH = Math.floor(newEndMins / 60);
                      const newEndM = newEndMins % 60;
                      const pad = (n: number) => String(n).padStart(2, "0");
                      const newStart = `${pad(newStartH)}:${pad(newStartM)}:00`;
                      const newEnd = `${pad(newEndH)}:${pad(newEndM)}:00`;

                      // Optimistically update with spring animation
                      LayoutAnimation.configureNext(
                        LayoutAnimation.create(200, LayoutAnimation.Types.easeInEaseOut, LayoutAnimation.Properties.opacity),
                      );
                      const movedId = draggingBlock.id;
                      setMergedOverrides((prev) =>
                        prev.map((o) =>
                          o.id === movedId
                            ? { ...o, start_time: newStart, end_time: newEnd }
                            : o,
                        ),
                      );

                      setDraggingBlock(null);
                      prevSlotMinsRef.current = null;
                      touchedBlockRef.current = null;

                      await supabase
                        .from("availability_overrides")
                        .update({ start_time: newStart, end_time: newEnd })
                        .eq("id", movedId);

                      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
                      fetchCalendarData();
                    } else {
                      setDraggingBlock(null);
                      prevSlotMinsRef.current = null;
                      touchedBlockRef.current = null;
                    }
                    return;
                  }

                  // Short tap on appointment (no drag, no long-press)
                  if (touchedApptRef.current && !didMoveRef.current && !dragSlot) {
                    setSelectedAppointment(touchedApptRef.current);
                    setShowDetail(true);
                    touchedApptRef.current = null;
                    touchedBlockRef.current = null;
                    return;
                  }

                  // Short tap on block
                  if (touchedBlockRef.current && !didMoveRef.current && !dragSlot) {
                    setSelectedBlock(touchedBlockRef.current);
                    setShowBlockDetail(true);
                    touchedBlockRef.current = null;
                    touchedApptRef.current = null;
                    return;
                  }
                  touchedApptRef.current = null;
                  touchedBlockRef.current = null;

                  // Empty slot selection
                  if (dragSlot) {
                    const { mins } = dragSlot;
                    if (workingStartMin != null && workingEndMin != null) {
                      if (mins < workingStartMin || mins >= workingEndMin) {
                        setDragSlot(null); dragSlotActiveRef.current = false;
                        prevSlotMinsRef.current = null;
                        return;
                      }
                    }
                    setSlotMenu({ ...dragSlot });
                    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                  }
                  setDragSlot(null); dragSlotActiveRef.current = false;
                  prevSlotMinsRef.current = null;
                }}
                onResponderTerminate={() => {
                  if (liftTimerRef.current) {
                    clearTimeout(liftTimerRef.current);
                    liftTimerRef.current = null;
                  }
                  setLiftingId(null);
                  if (longPressTimerRef.current) {
                    clearTimeout(longPressTimerRef.current);
                    longPressTimerRef.current = null;
                  }
                  stopAutoScroll();
                  setScrollLocked(false);
                  setDragSlot(null); dragSlotActiveRef.current = false;
                  setDraggingAppt(null);
                  setDraggingBlock(null);
                  isDraggingApptRef.current = false;
                  isDraggingBlockRef.current = false;
                  prevSlotMinsRef.current = null;
                  touchedApptRef.current = null;
                  touchedBlockRef.current = null;
                }}
              >
                {/* Rainbow paper shimmer when fully booked */}
                {superstarActive ? (
                  <View pointerEvents="none" style={StyleSheet.absoluteFill}>
                    <RainbowPaperOverlay />
                  </View>
                ) : null}
                {shadingSlices.map((s) => (
                  <View
                    key={s.key}
                    style={[
                      styles.unavailableShade,
                      {
                        top: s.top,
                        height: s.height,
                      },
                    ]}
                  >
                    <BarberPoleStripes
                      width={Dimensions.get("window").width - GUTTER_W}
                      height={s.height}
                    />
                  </View>
                ))}
                {gridLineMins.map((m, i) => {
                  const top = (m / 60) * hourHeight;
                  const isHour = m % 60 === 0;
                  return (
                    <View
                      key={i}
                      pointerEvents="none"
                      style={[
                        styles.gridHLine,
                        isHour ? styles.gridHLineFull : styles.gridHLineHalf,
                        { top },
                      ]}
                    />
                  );
                })}

                {showNowLine ? (
                  <View
                    pointerEvents="none"
                    style={[styles.nowLine, { top: nowLineTop }]}
                  >
                    <View style={styles.nowDot} />
                  </View>
                ) : null}

                <Animated.View pointerEvents="box-none" style={{ opacity: gridFade, position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 }}>
                {!fullDayBlock && laidOutAppointments.length === 0 && blockLayouts.length === 0 && daySchedule ? (
                  <View
                    pointerEvents="none"
                    style={[
                      styles.emptyState,
                      {
                        top: workingStartMin != null
                          ? ((workingStartMin - GRID_START * 60) / 60) * hourHeight + 40
                          : gridHeight / 3,
                      },
                    ]}
                  >
                    <Text style={styles.emptyStateName}>
                      {activeBarberName ? `${activeBarberName}'s free all day` : "Free all day"}
                    </Text>
                    <Text style={styles.emptyStateText}>
                      Tap + to book or share your link
                    </Text>
                  </View>
                ) : null}

                {!fullDayBlock
                  ? laidOutAppointments.map((apt, idx) => {
                    const top =
                      ((apt.startMin - GRID_START * 60) / 60) *
                        hourHeight;
                    const rawH =
                      ((apt.endMin - apt.startMin) / 60) * hourHeight;
                    const height = Math.max(32, rawH);
                    const colW = 100 / apt.colCount;
                    const leftPct = apt.col * colW;
                    const isCompleted = apt.status === "completed";
                    const isNoshow = apt.status === "no_show";
                    const completed = isCompleted;
                    const noshow = isNoshow;

                    const isBeingDragged = draggingAppt?.id === apt.id;
                    const isLifting = liftingId === apt.id && !isBeingDragged;

                    // Surface micro-stepping: each card gets a subtly different bg
                    const step = Math.min(idx, 5);
                    const cardBgStep = `rgb(${27 + step}, ${29 + step}, ${34 + step})`;

                    return (
                      <View
                        key={apt.id}
                        style={[
                          styles.apptCard,
                          completed && styles.apptCardCompleted,
                          noshow && styles.apptCardNoshow,
                          isBeingDragged && styles.apptCardDragging,
                          isLifting && styles.apptCardLifting,
                          !completed && !noshow && { backgroundColor: cardBgStep },
                          {
                            top: isBeingDragged ? draggingY : top,
                            height,
                            left: `${leftPct + 0.7}%`,
                            width: `${colW - 1.4}%`,
                          },
                        ]}
                      >
                        {apt.showOverlapDot ? (
                          <View style={styles.overlapDot} />
                        ) : null}
                        <Text
                          style={[
                            styles.apptTime,
                            completed && styles.apptTimeCompleted,
                            noshow && styles.apptTimeNoshow,
                          ]}
                        >
                          {formatTimeRange12Short(
                            apt.start_time,
                            apt.end_time,
                          )}
                        </Text>
                        <Text
                          style={[
                            styles.apptClient,
                            completed && styles.apptClientCompleted,
                            noshow && styles.apptClientNoshow,
                          ]}
                          numberOfLines={1}
                        >
                          {apt.client_name || "Walk-in"}
                          {height <= 85 && apt.services?.name ? (
                            <Text style={styles.apptServiceInline}>
                              {"  ·  "}{apt.services.name}
                            </Text>
                          ) : null}
                        </Text>
                        {height > 85 ? (
                          <Text
                            style={[
                              styles.apptService,
                              completed && styles.apptServiceCompleted,
                            ]}
                            numberOfLines={1}
                          >
                            {apt.services?.name ?? "Service"}
                          </Text>
                        ) : null}
                        {apt.price_charged != null ? (
                          <Text style={styles.apptPrice}>
                            ${Number(apt.price_charged).toFixed(0)}
                          </Text>
                        ) : null}
                        {noshow && height > 60 ? (
                          <Text style={styles.noshowLabel}>NO-SHOW</Text>
                        ) : null}
                      </View>
                    );
                  })
                  : null}

                {!fullDayBlock
                  ? blockLayouts.map((blk) => {
                    const top =
                      ((blk.startMin - GRID_START * 60) / 60) * hourHeight;
                    const height = Math.max(
                      32,
                      ((blk.endMin - blk.startMin) / 60) * hourHeight,
                    );
                    const recurring =
                      !!blk.is_recurring || !!blk._virtual;
                    const isBlockDragged = draggingBlock?.id === blk.id;
                    const isBlockLifting = liftingId === blk.id && !isBlockDragged;

                    return (
                      <View
                        key={`${blk.id}-${blk.override_date}-${
                          blk.start_time ?? ""
                        }-${blk._virtual ? "v" : ""}`}
                        style={[
                          styles.blockCard,
                          isBlockDragged && styles.apptCardDragging,
                          isBlockLifting && styles.apptCardLifting,
                          { top: isBlockDragged ? draggingBlockY : top, height },
                        ]}
                      >
                      {recurring ? (
                        <View style={styles.blockRepeatIcon}>
                          <Repeat
                            size={12}
                            color={COLORS.slate}
                            strokeWidth={2}
                          />
                        </View>
                      ) : null}
                      {height < 50 ? (
                        <Text style={styles.blockReasonInline} numberOfLines={1}>
                          {formatTimeRange12Short(
                            blk.start_time as string,
                            blk.end_time as string,
                          )}  {blk.reason?.trim() ? blk.reason : "Blocked"}
                        </Text>
                      ) : (
                        <>
                          <Text style={styles.blockTime}>
                            {formatTimeRange12Short(
                              blk.start_time as string,
                              blk.end_time as string,
                            )}
                          </Text>
                          <Text style={styles.blockReason} numberOfLines={2}>
                            {blk.reason?.trim() ? blk.reason : "Blocked"}
                          </Text>
                        </>
                      )}
                      </View>
                    );
                  })
                  : null}
                </Animated.View>

                {/* Drag selection indicator */}
                {dragSlot ? (
                  <View
                    pointerEvents="none"
                    style={[
                      styles.dragBand,
                      { top: dragSlot.y, height: hourHeight / 4 },
                    ]}
                  >
                    <Text style={styles.dragLabel}>{dragSlot.label}</Text>
                  </View>
                ) : null}

                {/* Slot action menu */}
                {slotMenu ? (
                  <>
                    <View
                      style={[
                        styles.slotMenuBand,
                        { top: slotMenu.y, height: hourHeight / 4 },
                      ]}
                      pointerEvents="none"
                    />
                    <View
                      style={[
                        styles.slotMenu,
                        { top: slotMenu.y + hourHeight / 4 + 4 },
                      ]}
                    >
                      <Text style={styles.slotMenuTime}>{slotMenu.label}</Text>
                      <View style={styles.slotMenuActions}>
                        <TouchableOpacity
                          style={styles.slotMenuBtn}
                          activeOpacity={0.75}
                          onPress={() => {
                            const { mins } = slotMenu;
                            const h = Math.floor(mins / 60);
                            const m = mins % 60;
                            setCreateBookingTime(
                              `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`,
                            );
                            setSlotMenu(null);
                            setShowCreateBooking(true);
                          }}
                        >
                          <Text style={styles.slotMenuBtnTextGreen}>Book</Text>
                        </TouchableOpacity>
                        <View style={styles.slotMenuDivider} />
                        <TouchableOpacity
                          style={styles.slotMenuBtn}
                          activeOpacity={0.75}
                          onPress={() => {
                            const h = Math.floor(slotMenu.mins / 60);
                            const m = slotMenu.mins % 60;
                            setBlockCreationTime(
                              `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`,
                            );
                            setSlotMenu(null);
                            setShowBlockCreation(true);
                          }}
                        >
                          <Text style={styles.slotMenuBtnText}>Block</Text>
                        </TouchableOpacity>
                      </View>
                      <TouchableOpacity
                        onPress={() => setSlotMenu(null)}
                        activeOpacity={0.7}
                        hitSlop={{ top: 8, bottom: 8, left: 12, right: 12 }}
                      >
                        <Text style={styles.slotMenuCancel}>Cancel</Text>
                      </TouchableOpacity>
                    </View>
                  </>
                ) : null}
              </View>
            </View>
          </View>
        </ScrollView>

        <View pointerEvents="box-none" style={styles.fabContainer}>
          {/* Superstar badge — persistent trophy above FAB */}
          {superstarActive ? (
            <TouchableOpacity
              style={styles.superstarBadge}
              activeOpacity={0.8}
              onPress={() => {
                setCelebrationMode("badge");
                setShowCelebration(true);
                Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
              }}
            >
              <Text style={styles.superstarStar}>⭐</Text>
            </TouchableOpacity>
          ) : null}
          <TouchableOpacity
            onPress={() => {
              if (selectedBarberId ?? barberId) {
                setCreateBookingTime(undefined);
                setShowCreateBooking(true);
              }
            }}
            activeOpacity={0.85}
            delayPressIn={0}
            style={styles.fab}
          >
            <View pointerEvents="none">
              <Plus size={26} color={colors.textInverse} strokeWidth={2.5} />
            </View>
          </TouchableOpacity>
        </View>

        <AppointmentDetailSheet
          appointment={selectedAppointment}
          visible={showDetail}
          onClose={() => {
            setShowDetail(false);
            setSelectedAppointment(null);
          }}
          onActionComplete={() => {
            void fetchCalendarData();
          }}
          barbers={barbers}
          shopId={shopId!}
          shopTz={TZ}
        />

        <BlockDetailSheet
          block={selectedBlock}
          visible={showBlockDetail}
          onClose={() => {
            setShowBlockDetail(false);
            setSelectedBlock(null);
          }}
          onActionComplete={() => {
            void fetchCalendarData();
          }}
          barberName={blockSheetBarberName}
        />

        {selectedBarberId ?? barberId ? (
          <>
            <CreateBookingSheet
              visible={showCreateBooking}
              onClose={() => {
                setShowCreateBooking(false);
                setCreateBookingTime(undefined);
                setPrefillClient(null);
              }}
              onBookingCreated={() => {
                void fetchCalendarData();
              }}
              shopId={shopId!}
              barberId={(selectedBarberId ?? barberId)!}
              defaultDate={selectedDateStr}
              defaultTime={createBookingTime}
              initialClientName={prefillClient?.name}
              initialClientPhone={prefillClient?.phone}
              shopTz={TZ}
            />
            <BlockCreationSheet
              visible={showBlockCreation}
              onClose={() => {
                setShowBlockCreation(false);
                setBlockCreationTime(undefined);
              }}
              onCreated={() => {
                void fetchCalendarData();
              }}
              barberId={(selectedBarberId ?? barberId)!}
              barberName={activeBarberName}
              date={selectedDateStr}
              startTime={blockCreationTime}
            />
          </>
        ) : null}

        {/* Easter Egg: Superstar Mode */}
        <FullyBookedCelebration
          visible={showCelebration}
          mode={celebrationMode}
          screenCaptureRef={screenRef}
          onFinished={() => {
            setShowCelebration(false);
            if (isFullyBooked) setSuperstarActive(true);
          }}
        />
      </View>
    </SafeAreaView>
  );
}

function iToHourTop(i: number, hourHeight: number): number {
  return i * hourHeight + 2;
}

const styles = StyleSheet.create({
  safe: {
    flex: 1,
    backgroundColor: COLORS.deep,
  },
  root: {
    flex: 1,
    position: "relative",
    backgroundColor: COLORS.deep,
  },
  loadingContainer: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    backgroundColor: COLORS.deep,
  },
  dateStrip: {
    backgroundColor: COLORS.deep,
    maxHeight: 60,
    flexGrow: 0,
    flexShrink: 0,
  },
  dateStripContent: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: 4,
    paddingHorizontal: 12,
    gap: 8,
  },
  dateChip: {
    flexShrink: 0,
    minWidth: 44,
    paddingVertical: 6,
    paddingHorizontal: 10,
    borderRadius: 10,
    alignItems: "center",
    borderWidth: 1,
    borderColor: "transparent",
  },
  dateChipSelected: {
    backgroundColor: "rgba(245,243,239,0.16)",
    borderColor: "rgba(245,243,239,0.30)",
  },
  dateChipDim: {
    opacity: 0.45,
  },
  dateChipToday: {
    borderColor: "rgba(0,214,143,0.20)",
    borderWidth: 1,
  },
  dateChipDow: {
    fontSize: 10,
    color: COLORS.slate,
    fontWeight: "500",
    fontFamily: "Satoshi-Medium",
    letterSpacing: 0.5,
    textTransform: "uppercase" as const,
  },
  dateChipDowSelected: {
    color: COLORS.steel,
    fontWeight: "700",
    fontFamily: "Satoshi-Bold",
  },
  dateChipDowToday: {
    color: COLORS.slate,
  },
  dateChipNum: {
    fontSize: 15,
    fontWeight: "600",
    fontFamily: "Satoshi-Bold",
    marginTop: 2,
  },
  dateChipNumSelected: {
    color: COLORS.steel,
    fontWeight: "700",
    fontFamily: "Satoshi-Bold",
  },
  dateChipNumToday: {
    color: COLORS.steel,
  },
  dateChipNumIdle: {
    color: colors.textPrimary,
  },
  workingDotRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 3,
    marginTop: 2,
  },
  workingDot: {
    width: 4,
    height: 4,
    borderRadius: 2,
    backgroundColor: colors.nova500,
  },
  dateChipCount: {
    fontSize: 9,
    fontWeight: "600",
    fontFamily: "Satoshi-Bold",
    color: "rgba(245,243,239,0.40)",
    fontVariant: ["tabular-nums"],
  },
  gridScroll: {
    flex: 1,
    backgroundColor: COLORS.warmBg,
  },
  gridScrollContent: {
    paddingBottom: 120,
  },
  gridRow: {
    flexDirection: "row",
    alignSelf: "stretch",
    backgroundColor: COLORS.warmBg,
  },
  gutterCol: {
    width: GUTTER_W,
    backgroundColor: COLORS.deep,
    zIndex: 2,
  },
  gutterInner: {
    position: "relative",
  },
  gutterLabel: {
    position: "absolute",
    right: 8,
    fontSize: 11,
    fontWeight: "500",
    fontFamily: "Satoshi-Medium",
    color: "rgba(245,243,239,0.55)",
    letterSpacing: 0.3,
  },
  nowBadgeWrap: {
    position: "absolute",
    left: 2,
    zIndex: 3,
  },
  nowBadge: {
    fontSize: 10,
    fontWeight: "600",
    fontFamily: "Satoshi-Bold",
    color: COLORS.deep,
    backgroundColor: COLORS.now,
    borderRadius: 4,
    paddingVertical: 2,
    paddingHorizontal: 6,
    overflow: "hidden",
  },
  gridDivider: {
    width: 0,
  },
  calendarCol: {
    flex: 1,
  },
  paperColumn: {
    position: "relative",
    backgroundColor: COLORS.warmBg,
  },
  unavailableShade: {
    position: "absolute",
    left: 0,
    right: 0,
    backgroundColor: colors.calendarUnavailable,
    zIndex: 0,
  },
  gridHLine: {
    position: "absolute",
    left: 0,
    right: 0,
    height: 1,
    zIndex: 1,
  },
  gridHLineFull: {
    backgroundColor: "rgba(0,0,0,0.08)",
  },
  gridHLineHalf: {
    backgroundColor: "rgba(0,0,0,0.04)",
  },
  nowLine: {
    position: "absolute",
    left: 0,
    right: 0,
    height: 1.5,
    backgroundColor: COLORS.now,
    zIndex: 10,
    flexDirection: "row",
    alignItems: "center",
    shadowColor: COLORS.now,
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.25,
    shadowRadius: 3,
    elevation: 6,
  },
  nowDot: {
    position: "absolute",
    left: -4,
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: COLORS.now,
    marginTop: -3,
    shadowColor: COLORS.now,
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.5,
    shadowRadius: 6,
    elevation: 6,
  },
  apptCard: {
    position: "absolute",
    backgroundColor: colors.calendarCardBg,
    borderRadius: 6,
    paddingTop: 5,
    paddingBottom: 6,
    paddingHorizontal: 10,
    zIndex: 5,
    shadowColor: "rgba(0,0,0,0.18)",
    shadowOffset: { width: 0, height: 3 },
    shadowOpacity: 1,
    shadowRadius: 12,
    elevation: 4,
    overflow: "hidden",
    // Catch light — warm white top edge, like light hitting a physical card
    borderTopWidth: 1,
    borderTopColor: "rgba(245,243,239,0.09)",
  },
  apptCardCompleted: {
    backgroundColor: colors.obsidian800,
    borderWidth: 1,
    borderColor: "rgba(0,214,143,0.25)",
    borderRadius: 6,
    shadowColor: COLORS.novaGold,
    shadowOpacity: 0.15,
    shadowOffset: { width: 0, height: 0 },
    shadowRadius: 10,
  },
  apptCardDragging: {
    opacity: 0.9,
    shadowColor: "#00D68F",
    shadowOpacity: 0.3,
    shadowOffset: { width: 0, height: 4 },
    shadowRadius: 16,
    elevation: 12,
    zIndex: 50,
    transform: [{ scale: 1.03 }],
  },
  apptCardNoshow: {
    backgroundColor: colors.calendarCardBg,
    borderRadius: 6,
    borderLeftWidth: 3,
    borderLeftColor: COLORS.red,
  },
  apptCardLifting: {
    transform: [{ scale: 1.025 }],
    shadowColor: "#00D68F",
    shadowOpacity: 0.2,
    shadowOffset: { width: 0, height: 4 },
    shadowRadius: 12,
    elevation: 8,
    zIndex: 40,
  },
  overlapDot: {
    position: "absolute",
    top: 6,
    right: 52,
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: COLORS.amber,
    zIndex: 6,
  },
  apptTime: {
    fontSize: 11,
    fontWeight: "400",
    fontFamily: "Satoshi-Regular",
    color: colors.textSecondary,
    letterSpacing: 0.2,
  },
  apptClient: {
    fontSize: 14,
    fontWeight: "600",
    fontFamily: "Satoshi-Bold",
    color: colors.textPrimary,
    letterSpacing: -0.2,
    marginTop: 1,
    paddingRight: 36,
  },
  apptClientCompleted: {
    color: colors.nova400,
  },
  apptClientNoshow: {
    color: colors.textSecondary,
    textDecorationLine: "line-through",
    textDecorationColor: COLORS.red,
  },
  apptService: {
    fontSize: 11,
    fontWeight: "400",
    fontFamily: "Satoshi-Regular",
    color: "rgba(245,243,239,0.50)",
    marginTop: 1,
  },
  apptServiceInline: {
    fontSize: 11,
    fontWeight: "400",
    fontFamily: "Satoshi-Regular",
    color: "rgba(245,243,239,0.35)",
  },
  apptServiceCompleted: {
    color: colors.textSecondary,
  },
  apptTimeCompleted: {
    color: colors.textSecondary,
  },
  apptTimeNoshow: {
    color: colors.textSecondary,
  },
  apptPrice: {
    position: "absolute",
    top: 8,
    right: 10,
    fontSize: 14,
    fontWeight: "400",
    fontFamily: "DMSerifText-Regular",
    color: COLORS.novaGold,
  },
  noshowLabel: {
    position: "absolute",
    bottom: 8,
    right: 10,
    fontSize: 9,
    fontWeight: "600",
    fontFamily: "Satoshi-Bold",
    color: COLORS.red,
    textTransform: "uppercase",
    letterSpacing: 0.8,
  },
  blockCard: {
    position: "absolute",
    left: 4,
    right: 4,
    backgroundColor: colors.calendarBlockBg,
    borderRadius: 6,
    paddingVertical: 6,
    paddingHorizontal: 10,
    zIndex: 4,
    justifyContent: "center",
    overflow: "hidden",
  },
  dragBand: {
    position: "absolute",
    left: 0,
    right: 0,
    backgroundColor: "rgba(0,214,143,0.10)",
    borderWidth: 1.5,
    borderColor: "rgba(0,214,143,0.40)",
    borderRadius: 6,
    zIndex: 20,
    justifyContent: "center",
    paddingHorizontal: 12,
    shadowColor: "#00D68F",
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.15,
    shadowRadius: 6,
    elevation: 3,
  },
  dragLabel: {
    fontSize: 13,
    fontWeight: "600",
    fontFamily: "Satoshi-Bold",
    color: COLORS.novaGold,
  },
  slotMenuBand: {
    position: "absolute",
    left: 0,
    right: 0,
    backgroundColor: "rgba(0,214,143,0.10)",
    borderWidth: 1,
    borderColor: "rgba(0,214,143,0.30)",
    borderRadius: 6,
    zIndex: 20,
  },
  slotMenu: {
    position: "absolute",
    left: 16,
    right: 16,
    zIndex: 25,
    backgroundColor: colors.obsidian700,
    borderRadius: 14,
    padding: 14,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.25,
    shadowRadius: 16,
    elevation: 10,
  },
  slotMenuTime: {
    fontSize: 14,
    fontWeight: "600",
    fontFamily: "Satoshi-Bold",
    color: colors.textPrimary,
    textAlign: "center",
    marginBottom: 12,
  },
  slotMenuActions: {
    flexDirection: "row",
    borderRadius: 10,
    overflow: "hidden",
    borderWidth: 1,
    borderColor: "rgba(245,243,239,0.08)",
  },
  slotMenuBtn: {
    flex: 1,
    paddingVertical: 12,
    alignItems: "center",
    backgroundColor: "rgba(245,243,239,0.04)",
  },
  slotMenuDivider: {
    width: 1,
    backgroundColor: "rgba(245,243,239,0.08)",
  },
  slotMenuBtnTextGreen: {
    fontSize: 15,
    fontWeight: "600",
    fontFamily: "Satoshi-Bold",
    color: COLORS.novaGold,
  },
  slotMenuBtnText: {
    fontSize: 15,
    fontWeight: "600",
    fontFamily: "Satoshi-Bold",
    color: colors.textPrimary,
  },
  slotMenuCancel: {
    fontSize: 13,
    fontWeight: "500",
    fontFamily: "Satoshi-Medium",
    color: colors.textTertiary,
    textAlign: "center",
    marginTop: 10,
  },
  fabContainer: {
    position: "absolute",
    bottom: 0,
    left: 0,
    right: 0,
    top: 0,
    zIndex: 99,
    justifyContent: "flex-end",
    alignItems: "flex-end",
    paddingBottom: 28,
    paddingRight: 20,
  },
  fab: {
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: colors.nova500,
    alignItems: "center",
    justifyContent: "center",
    shadowColor: colors.nova500,
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.35,
    shadowRadius: 14,
    elevation: 8,
  },
  superstarBadge: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: "rgba(19,21,24,0.9)",
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 12,
    borderWidth: 1.5,
    borderColor: "rgba(0,214,143,0.35)",
    shadowColor: "#00D68F",
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.3,
    shadowRadius: 10,
    elevation: 6,
  },
  superstarStar: {
    fontSize: 22,
  },
  blockRepeatIcon: {
    position: "absolute",
    top: 8,
    right: 10,
  },
  blockTime: {
    fontSize: 11,
    fontWeight: "400",
    fontFamily: "Satoshi-Regular",
    color: colors.textTertiary,
    letterSpacing: 0.2,
  },
  blockReason: {
    fontSize: 13,
    fontWeight: "500",
    fontFamily: "Satoshi-Medium",
    color: colors.textPrimary,
    marginTop: 2,
    paddingRight: 28,
  },
  emptyState: {
    position: "absolute",
    left: 0,
    right: 0,
    alignItems: "center",
    zIndex: 0,
  },
  emptyStateName: {
    fontSize: 17,
    fontWeight: "500",
    fontFamily: "Satoshi-Medium",
    color: "rgba(0,0,0,0.30)",
  },
  emptyStateText: {
    fontSize: 13,
    fontWeight: "400",
    fontFamily: "Satoshi-Regular",
    color: "rgba(0,0,0,0.20)",
    marginTop: 6,
  },
  blockReasonInline: {
    fontSize: 12,
    fontWeight: "500",
    fontFamily: "Satoshi-Medium",
    color: colors.textPrimary,
    paddingRight: 28,
  },
});
