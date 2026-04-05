import { parse, format, addDays } from "date-fns";
import { timeToMinutes } from "./formatters";
import type { Override } from "../types/domain";

export type AptLayoutResult<T extends { start_time: string; end_time: string }> = T & {
  startMin: number;
  endMin: number;
  col: number;
  colCount: number;
  showOverlapDot: boolean;
};

// ─── Recurring block generation ─────────────────────────────────────────────

/**
 * Generate virtual block instances from recurring overrides within a date range.
 * Skips dates that have explicit non-recurring overrides for the same barber
 * (manual cancellations of recurring blocks).
 */
export function generateRecurringInstances<T extends Override>(
  recurringOverrides: T[],
  rangeStart: string,
  rangeEnd: string,
  existingOverrides: T[],
): T[] {
  const virtual: T[] = [];
  const startDate = parse(rangeStart, "yyyy-MM-dd", new Date());
  const endDate = parse(rangeEnd, "yyyy-MM-dd", new Date());

  for (const rec of recurringOverrides) {
    if (!rec.is_recurring || !rec.recurrence_pattern) continue;
    const originDate = parse(rec.override_date, "yyyy-MM-dd", new Date());
    const originDow = originDate.getDay();
    const originDom = originDate.getDate();

    let d = startDate;
    while (d <= endDate) {
      const dateStr = format(d, "yyyy-MM-dd");
      if (dateStr !== rec.override_date && d >= originDate) {
        let matches = false;
        if (rec.recurrence_pattern === "daily") {
          matches = rec.recurrence_days?.length
            ? rec.recurrence_days.includes(d.getDay())
            : true;
        } else if (rec.recurrence_pattern === "weekly") {
          matches = d.getDay() === originDow;
        } else if (rec.recurrence_pattern === "monthly") {
          matches = d.getDate() === originDom;
        }

        if (matches) {
          const hasSkip = existingOverrides.some(
            (o) =>
              o.barber_id === rec.barber_id &&
              o.override_date === dateStr &&
              !o.is_blocked &&
              !o.is_recurring,
          );
          const hasExplicitBlock = existingOverrides.some(
            (o) =>
              o.barber_id === rec.barber_id &&
              o.override_date === dateStr &&
              o.is_blocked &&
              !o.is_recurring &&
              o.start_time === rec.start_time &&
              o.end_time === rec.end_time,
          );
          if (!hasSkip && !hasExplicitBlock) {
            virtual.push({
              ...rec,
              override_date: dateStr,
              _virtual: true,
              _source_id: rec.id,
              _virtual_date: dateStr,
            });
          }
        }
      }
      d = addDays(d, 1);
    }
  }
  return virtual;
}

// ─── Overlap detection + column layout (graph coloring) ─────────────────────

function intervalsOverlap(
  a: { startMin: number; endMin: number },
  b: { startMin: number; endMin: number },
): boolean {
  return a.startMin < b.endMin && b.startMin < a.endMin;
}

/**
 * Layout overlapping appointments into non-overlapping columns using
 * connected-component DFS + greedy column assignment.
 *
 * Returns each appointment with its column index, total column count
 * for its overlap group, and whether to show an overlap indicator.
 */
export function layoutOverlappingAppointments<T extends { start_time: string; end_time: string }>(
  appointments: T[],
): AptLayoutResult<T>[] {
  const withMin = appointments.map((a) => ({
    ...a,
    startMin: timeToMinutes(a.start_time.slice(0, 5)),
    endMin: timeToMinutes(a.end_time.slice(0, 5)),
  }));

  const n = withMin.length;
  if (n === 0) return [];

  // Build adjacency graph
  const adj: Set<number>[] = Array.from({ length: n }, () => new Set());
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      if (intervalsOverlap(withMin[i], withMin[j])) {
        adj[i].add(j);
        adj[j].add(i);
      }
    }
  }

  // Find connected components via DFS
  const visited = new Array<boolean>(n).fill(false);
  const components: number[][] = [];
  for (let i = 0; i < n; i++) {
    if (visited[i]) continue;
    const comp: number[] = [];
    const stack = [i];
    visited[i] = true;
    while (stack.length) {
      const u = stack.pop()!;
      comp.push(u);
      for (const v of adj[u]) {
        if (!visited[v]) {
          visited[v] = true;
          stack.push(v);
        }
      }
    }
    components.push(comp);
  }

  // Greedy column assignment within each component
  const colByIndex = new Array<number>(n).fill(0);
  const maxColsByIndex = new Array<number>(n).fill(1);

  for (const comp of components) {
    const idxs = [...comp].sort(
      (a, b) =>
        withMin[a].startMin - withMin[b].startMin ||
        withMin[a].endMin - withMin[b].endMin,
    );
    type Active = { end: number; col: number };
    const active: Active[] = [];
    let groupMax = 1;
    for (const idx of idxs) {
      const ap = withMin[idx];
      const still = active.filter((x) => x.end > ap.startMin);
      const used = new Set(still.map((x) => x.col));
      let col = 0;
      while (used.has(col)) col += 1;
      still.push({ end: ap.endMin, col });
      active.length = 0;
      active.push(...still);
      groupMax = Math.max(groupMax, col + 1);
      colByIndex[idx] = col;
    }
    for (const idx of comp) {
      maxColsByIndex[idx] = groupMax;
    }
  }

  return withMin.map((a, i) => ({
    ...a,
    col: colByIndex[i],
    colCount: maxColsByIndex[i],
    showOverlapDot: maxColsByIndex[i] > 1,
  }));
}

// ─── Helpers ────────────────────────────────────────────────────────────────

/** Check if an override represents a full-day block (no start/end time). */
export function isFullDayBlock(o: Override): boolean {
  return (
    o.is_blocked &&
    (o.start_time == null || o.start_time === "") &&
    (o.end_time == null || o.end_time === "")
  );
}
