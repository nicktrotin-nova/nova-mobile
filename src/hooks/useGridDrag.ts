import { useState, useCallback, useRef } from "react";
import {
  LayoutAnimation,
  LayoutChangeEvent,
  ScrollView,
} from "react-native";
import * as Haptics from "expo-haptics";

import { supabase } from "../lib/supabase";
import { formatTime12 } from "../utils/formatters";
import { GRID_START, GRID_END } from "../screens/calendar/calendarConstants";
import type { AptLayout, BlockLayout } from "../screens/calendar/calendarConstants";
import type { Appointment, Override } from "../types/domain";

type SlotInfo = { y: number; mins: number; label: string };

interface UseGridDragParams {
  laidOutAppointments: AptLayout[];
  blockLayouts: BlockLayout[];
  hourHeight: number;
  workingStartMin: number | null;
  workingEndMin: number | null;
  gridViewportH: number;
  setGridViewportH: React.Dispatch<React.SetStateAction<number>>;
  setAppointmentsDay: React.Dispatch<React.SetStateAction<Appointment[]>>;
  setMergedOverrides: React.Dispatch<React.SetStateAction<Override[]>>;
  fetchCalendarData: () => Promise<void>;
  gridScrollRef: React.RefObject<ScrollView>;
  onAppointmentTap: (apt: AptLayout) => void;
  onBlockTap: (blk: BlockLayout) => void;
}

export function useGridDrag({
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
  gridScrollRef,
  onAppointmentTap,
  onBlockTap,
}: UseGridDragParams) {
  // ── Drag state ──────────────────────────────────────────────────────────
  const [dragSlot, setDragSlot] = useState<SlotInfo | null>(null);
  const [slotMenu, setSlotMenu] = useState<SlotInfo | null>(null);
  const [scrollLocked, setScrollLocked] = useState(false);
  const [draggingAppt, setDraggingAppt] = useState<AptLayout | null>(null);
  const [draggingY, setDraggingY] = useState(0);
  const [draggingBlock, setDraggingBlock] = useState<BlockLayout | null>(null);
  const [draggingBlockY, setDraggingBlockY] = useState(0);
  const [liftingId, setLiftingId] = useState<string | null>(null);

  // ── Refs ─────────────────────────────────────────────────────────────────
  const dragSlotActiveRef = useRef(false);
  const prevSlotMinsRef = useRef<number | null>(null);
  const autoScrollRef = useRef<number | null>(null);
  const gridScrollYRef = useRef(0);
  const renderFrameRef = useRef<number | null>(null);
  const draggingYRef = useRef(0);
  const longPressTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const isDraggingApptRef = useRef(false);
  const draggingBlockYRef = useRef(0);
  const isDraggingBlockRef = useRef(false);
  const touchedApptRef = useRef<AptLayout | null>(null);
  const touchedBlockRef = useRef<BlockLayout | null>(null);
  const touchStartYRef = useRef(0);
  const didMoveRef = useRef(false);
  const pendingSlotRef = useRef<SlotInfo | null>(null);
  const liftTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastAutoScrollPageY = useRef(0);
  const gridTopPageY = useRef(0);

  // ── Helpers ─────────────────────────────────────────────────────────────
  const pageYToContentY = useCallback((pageY: number): number => {
    return pageY - gridTopPageY.current + gridScrollYRef.current;
  }, []);

  const onGridLayout = useCallback((e: LayoutChangeEvent) => {
    setGridViewportH(e.nativeEvent.layout.height);
    (e.target as any).measureInWindow?.((_x: number, y: number) => {
      gridTopPageY.current = y;
    });
  }, []);

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
    (y: number): { type: "appt"; item: AptLayout } | { type: "block"; item: BlockLayout } | null => {
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
    (y: number): SlotInfo => {
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

  // ── Responder handlers ──────────────────────────────────────────────────
  const onStartShouldSetResponder = useCallback(() => true, []);

  const onMoveShouldSetResponder = useCallback(
    () => isDraggingApptRef.current || isDraggingBlockRef.current || dragSlotActiveRef.current,
    [],
  );

  const onResponderTerminationRequest = useCallback(
    () => {
      if (isDraggingApptRef.current || isDraggingBlockRef.current || dragSlotActiveRef.current) return false;
      return true;
    },
    [],
  );

  const onResponderGrant = useCallback(
    (e: any) => {
      const locY = pageYToContentY(e.nativeEvent.pageY);
      setSlotMenu(null);
      didMoveRef.current = false;
      touchStartYRef.current = locY;

      const hit = findItemAtY(locY);
      touchedApptRef.current = hit?.type === "appt" ? hit.item : null;
      touchedBlockRef.current = hit?.type === "block" ? hit.item : null;

      if (hit?.type === "appt" || hit?.type === "block") {
        const itemId = hit.item.id;
        liftTimerRef.current = setTimeout(() => {
          setLiftingId(itemId);
        }, 150);
      }

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
    },
    [pageYToContentY, findItemAtY, yToSlot, hourHeight],
  );

  const onResponderMove = useCallback(
    (e: any) => {
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
    },
    [pageYToContentY, yToSlot, hourHeight, startAutoScroll],
  );

  const onResponderRelease = useCallback(
    async () => {
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

      // Short tap on appointment
      if (touchedApptRef.current && !didMoveRef.current && !dragSlot) {
        onAppointmentTap(touchedApptRef.current);
        touchedApptRef.current = null;
        touchedBlockRef.current = null;
        return;
      }

      // Short tap on block
      if (touchedBlockRef.current && !didMoveRef.current && !dragSlot) {
        onBlockTap(touchedBlockRef.current);
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
            setDragSlot(null);
            dragSlotActiveRef.current = false;
            prevSlotMinsRef.current = null;
            return;
          }
        }
        setSlotMenu({ ...dragSlot });
        Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
      }
      setDragSlot(null);
      dragSlotActiveRef.current = false;
      prevSlotMinsRef.current = null;
    },
    [
      draggingAppt,
      draggingBlock,
      dragSlot,
      yToSlot,
      stopAutoScroll,
      workingStartMin,
      workingEndMin,
      setAppointmentsDay,
      setMergedOverrides,
      fetchCalendarData,
      onAppointmentTap,
      onBlockTap,
    ],
  );

  const onResponderTerminate = useCallback(() => {
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
    setDragSlot(null);
    dragSlotActiveRef.current = false;
    setDraggingAppt(null);
    setDraggingBlock(null);
    isDraggingApptRef.current = false;
    isDraggingBlockRef.current = false;
    prevSlotMinsRef.current = null;
    touchedApptRef.current = null;
    touchedBlockRef.current = null;
  }, [stopAutoScroll]);

  return {
    // Responder props (spread onto the View)
    responderProps: {
      onStartShouldSetResponder,
      onMoveShouldSetResponder,
      onResponderTerminationRequest,
      onResponderGrant,
      onResponderMove,
      onResponderRelease,
      onResponderTerminate,
    },
    // State for rendering
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
    // Layout callback
    onGridLayout,
  };
}
