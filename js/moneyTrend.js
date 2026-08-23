// Money Trend — groups real Supabase transactions by date/month for the selected range.
// Derived-only: no fake data, zero-fills gaps so the line chart stays continuous.

import { isoLocal } from './utils.js';

const RANGE_CONFIG = {
  '7D':  { days: 7,  bucket: 'day' },
  '30D': { days: 30, bucket: 'day' },
  '3M':  { days: 90,  bucket: 'month' },
  '6M':  { days: 180, bucket: 'month' },
  '1Y':  { days: 365, bucket: 'month' },
};

export function isValidRange(r) { return r in RANGE_CONFIG; }

function pad(n) { return String(n).padStart(2, '0'); }

function isoDate(d) {
  return isoLocal(d);
}

function monthKeyStr(d) {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}`;
}

function labelForDay(d) {
  // "Aug 20" — short month + day (local)
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

function labelForMonth(d, range) {
  // 1Y: always include 2-digit year to avoid duplicate Aug labels (Aug '25 vs Aug '26)
  if (range === '1Y') {
    return d.toLocaleDateString('en-US', { month: 'short', year: '2-digit' }).replace(',', '');
  }
  const now = new Date();
  if (d.getFullYear() === now.getFullYear()) {
    return d.toLocaleDateString('en-US', { month: 'short' });
  }
  return d.toLocaleDateString('en-US', { month: 'short', year: 'numeric' });
}

/**
 * Build bucket keys covering [start, end] inclusive.
 * bucket: 'day' -> each YYYY-MM-DD, 'month' -> each YYYY-MM
 */
function buildBuckets(start, end, bucket, range) {
  const keys = [];
  if (bucket === 'day') {
    const cur = new Date(start);
    cur.setHours(0, 0, 0, 0);
    const stop = new Date(end);
    stop.setHours(0, 0, 0, 0);
    while (cur <= stop) {
      keys.push({ key: isoDate(cur), label: labelForDay(cur), date: new Date(cur) });
      cur.setDate(cur.getDate() + 1);
    }
  } else {
    const cur = new Date(start.getFullYear(), start.getMonth(), 1);
    const stop = new Date(end.getFullYear(), end.getMonth(), 1);
    while (cur <= stop) {
      keys.push({ key: monthKeyStr(cur), label: labelForMonth(cur, range), date: new Date(cur) });
      cur.setMonth(cur.getMonth() + 1);
    }
  }
  return keys;
}

/**
 * @param {Array} transactions - raw rows from Supabase {type, amount, occurred_on}
 * @param {string} range - '7D' | '30D' | '3M' | '6M' | '1Y'
 * @returns {{ range: string, bucket: string, points: Array<{label, key, income, expense, net}>, startIso: string, endIso: string }}
 */
export function getMoneyTrendSeries(transactions, range = '30D') {
  const cfg = RANGE_CONFIG[range] || RANGE_CONFIG['30D'];
  const end = new Date();
  end.setHours(0, 0, 0, 0);
  const start = new Date(end);
  if (cfg.bucket === 'day') {
    start.setDate(start.getDate() - (cfg.days - 1));
  } else {
    // For month-bucketed ranges approximate by months, not days, to get exact month count
    const months = range === '3M' ? 3 : range === '6M' ? 6 : 12;
    // start at first day of earliest month
    const tmp = new Date(end.getFullYear(), end.getMonth(), 1);
    tmp.setMonth(tmp.getMonth() - (months - 1));
    start.setTime(tmp.getTime());
  }

  const buckets = buildBuckets(start, end, cfg.bucket, range);
  const map = new Map();
  for (const b of buckets) map.set(b.key, { income: 0, expense: 0 });

  const startIso = buckets[0]?.key || isoDate(start);
  const endIso = isoDate(end);

  for (const t of transactions) {
    const occurred = (t.occurred_on || '').slice(0, 10);
    if (!occurred) continue;
    // Bucket key: day => YYYY-MM-DD, month => YYYY-MM
    const key = cfg.bucket === 'day' ? occurred : occurred.slice(0, 7);
    if (!map.has(key)) continue; // outside range
    const amt = Number(t.amount) || 0;
    const entry = map.get(key);
    if (t.type === 'income') entry.income += amt;
    else entry.expense += amt;
  }

  const points = buckets.map((b) => {
    const v = map.get(b.key);
    return {
      key: b.key,
      label: b.label,
      income: Math.round(v.income * 100) / 100,
      expense: Math.round(v.expense * 100) / 100,
      net: Math.round((v.income - v.expense) * 100) / 100,
    };
  });

  return { range, bucket: cfg.bucket, points, startIso, endIso };
}
