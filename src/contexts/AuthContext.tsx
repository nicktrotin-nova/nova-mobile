import { createContext, useContext, useEffect, useState, ReactNode } from "react";
import { Alert } from "react-native";
import { supabase } from "../lib/supabase";
import type { User, Session } from "@supabase/supabase-js";
import type { UserRoleRow } from "../types/domain";

type AppRole = "shop_owner" | "barber" | "client";

interface AuthContextType {
  user: User | null;
  session: Session | null;
  loading: boolean;
  barberId: string | null;
  shopId: string | null;
  role: AppRole | null;
  signIn: (email: string, password: string) => Promise<{ error: Error | null }>;
  signOut: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);
  const [barberId, setBarberId] = useState<string | null>(null);
  const [shopId, setShopId] = useState<string | null>(null);
  const [role, setRole] = useState<AppRole | null>(null);

  useEffect(() => {
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, nextSession) => {
      setSession(nextSession);
      setUser(nextSession?.user ?? null);
    });

    supabase.auth.getSession().then(({ data: { session: initialSession } }) => {
      setSession(initialSession);
      setUser(initialSession?.user ?? null);
      if (!initialSession) {
        setBarberId(null);
        setShopId(null);
        setRole(null);
        setLoading(false);
      }
    });

    return () => subscription.unsubscribe();
  }, []);

  useEffect(() => {
    let cancelled = false;

    const loadProfile = async () => {
      if (!user) {
        if (!cancelled) {
          setBarberId(null);
          setShopId(null);
          setRole(null);
          setLoading(false);
        }
        return;
      }

      setLoading(true);

      try {
        const { data: roles, error: rolesError } = await supabase
          .from("user_roles")
          .select("role, shop_id")
          .eq("user_id", user.id);


        const typedRoles = (roles ?? []) as UserRoleRow[];
        const roleSet = new Set(typedRoles.map((r) => r.role));

        let primaryRole: AppRole = "client";
        if (roleSet.has("shop_owner")) primaryRole = "shop_owner";
        else if (roleSet.has("barber")) primaryRole = "barber";

        let resolvedBarberId: string | null = null;
        let resolvedShopId: string | null = null;

        if (roleSet.has("barber") || roleSet.has("shop_owner")) {
          const { data: barberRows } = await supabase
            .from("barbers")
            .select("id, shop_id")
            .eq("user_id", user.id)
            .limit(1);
          const barber = barberRows?.[0] ?? null;
          resolvedBarberId = barber?.id ?? null;
          if (primaryRole === "shop_owner") {
            const ownerRole = typedRoles.find((r) => r.role === "shop_owner");
            resolvedShopId = ownerRole?.shop_id ?? null;
          } else {
            resolvedShopId = barber?.shop_id ?? null;
          }
        }

        if (!cancelled) {
          setRole(primaryRole);
          setBarberId(resolvedBarberId);
          setShopId(resolvedShopId);
          setLoading(false);
        }
      } catch (err) {
        console.error("[Auth] loadProfile failed:", err);
        if (!cancelled) {
          setRole(null);
          setBarberId(null);
          setShopId(null);
          setLoading(false);
          Alert.alert(
            "Connection issue",
            "Couldn't load your profile — rent data may be stale. Pull down to refresh.",
          );
        }
      }
    };

    loadProfile();
    return () => { cancelled = true; };
  }, [user]);

  const signIn = async (email: string, password: string) => {
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    return { error: error as Error | null };
  };

  const signOut = async () => {
    await supabase.auth.signOut();
  };

  return (
    <AuthContext.Provider value={{ user, session, loading, barberId, shopId, role, signIn, signOut }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}