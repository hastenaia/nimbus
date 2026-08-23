// ============================================================
// CONFIG — fill these in with YOUR Supabase project values.
// Find them in: Supabase Dashboard > Project Settings > API
//
// SECURITY NOTE: the "anon" key is safe to expose in frontend code —
// it is designed for this. Row Level Security (schema.sql) is what
// actually protects each user's data. NEVER put the "service_role"
// key here or anywhere in frontend code.
// ============================================================

export const SUPABASE_URL = "https://ahziihzklejfyflcbxyb.supabase.co";
export const SUPABASE_ANON_KEY = "sb_publishable_4AddeW98W3ffY5vV1NcyGg_UFryFj64";

export const APP_NAME = "Nimbus Finance";
export const DEFAULT_CURRENCY = "PHP";

// Quote rotation interval while the app stays open (ms). 45 min default.
export const QUOTE_ROTATE_MS = 45 * 60 * 1000;

// AI Coach — keys never in client. Enable by deploying supabase/functions/ai-coach with OPENAI_API_KEY.
// Client will try ${SUPABASE_URL}/functions/v1/ai-coach; if 503 (not configured) it falls back locally.
export const AI_COACH_ENABLED = true;
export const AI_COACH_ENDPOINT = `${SUPABASE_URL}/functions/v1/ai-coach`;
