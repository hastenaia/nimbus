import { getSupabase } from './supabaseClient.js';
import { QUOTE_ROTATE_MS } from './config.js';
import { toast } from './utils.js';

let QUOTES = [];
let history = [];
let currentQuote = null;
let rotateTimer = null;
let favoriteIds = new Set();

async function loadQuotesData() {
  if (QUOTES.length) return QUOTES;
  const res = await fetch('./data/quotes.json');
  QUOTES = await res.json();
  return QUOTES;
}

function pickRandom(excludeId) {
  const pool = QUOTES.filter((q) => q.id !== excludeId);
  return pool[Math.floor(Math.random() * pool.length)];
}

function seededDailyQuote() {
  // Deterministic "quote of the day" seeded by today's date so it only
  // changes once every 24h, but still looks random.
  const today = new Date().toISOString().slice(0, 10);
  let hash = 0;
  for (const ch of today) hash = (hash * 31 + ch.charCodeAt(0)) >>> 0;
  return QUOTES[hash % QUOTES.length];
}

export async function initQuoteCard(user) {
  await loadQuotesData();
  await loadFavorites(user);

  const stored = sessionStorage.getItem('nimbus_last_quote_date');
  const todayStr = new Date().toISOString().slice(0, 10);

  if (stored !== todayStr) {
    currentQuote = seededDailyQuote();
    sessionStorage.setItem('nimbus_last_quote_date', todayStr);
  } else {
    currentQuote = seededDailyQuote();
  }
  history = [currentQuote.id];
  renderQuote();

  clearInterval(rotateTimer);
  rotateTimer = setInterval(() => nextQuote(), QUOTE_ROTATE_MS);

  document.getElementById('quote-refresh-btn')?.addEventListener('click', () => nextQuote());
  document.getElementById('quote-fav-btn')?.addEventListener('click', () => toggleFavorite(user));
}

export function nextQuote() {
  let q = pickRandom(currentQuote?.id);
  // never repeat consecutively (already guaranteed by exclude), keep short history
  currentQuote = q;
  history.push(q.id);
  if (history.length > 20) history.shift();
  renderQuote();
}

function renderQuote() {
  const textEl = document.getElementById('quote-text');
  const authorEl = document.getElementById('quote-author');
  const favBtn = document.getElementById('quote-fav-btn');
  if (!textEl || !currentQuote) return;

  textEl.classList.remove('quote-fade');
  void textEl.offsetWidth; // restart animation
  textEl.classList.add('quote-fade');
  textEl.textContent = `“${currentQuote.text}”`;
  if (authorEl) authorEl.textContent = currentQuote.author ? `— ${currentQuote.author} · ${currentQuote.category}` : currentQuote.category;
  if (favBtn) favBtn.textContent = favoriteIds.has(currentQuote.id) ? '★' : '☆';
}

async function loadFavorites(user) {
  if (!user) return;
  try {
    const supabase = getSupabase();
    const { data, error } = await supabase
      .from('favorite_quotes')
      .select('quote_id')
      .eq('user_id', user.id);
    if (!error && data) favoriteIds = new Set(data.map((d) => d.quote_id));
  } catch (e) {
    console.warn('Could not load favorite quotes', e);
  }
}

async function toggleFavorite(user) {
  if (!user || !currentQuote) return;
  const supabase = getSupabase();
  if (favoriteIds.has(currentQuote.id)) {
    favoriteIds.delete(currentQuote.id);
    await supabase.from('favorite_quotes').delete().eq('user_id', user.id).eq('quote_id', currentQuote.id);
  } else {
    favoriteIds.add(currentQuote.id);
    await supabase.from('favorite_quotes').insert({
      user_id: user.id,
      quote_id: currentQuote.id,
      quote_text: currentQuote.text,
      author: currentQuote.author,
      category: currentQuote.category,
    });
    toast('Added to favorite quotes');
  }
  renderQuote();
}

// --- Contextual "special" quotes shown as toasts on key events ---
const SPECIAL = {
  income: [
    "Nice — that income just widened your gap between spend and save.",
    "Logged. Every deposit is a brick in the wall of your freedom.",
  ],
  expense: [
    "Logged. Awareness is the first step to a stronger budget.",
    "Tracked — small logs like this build the full picture.",
  ],
  goalMilestone: [
    "Milestone reached! Your goal just got a lot more real.",
    "Look at that progress bar move. Keep going.",
  ],
  monthStart: [
    "New month, clean slate. Set one intention for your money this month.",
    "A fresh month is a fresh chance to beat last month's savings rate.",
  ],
};

export function showSpecialQuote(kind) {
  const list = SPECIAL[kind];
  if (!list) return;
  toast(list[Math.floor(Math.random() * list.length)]);
}

export async function getFavoriteQuotes(user) {
  if (!user) return [];
  const supabase = getSupabase();
  const { data } = await supabase
    .from('favorite_quotes')
    .select('*')
    .eq('user_id', user.id)
    .order('created_at', { ascending: false });
  return data || [];
}
