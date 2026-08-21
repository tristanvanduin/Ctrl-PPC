import { type SupabaseClient } from "@supabase/supabase-js";
import { createBrowserClient } from "@supabase/ssr";
import { isDemoMode } from "./demo/demo-mode";
import { createDemoSupabase } from "./demo/mock-supabase";
import { demoRows } from "./demo/demo-rows";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

/**
 * createBrowserClient en niet createClient, en dat verschil blokkeerde fase 5.
 *
 * createClient uit supabase-js bewaart de sessie in localStorage. De middleware leest hem met
 * createServerClient uit @supabase/ssr, en die kijkt in COOKIES. Die twee praten niet met elkaar.
 *
 * Met O1_AUTH_ENFORCED=true had dat dit opgeleverd: iemand logt in, de sessie gaat naar
 * localStorage, de volgende navigatie komt langs de middleware, die vindt geen cookie en stuurt
 * hem terug naar /login. Oneindige lus, en geen foutmelding die uitlegt waarom -- de login zelf
 * slaagde immers.
 *
 * createBrowserClient schrijft dezelfde sessie naar cookies. Daarmee zien de browser (voor zijn
 * PostgREST-queries) en de server (voor de middleware en de routes) hetzelfde. Het is verder
 * dezelfde client: dezelfde methoden, hetzelfde gedrag.
 */
const realClient: SupabaseClient | null =
  supabaseUrl && supabaseAnonKey
    ? (createBrowserClient(supabaseUrl, supabaseAnonKey) as SupabaseClient)
    : null;

/**
 * Supabase client singleton.
 * - Normaal: de echte client (of null als env-vars ontbreken; consumers guarden met `if (!supabase)`).
 * - In demo-mode (?demo=1 / NEXT_PUBLIC_DEMO_MODE): een mock-client die curated demo-rijen serveert
 *   voor de demo-klant en voor élke andere klant naar de echte client delegeert. Zo blijven echte
 *   klanten ongemoeid en werkt de demo-klant zonder backend/keys.
 */
export const supabase: SupabaseClient | null =
  isDemoMode() ? createDemoSupabase(realClient, demoRows()) : realClient;

// ── Type definitions for our tables ────────────────────────────────────────

export interface Script {
  id: string;
  title: string;
  description: string | null;
  code: string;
  tags: string[];
  created_at: string;
  updated_at: string;
}

export interface ClientNote {
  id: string;
  client_id: string;
  title: string | null;
  content: string;
  /** true = to-do met afvinkstatus, false = vrije notitie (`done` is dan betekenisloos). */
  is_todo: boolean;
  done: boolean;
  created_at: string;
  updated_at: string;
}

export interface KpiSnapshot {
  conversions: number;
  revenue: number;
  adSpend: number;
  cpa: number;
  roas: number;
}

export interface TaskCompletion {
  id: string;
  client_id: string;
  task_id: string;
  cadence: string;
  task_text: string;
  completed_at: string;
  kpi_snapshot: KpiSnapshot;
  reminder_days: number;
  reminder_dismissed: boolean;
  followup_kpi: KpiSnapshot | null;
  followup_checked_at: string | null;
}
