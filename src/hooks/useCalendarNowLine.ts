import { useState, useEffect, useCallback, useMemo, useRef } from "react";
import { ScrollView } from "react-native";
import { toZonedTime } from "date-fns-tz";
import { format } from "date-fns";

import { SHOP_TZ as TZ } from "../config/shop";
import { GRID_START, GRID_END } from "../screens/calendar/calendarConstants";

interface UseCalendarNowLineParams {
  selectedDateStr: string;
  hourHeight: number;
  gridViewportH: number;
  gridScrollRef: React.RefObject<ScrollView>;
  loading: boolean;
}

export function useCalendarNowLine({
  selectedDateStr,
  hourHeight,
  gridViewportH,
  gridScrollRef,
  loading,
}: UseCalendarNowLineParams) {
  const [nowTick, setNowTick] = useState(0);

  useEffect(() => {
    const id = setInterval(() => setNowTick((t) => t + 1), 60_000);
    return () => clearInterval(id);
  }, []);

  const todayStr = format(toZonedTime(new Date(), TZ), "yyyy-MM-dd");
  const nowBrisbane = useMemo(
    () => toZonedTime(new Date(), TZ),
    [nowTick],
  );
  const nowMinutes = nowBrisbane.getHours() * 60 + nowBrisbane.getMinutes();

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

  // Auto-scroll to now on load
  const scrolledRef = useRef(false);
  useEffect(() => {
    if (!loading && showNowLine && !scrolledRef.current) {
      scrollCalendarToNow();
      scrolledRef.current = true;
    }
    // Re-scroll when date changes back to today
    if (selectedDateStr === todayStr && !loading && showNowLine) {
      scrollCalendarToNow();
    }
  }, [loading, showNowLine, selectedDateStr, scrollCalendarToNow]);

  return {
    todayStr,
    nowBrisbane,
    nowMinutes,
    showNowLine,
    nowLineTop,
  };
}
