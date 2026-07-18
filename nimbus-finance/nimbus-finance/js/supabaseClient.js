// Loads the Supabase JS SDK from CDN (see index.html <script> tag which
// exposes it as window.supabase) and wraps it as a singleton client.
import { SUPABASE_URL, SUPABASE_ANON_KEY } from './config.js';

let client = null;

export function getSupabase() {
  if (client) return client;

  if (!window.supabase || !window.supabase.createClient) {
    throw new Error(
      'Supabase SDK not loaded. Make sure the CDN <script> tag in index.html loads before app.js.'
    );
  }

  client = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    auth: {
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: true,
    },
  });

  return client;
}
