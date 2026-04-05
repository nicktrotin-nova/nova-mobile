import { useEffect } from "react";
import { supabase } from "../lib/supabase";

interface TableListener {
  table: string;
  /** Postgres change event type. Default: "*" (all). */
  event?: "INSERT" | "UPDATE" | "DELETE" | "*";
  /** Column=value filter, e.g. "barber_id=eq.abc-123". */
  filter?: string;
}

interface UseRealtimeSyncOptions {
  /** Unique channel name prefix — will be suffixed with the key. */
  channelName: string;
  /** Key that gates the subscription (e.g. barberId or shopId). Null = skip. */
  key: string | null;
  /** Tables to listen on. */
  tables: TableListener[];
  /** Called when any listened table changes. */
  onSync: () => void;
  /** Optional polling interval in ms (e.g. 60000 for calendar). */
  pollInterval?: number;
}

/**
 * Subscribe to Supabase realtime changes on one or more tables.
 * Cleans up channel + interval on unmount or when deps change.
 */
export function useRealtimeSync({
  channelName,
  key,
  tables,
  onSync,
  pollInterval,
}: UseRealtimeSyncOptions) {
  useEffect(() => {
    if (!key) return;

    let channel = supabase.channel(`${channelName}-${key}`);

    for (const t of tables) {
      channel = channel.on(
        "postgres_changes",
        {
          event: t.event ?? "*",
          schema: "public",
          table: t.table,
          ...(t.filter ? { filter: t.filter } : {}),
        },
        () => {
          onSync();
        },
      );
    }

    channel.subscribe();

    let intervalId: ReturnType<typeof setInterval> | undefined;
    if (pollInterval && pollInterval > 0) {
      intervalId = setInterval(onSync, pollInterval);
    }

    return () => {
      supabase.removeChannel(channel);
      if (intervalId) clearInterval(intervalId);
    };
  }, [channelName, key, onSync, pollInterval, tables]);
}
