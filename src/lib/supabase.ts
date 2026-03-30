import "react-native-url-polyfill/auto";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL = "https://wgyyuqqqbrjurorplirh.supabase.co";
const SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6IndneXl1cXFxYnJqdXJvcnBsaXJoIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzQ1MTg3MjYsImV4cCI6MjA5MDA5NDcyNn0.zwWg_SCBhMuYqdC3v3ss17paWNDo_R7CzcYzxg-dexc";

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  auth: {
    storage: AsyncStorage,
    autoRefreshToken: true,
    persistSession: true,
    detectSessionInUrl: false,
  },
});
