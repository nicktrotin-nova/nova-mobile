import { useState, useCallback, useMemo, useRef } from "react";
import { useEffect } from "react";
import { Animated } from "react-native";
import { format, addDays, parse } from "date-fns";

import { supabase } from "../lib/supabase";
import { fetchShopDayAppointments, fetchAppointmentCounts } from "../api/appointments";
import { fetchSchedules, fetchOverridesInRange, fetchRecurringOverrides } from "../api/schedules";
import { fetchShopBarbers } from "../api/barbers";
import { generateRecurringInstances } from "../utils/calendarLayout";
import { useRealtimeSync } from "./useRealtimeSync";
import { mapAppointmentRow } from "../screens/calendar/calendarConstants";
import type { Appointment, Barber, Schedule, Override } from "../types/domain";

interface UseCalendarDataParams {
  shopId: string | null;
  barberId: string | null;
  selectedBarberId: string | null;
  selectedDateStr: string;
  stripRange: { start: string; end: string };
}

export function useCalendarData({
  shopId,
  barberId,
  selectedBarberId,
  selectedDateStr,
  stripRange,
}: UseCalendarDataParams) {
  const [barbers, setBarbers] = useState<Barber[]>([]);
  const [appointmentsDay, setAppointmentsDay] = useState<Appointment[]>([]);
  const [schedules, setSchedules] = useState<Schedule[]>([]);
  const [appointmentCountsByDate, setAppointmentCountsByDate] = useState<Record<string, number>>({});
  const [mergedOverrides, setMergedOverrides] = useState<Override[]>([]);
  const apptCacheRef = useRef<Record<string, Appointment[]>>({});
  const fetchSeqRef = useRef(0);

  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const gridFade = useRef(new Animated.Value(1)).current;

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

        const appts = (apptsRes.data ?? []).map(mapAppointmentRow);
        const existingNonRecurring = (overridesRangeRes.data ?? []) as Override[];
        const recurring = (recurringRes.data ?? []) as Override[];
        const virtuals = generateRecurringInstances(recurring, rangeStart, rangeEnd, existingNonRecurring);
        const counts: Record<string, number> = {};
        for (const row of apptsRangeRes.data ?? []) {
          const d = (row as { appointment_date: string }).appointment_date;
          counts[d] = (counts[d] ?? 0) + 1;
        }

        if (seq !== fetchSeqRef.current) return;
        setBarbers(list);
        setAppointmentsDay(appts);
        setSchedules((schedRes.data ?? []) as Schedule[]);
        setMergedOverrides([...existingNonRecurring, ...virtuals]);
        setAppointmentCountsByDate(counts);
        apptCacheRef.current = { [selectedDateStr]: appts };
        Animated.timing(gridFade, { toValue: 1, duration: 150, useNativeDriver: true }).start();

        barbersLoadedRef.current = true;
        lastBarberIdRef.current = selectedBarberId;
      } else {
        const apptsRes = await fetchShopDayAppointments(supabase, { shopId, date: selectedDateStr });
        if (seq !== fetchSeqRef.current) return;
        const appts = (apptsRes.data ?? []).map(mapAppointmentRow);
        apptCacheRef.current[selectedDateStr] = appts;
        setAppointmentsDay(appts);
        Animated.timing(gridFade, { toValue: 1, duration: 150, useNativeDriver: true }).start();

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

  // Fetch on date/barber change
  useEffect(() => {
    if (!shopId || !selectedBarberId) return;
    fetchCalendarData();
  }, [shopId, selectedBarberId, selectedDateStr, fetchCalendarData]);

  // Realtime sync
  const calTables = useMemo(
    () => [{ table: "appointments", filter: `shop_id=eq.${shopId}` }],
    [shopId],
  );
  const onRealtimeSync = useCallback(() => {
    apptCacheRef.current = {};
    fetchCalendarData();
  }, [fetchCalendarData]);
  useRealtimeSync({
    channelName: "cal",
    key: shopId,
    tables: calTables,
    onSync: onRealtimeSync,
    pollInterval: 60_000,
  });

  return {
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
  };
}
