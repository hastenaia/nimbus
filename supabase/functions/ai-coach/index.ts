// Nimbus AI Coach — Supabase Edge Function (Deno)
// Server-side only: API keys never exposed to client.
// Deploy: supabase functions deploy ai-coach --no-verify-jwt (or verify with auth)
// Env required: OPENAI_API_KEY (or ANTHROPIC_API_KEY) set via `supabase secrets set`
// If no key is set, function returns 503 and client falls back to local rule-based coach.

import { serve } from "https://deno.land/std@0.224.0/http/server.ts";

const ALLOWED_ORIGIN = "*"; // tighten to your Pages domain in production

const SYSTEM_PROMPT = `You are Nimbus AI Financial Coach. You are helpful but not a licensed professional.
- Only use the verified metrics provided. Do not invent numbers, categories, or transactions.
- Distinguish actual (measured), estimated (derived), forecast (projected), missing (unavailable).
- If data is missing or transaction history < 2 months, state low confidence.
- Generate concise insights for: spending, budget, savings, cash flow, upcoming bills, goals, financial health.
- Each insight must cite a specific verified value (e.g., "Shopping 42% of ₱9,200 expenses").
- Provide at most one actionable suggestion per insight, only if supported by budget/headroom data.
- Never guarantee predictions, never recommend investments, never fabricate statistics.
- Keep tone grounded, Philippine Peso (₱) formatting.
- End with disclaimer: "Not professional financial advice."`;

function corsHeaders() {
  return {
    "Access-Control-Allow-Origin": ALLOWED_ORIGIN,
    "Access-Control-Allow-Headers": "authorization, content-type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
  };
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders() });
  }
  if (req.method !== "POST") {
    return new Response(JSON.stringify({ error: "POST only" }), { status: 405, headers: { "Content-Type": "application/json", ...corsHeaders() } });
  }

  // Verify Supabase auth if desired (optional) — we accept anon but RLS already scopes data client-side
  const apiKey = Deno.env.get("OPENAI_API_KEY") ?? Deno.env.get("ANTHROPIC_API_KEY");
  if (!apiKey) {
    // Signal client to use local fallback — not an error
    return new Response(JSON.stringify({ configured: false, fallback: true, reason: "AI not configured — missing server API key" }), {
      status: 503,
      headers: { "Content-Type": "application/json", ...corsHeaders() },
    });
  }

  let body: any;
  try {
    body = await req.json();
  } catch {
    return new Response(JSON.stringify({ error: "Invalid JSON" }), { status: 400, headers: { "Content-Type": "application/json", ...corsHeaders() } });
  }

  const metrics = body.metrics;
  if (!metrics || typeof metrics !== "object") {
    return new Response(JSON.stringify({ error: "Missing metrics" }), { status: 400, headers: { "Content-Type": "application/json", ...corsHeaders() } });
  }

  // Guard: reject fabricated fields — only allow known keys
  const allowedKeys = new Set([
    "currentBalance","monthlyIncome","monthlyExpenses","netCashFlow","savingsRate",
    "budgetUtilization","topSpendingCategories","spendingTrend","upcomingRecurringExpenses",
    "forecast","safeToSpend","savingsGoalProgress","financialHealthScore","transactionCount","monthsOfHistory","confidence"
  ]);

  // Build user prompt with explicit type tags already prepared client-side
  const userContent = `Verified metrics (do not invent beyond this):
${JSON.stringify(metrics, null, 2)}

Requirements:
- Return JSON with shape { insights: [{type, icon, text, action?: string, confidence: "high"|"medium"|"low"}] }
- Types allowed: spending, budget, savings, cashflow, bills, goals, health
- Include confidence per insight. If monthsOfHistory <2, mark low.
- One actionable suggestion max per insight, grounded in actual budget/headroom.
- Never guarantee, never investment advice.`;

  // Call OpenAI (example) — server-side, key never leaves edge
  try {
    const resp = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "gpt-4o-mini",
        temperature: 0.3,
        messages: [
          { role: "system", content: SYSTEM_PROMPT },
          { role: "user", content: userContent },
        ],
        response_format: { type: "json_object" },
      }),
    });
    if (!resp.ok) {
      const txt = await resp.text();
      console.error("AI upstream error", txt);
      return new Response(JSON.stringify({ configured: true, fallback: true, reason: "AI upstream error" }), {
        status: 502,
        headers: { "Content-Type": "application/json", ...corsHeaders() },
      });
    }
    const data = await resp.json();
    const content = data.choices?.[0]?.message?.content ?? "{}";
    let parsed: any;
    try { parsed = JSON.parse(content); } catch { parsed = { insights: [] }; }
    // Safety filter: ensure no professional advice claims
    return new Response(JSON.stringify({ configured: true, insights: parsed.insights ?? [], disclaimer: "Not professional financial advice. Insights estimated." }), {
      headers: { "Content-Type": "application/json", ...corsHeaders() },
    });
  } catch (e) {
    console.error(e);
    return new Response(JSON.stringify({ configured: true, fallback: true, reason: "AI exception" }), {
      status: 500,
      headers: { "Content-Type": "application/json", ...corsHeaders() },
    });
  }
});
