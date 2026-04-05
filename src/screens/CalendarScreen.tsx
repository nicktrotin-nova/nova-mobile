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
  RefreshControl,
} from "react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { SafeAreaView } from "react-native-safe-area-context";
import { useNavigation, useRoute, useFocusEffect } from "@react-navigation/native";
import type { RouteProp } from "@react-navigation/native";
import type { RootTabParamList } from "../navigation/RootTabParamList";
import { format, addDays } from "date-fns";
import { toZonedTime } from "date-fns-tz";
import { Plus, Repeat } from "lucide-react-native";
import * as Haptics from "expo-haptics";
import BarberPoleStripes from "../components/BarberPoleStripes";
import FullyBookedCelebration, { RainbowPaperOverlay } from "../components/FullyBookedCelebration";
import { useAuth } from "../contexts/AuthContext";
import AppointmentDetailSheet from "../components/AppointmentDetailSheet";
import BlockDetailSheet from "../components/BlockDetailSheet";
import CreateBookingSheet from "../components/CreateBookingSheet";
import BlockCreationSheet from "../components/BlockCreationSheet";
import { colors } from "../theme/colors";
import TeamStrip from "../components/calendar/TeamStrip";
import { SHOP_TZ as TZ } from "../config/shop";
import { useCalendarData } from "../hooks/useCalendarData";
import { useCalendarLayout } from "../hooks/useCalendarLayout";
import { useCalendarNowLine } from "../hooks/useCalendarNowLine";
import { useGridDrag } from "../hooks/useGridDrag";
import type { Appointment, Barber, Schedule, Override } from "../types/domain";
import {
  COLORS,
  SHOW_DATE_BUSYNESS,
  GRID_START,
  GRID_END,
  DATE_STRIP_LEN,
  DATE_PAST_DAYS,
  TEAM_ITEM_APPROX_WIDTH,
  GUTTER_W,
  ZOOM_KEY,
  SLOT_KEY,
  CELEBRATED_KEY,
  formatTimeRange12Short,
  hourLineLabel,
  iToHourTop,
} from "./calendar/calendarConstants";
import { styles } from "./calendar/calendarStyles";
import type { AptLayout, BlockLayout } from "./calendar/calendarConstants";



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
  const [selectedBarberId, setSelectedBarberId] = useState<string | null>(barberId);
  const initialToday = useMemo(
    () => format(toZonedTime(new Date(), TZ), "yyyy-MM-dd"),
    [],
  );
  const [selectedDateStr, setselectedDateStr] = useState(initialToday);

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

  const {
    barbers,
    appointmentsDay,
    setAppointmentsDay,
    schedules,
    appointmentCountsByDate,
    mergedOverrides,
    setMergedOverrides,
    apptCacheRef,
    loading,
    refreshing,
    setRefreshing,
    gridFade,
    fetchCalendarData,
  } = useCalendarData({
    shopId,
    barberId,
    selectedBarberId,
    selectedDateStr,
    stripRange,
  });
  const [selectedAppointment, setSelectedAppointment] =
    useState<Appointment | null>(null);
  const [showDetail, setShowDetail] = useState(false);
  const [selectedBlock, setSelectedBlock] = useState<Override | null>(null);
  const [showBlockDetail, setShowBlockDetail] = useState(false);
  const [showCreateBooking, setShowCreateBooking] = useState(false);
  const [createBookingTime, setCreateBookingTime] = useState<string | undefined>(undefined);
  const [showBlockCreation, setShowBlockCreation] = useState(false);
  const [blockCreationTime, setBlockCreationTime] = useState<string | undefined>(undefined);
  const [prefillClient, setPrefillClient] = useState<{ name: string; phone: string } | null>(null);
  const [gridViewportH, setGridViewportH] = useState(
    Dimensions.get("window").height * 0.45,
  );

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

  // Default to logged-in barber once barbers load — fall back to first barber if auth barberId isn't in the shop list
  useEffect(() => {
    if (barbers.length === 0) return;
    if (selectedBarberId && barbers.some((b) => b.id === selectedBarberId)) return;
    const match = barbers.find((b) => b.id === barberId);
    setSelectedBarberId(match ? match.id : barbers[0].id);
  }, [barbers, barberId]);

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

  const {
    todayStr,
    nowBrisbane,
    showNowLine,
    nowLineTop,
  } = useCalendarNowLine({
    selectedDateStr,
    hourHeight,
    gridViewportH,
    gridScrollRef: gridScrollRef as React.RefObject<ScrollView>,
    loading,
  });

  const {
    fullDayBlock,
    daySchedule,
    workingStartMin,
    workingEndMin,
    gridAppointments,
    laidOutAppointments,
    blockLayouts,
    isFullyBooked,
    shadingSlices,
    dateStripMeta,
    blockSheetBarberName,
    activeBarberName,
  } = useCalendarLayout({
    appointmentsDay,
    selectedBarberId,
    barberId,
    schedules,
    selectedDateStr,
    mergedOverrides,
    hourHeight,
    gridHeight,
    appointmentCountsByDate,
    dateStripDates,
    barbers,
    selectedBlock,
  });

  const onAppointmentTap = useCallback((apt: AptLayout) => {
    setSelectedAppointment(apt);
    setShowDetail(true);
  }, []);
  const onBlockTap = useCallback((blk: BlockLayout) => {
    setSelectedBlock(blk);
    setShowBlockDetail(true);
  }, []);

  const {
    responderProps,
    draggingAppt,
    draggingY,
    draggingBlock,
    draggingBlockY,
    dragSlot,
    slotMenu,
    setSlotMenu,
    scrollLocked,
    liftingId,
    gridScrollYRef,
    onGridLayout,
  } = useGridDrag({
    laidOutAppointments,
    blockLayouts,
    hourHeight,
    workingStartMin,
    workingEndMin,
    gridViewportH,
    setGridViewportH,
    setAppointmentsDay,
    setMergedOverrides,
    fetchCalendarData,
    gridScrollRef: gridScrollRef as React.RefObject<ScrollView>,
    onAppointmentTap,
    onBlockTap,
  });

  // ── Easter Egg: "Superstar Mode" — fully booked day celebration ──────────
  const [showCelebration, setShowCelebration] = useState(false);
  const [celebrationMode, setCelebrationMode] = useState<"auto" | "badge">("auto");
  const [superstarActive, setSuperstarActive] = useState(false);

  useEffect(() => {
    if (!isFullyBooked) {
      setSuperstarActive(false);
    }
  }, [isFullyBooked]);

  useEffect(() => {
    if (!isFullyBooked || !selectedBarberId) return;

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

  // Today is index 0 (left edge) — no scroll needed on mount

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
                {...responderProps}
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

