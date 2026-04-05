import { useMemo } from "react";
import { format, parse } from "date-fns";

import { timeToMinutes } from "../utils/formatters";
import { layoutOverlappingAppointments, isFullDayBlock } from "../utils/calendarLayout";
import { firstName } from "../screens/calendar/calendarConstants";
import { GRID_START, GRID_END } from "../screens/calendar/calendarConstants";
import type { AptLayout, BlockLayout } from "../screens/calendar/calendarConstants";
import type { Appointment, Barber, Schedule, Override } from "../types/domain";

interface UseCalendarLayoutParams {
  appointmentsDay: Appointment[];
  selectedBarberId: string | null;
  barberId: string | null;
  schedules: Schedule[];
  selectedDateStr: string;
  mergedOverrides: Override[];
  hourHeight: number;
  gridHeight: number;
  appointmentCountsByDate: Record<string, number>;
  dateStripDates: Date[];
  barbers: Barber[];
  selectedBlock: Override | null;
}

export function useCalendarLayout({
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
}: UseCalendarLayoutParams) {
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

  const laidOutAppointments: AptLayout[] = useMemo(
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

  const blockLayouts: BlockLayout[] = useMemo(() => {
    return timeBlocks.map((o) => ({
      ...o,
      startMin: timeToMinutes((o.start_time as string).slice(0, 5)),
      endMin: timeToMinutes((o.end_time as string).slice(0, 5)),
    }));
  }, [timeBlocks]);

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

  const shadingSlices = useMemo(() => {
    const gridStartMin = GRID_START * 60;
    const gridEndMin = GRID_END * 60;
    if (fullDayBlock) {
      return [{ top: 0, height: gridHeight, key: "full" }];
    }
    if (workingStartMin == null || workingEndMin == null || !daySchedule) {
      return [{ top: 0, height: gridHeight, key: "all" }];
    }
    const slices: { top: number; height: number; key: string }[] = [];
    const y1 = ((workingStartMin - gridStartMin) / 60) * hourHeight;
    const y2 = ((workingEndMin - gridStartMin) / 60) * hourHeight;
    if (y1 > 0) {
      slices.push({ top: 0, height: Math.max(0, y1), key: "b" });
    }
    if (y2 < gridHeight) {
      slices.push({ top: y2, height: Math.max(0, gridHeight - y2), key: "a" });
    }
    return slices;
  }, [fullDayBlock, workingStartMin, workingEndMin, daySchedule, gridHeight, hourHeight]);

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
          (o) => o.barber_id === selectedBarberId && isFullDayBlock(o),
        );
      const isWorkingChip = hasWorkingSchedule && !fullBlockForBarber;
      const dimmed = !isWorkingChip;
      const showDot = isWorkingChip;
      const apptCount = appointmentCountsByDate[dateStr] ?? 0;
      return { dateStr, d, isWorkingChip, dimmed, showDot, apptCount };
    });
  }, [dateStripDates, selectedBarberId, schedules, mergedOverrides, appointmentCountsByDate]);

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

  return {
    overridesForSelectedDay,
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
  };
}
