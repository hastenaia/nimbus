// GCash CSV import: tolerant header-mapping parser so it survives column
// naming differences between GCash export variants. Pure (no Supabase) —
// app.js handles the actual DB insert via bulkAddTransactions.

import { parseCsv } from './importExport.js';
import { suggestCategoryId } from './autocat.js';

const ROLE_RULES = [
  [/transaction date/i, 'date'],
  [/^date$/i, 'date'],
  [/transaction type/i, 'type'],
  [/^type$/i, 'type'],
  [/reference/i, 'ref'],
  [/debit/i, 'debit'],
  [/credit/i, 'credit'],
  [/amount/i, 'amount'],
  [/description|details|particulars|remarks/i, 'details'],
];

const INCOME_HINTS = /received|cash in|cash-in|money in|incoming|refund|reversal|credited|credited\b/i;
const EXPENSE_HINTS = /sent|paid|payment|pay |purchase|buy|load|cash out|transfer out|debit|bills?|fee/i;

function roleFor(header) {
  for (const [re, role] of ROLE_RULES) {
    if (re.test(header)) return role;
  }
  return null;
}

/** Maps a header row to { date, type, ref, debit, credit, amount, details } column indexes. */
export function detectGcashCsv(headers) {
  const roles = headers.map(roleFor);
  return roles.includes('date') && roles.includes('type');
}

function parseDate(s) {
  const v = String(s || '').trim();
  if (!v) return null;
  if (/^\d{4}-\d{1,2}-\d{1,2}/.test(v)) {
    const d = new Date(v);
    return isNaN(d) ? null : d.toISOString().slice(0, 10);
  }
  let m = v.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})/);
  if (m) {
    let [, mo, day, yr] = m;
    if (yr.length === 2) yr = `20${yr}`;
    const d = new Date(`${yr}-${mo}-${day}`);
    return isNaN(d) ? null : d.toISOString().slice(0, 10);
  }
  const d = new Date(v);
  return isNaN(d) ? null : d.toISOString().slice(0, 10);
}

function parseAmount(s) {
  if (s === null || s === undefined) return 0;
  const n = parseFloat(String(s).replace(/[^\d.-]/g, ''));
  return isNaN(n) ? 0 : Math.abs(n);
}

function classifyType(typeText, amount, debit, credit) {
  const t = String(typeText || '');
  if (INCOME_HINTS.test(t)) return 'income';
  if (EXPENSE_HINTS.test(t)) return 'expense';
  if (credit > 0 && debit === 0) return 'income';
  if (debit > 0 && credit === 0) return 'expense';
  return 'expense';
}

function guessDescription(details, typeText) {
  const d = String(details || '').trim();
  if (d) return d;
  return String(typeText || 'Transaction').trim();
}

/**
 * Parses a GCash CSV export into normalized transaction rows, deduped against
 * the existing transactions and auto-categorized. Returns
 * { rows, skipped, income, expense }.
 */
export function parseGcashCsv(text, { categories = [], transactions = [] } = {}) {
  const csv = parseCsv(text);
  const rows = [];
  let skipped = 0;
  if (!csv.length) return { rows, skipped, income: 0, expense: 0 };

  const headerRow = csv.findIndex((r) => detectGcashCsv(r));
  const isGcash = headerRow !== -1;
  if (!isGcash) throw new Error('This doesn\'t look like a GCash export. Expected "Transaction Date" and "Transaction Type" columns.');

  const headers = csv[headerRow];
  const roles = headers.map(roleFor);
  const col = (role) => roles.indexOf(role);

  const existingKeys = new Set();
  for (const t of transactions) {
    existingKeys.add(`${t.occurred_on}|${Number(t.amount).toFixed(2)}|${String(t.description || '').trim().toLowerCase()}`);
  }

  for (let i = headerRow + 1; i < csv.length; i++) {
    const r = csv[i];
    if (!r.some((c) => String(c || '').trim() !== '')) continue;

    const idx = (role) => (col(role) === -1 ? null : r[col(role)]);
    const dateStr = idx('date');
    const typeText = idx('type');
    const amountRaw = idx('amount');
    const debitRaw = idx('debit');
    const creditRaw = idx('credit');
    const details = idx('details');
    const ref = idx('ref');

    const occurred_on = parseDate(dateStr);
    const amount = parseAmount(amountRaw) || parseAmount(debitRaw) || parseAmount(creditRaw);
    if (!occurred_on || amount <= 0) {
      skipped++;
      continue;
    }

    const type = classifyType(typeText, amount, parseAmount(debitRaw), parseAmount(creditRaw));
    const description = guessDescription(details, typeText);

    const dedupeKey = `${occurred_on}|${amount.toFixed(2)}|${description.trim().toLowerCase()}`;
    if (existingKeys.has(dedupeKey)) {
      skipped++;
      continue;
    }
    existingKeys.add(dedupeKey);

    const suggestedId = suggestCategoryId(description, type, categories, transactions);
    const categoryName = categories.find((c) => c.id === suggestedId)?.name || null;

    rows.push({
      occurred_on,
      type,
      amount,
      categoryName,
      payment_method: 'gcash',
      description,
      notes: ref ? `Ref: ${ref}` : '',
      source: 'import',
    });
  }

  return {
    rows,
    skipped,
    income: rows.filter((r) => r.type === 'income').length,
    expense: rows.filter((r) => r.type === 'expense').length,
  };
}
