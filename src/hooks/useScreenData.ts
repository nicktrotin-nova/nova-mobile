import { useState, useEffect, useCallback } from "react";

interface UseScreenDataResult {
  loading: boolean;
  refreshing: boolean;
  onRefresh: () => void;
  /** Call this to re-fetch without showing the loading spinner. */
  refetch: () => Promise<void>;
}

/**
 * Manages the loading → loaded → pull-to-refresh lifecycle.
 *
 * @param fetchFn - Async function that fetches data. Called on mount and on refresh.
 *                  Return value is ignored; set your own state inside.
 * @param deps    - Re-fetch when these change (like useEffect deps).
 * @param enabled - Skip fetching when false (e.g. no barberId yet). Default true.
 */
export function useScreenData(
  fetchFn: () => Promise<void>,
  deps: unknown[],
  enabled = true,
): UseScreenDataResult {
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const stableFetch = useCallback(fetchFn, deps); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!enabled) {
      setLoading(false);
      return;
    }
    let cancelled = false;
    void stableFetch().finally(() => {
      if (!cancelled) setLoading(false);
    });
    return () => {
      cancelled = true;
    };
  }, [stableFetch, enabled]);

  const onRefresh = useCallback(() => {
    setRefreshing(true);
    void stableFetch().finally(() => setRefreshing(false));
  }, [stableFetch]);

  return { loading, refreshing, onRefresh, refetch: stableFetch };
}
