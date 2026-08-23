// csvImport — reliable CSV/Excel/JSON transaction import
// Features: column mapping, preview, validation, duplicate detection, undo safety
// Uses local dates (parseLocalISO) to avoid PH UTC+8 off-by-one

import { parseCsv } from './importExport.js';
import { parseLocalISO } from './utils.js';

export const REQUIRED_FIELDS = ['date', 'amount'];
export const OPTIONAL_FIELDS = ['type', 'category', 'payment_method', 'description', 'notes', 'tags'];

const ALIASES = {
  date: ['date', 'transaction date', 'posted date', 'value date', 'occurred_on', 'occurred on', 'transaction_date', 'posting date', 'trade date', 'time', 'datetime'],
  amount: ['amount', 'value', 'sum', 'total', 'price', 'quantity', 'debit', 'credit', 'amount (php)', 'php', 'cost'],
  type: ['type', 'transaction type', 'kind', 'direction', 'credit/debit', 'debit/credit', 'income/expense'],
  category: ['category', 'cat', 'category name', 'group', 'label'],
  description: ['description', 'desc', 'details', 'particulars', 'remarks', 'memo', 'narrative', 'payee', 'merchant', 'reference', 'title'],
  payment_method: ['payment method', 'payment_method', 'method', 'payment', 'account', 'wallet', 'mode', 'channel', 'payment_method_type', 'payment type'],
  notes: ['notes', 'note', 'comment', 'comments', 'extra'],
};

const VALID_TYPES = ['income', 'expense'];
const VALID_METHODS = ['cash', 'gcash', 'bank', 'credit_card', 'other'];

function normHeader(h) {
  return String(h || '').trim().toLowerCase().replace(/[_-]+/g, ' ').replace(/\s+/g, ' ').trim();
}

export function autoMapHeaders(headers) {
  const map = {};
  const used = new Set();
  const normalized = headers.map(normHeader);
  for (const field of [...REQUIRED_FIELDS, ...OPTIONAL_FIELDS]) {
    const aliases = ALIASES[field] || [field];
    let found = null;
    for (let i = 0; i < normalized.length; i++) {
      if (used.has(i)) continue;
      const h = normalized[i];
      for (const alias of aliases) {
        if (h === alias || h === normHeader(alias)) { found = headers[i]; break; }
        // also partial match: header contains alias
        if (h.includes(alias) || alias.includes(h)) { found = headers[i]; break; }
      }
      if (found) { used.add(i); break; }
    }
    if (found) map[field] = found;
  }
  return map; // e.g. {date:'Transaction Date', amount:'Amount', ...}
}

export function parseDateSafe(s) {
  const v = String(s || '').trim();
  if (!v) return null;
  // try local ISO first: YYYY-MM-DD — strict validation
  const iso = v.slice(0,10);
  if (/^\d{4}-\d{2}-\d{2}$/.test(iso)) {
    const d = parseLocalISO(iso);
    if (d && !isNaN(d) && d.toISOString) {
      // verify no overflow (e.g., 2026-13-40 -> 2027-02-09)
      const check = `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
      // also check via isoLocal for local consistency
      const localCheck = `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
      if (localCheck === iso) return iso;
    }
    return null;
  }
  // MM/DD/YYYY or DD/MM/YYYY — use local parse
  const m = v.match(/^(\d{1,2})[\/-](\d{1,2})[\/-](\d{2,4})/);
  if (m) {
    let [, a, b, yr] = m;
    // heuristic: if first >12 then DD/MM, else MM/DD
    let mo, day;
    if (Number(a) > 12) { day = a; mo = b; } else { mo = a; day = b; }
    if (yr.length === 2) yr = `20${yr}`;
    const d = parseLocalISO(`${yr}-${String(mo).padStart(2,'0')}-${String(day).padStart(2,'0')}`);
    if (d && !isNaN(d)) return `${yr}-${String(mo).padStart(2,'0')}-${String(day).padStart(2,'0')}`;
  }
  const d = parseLocalISO(v);
  if (d && !isNaN(d)) return d.toISOString ? d.toISOString().slice(0,10) : null;
  // fallback via Date parse local
  const d2 = new Date(v);
  if (!isNaN(d2)) return `${d2.getFullYear()}-${String(d2.getMonth()+1).padStart(2,'0')}-${String(d2.getDate()).padStart(2,'0')}`;
  return null;
}

export function parseAmountSafe(s) {
  if (s === null || s === undefined || String(s).trim() === '') return NaN;
  const cleaned = String(s).replace(/[₱,\s]/g, '').replace(/[^\d.\-]/g, '');
  const n = parseFloat(cleaned);
  return isNaN(n) ? NaN : n;
}

function normalizeType(s) {
  const v = String(s || '').trim().toLowerCase();
  if (v === 'income' || v === 'credit' || v === 'in' || v === 'deposit') return 'income';
  if (v === 'expense' || v === 'debit' || v === 'out' || v === 'withdrawal' || v === 'payment') return 'expense';
  return v;
}

function normalizeMethod(s) {
  const v = String(s || '').trim().toLowerCase().replace(/\s+/g,'_');
  if (VALID_METHODS.includes(v)) return v;
  if (v.includes('gcash')) return 'gcash';
  if (v.includes('cash')) return 'cash';
  if (v.includes('bank')) return 'bank';
  if (v.includes('credit')) return 'credit_card';
  return 'other';
}

export function validateRow(raw, idx) {
  const errors = [];
  const dateStr = raw.date;
  const date = parseDateSafe(dateStr);
  if (!dateStr || !date) errors.push(`Row ${idx+1}: Invalid date "${dateStr || ''}"`);
  // Amount
  const amtRaw = raw.amount;
  const amt = parseAmountSafe(amtRaw);
  if (amtRaw === '' || isNaN(amt)) errors.push(`Row ${idx+1}: Invalid amount "${amtRaw}"`);
  else if (amt === 0) errors.push(`Row ${idx+1}: Amount cannot be zero`);
  else if (amt < 0) errors.push(`Row ${idx+1}: Amount cannot be negative (use Type=expense)`);
  else if (Math.abs(amt) > 100000000) errors.push(`Row ${idx+1}: Amount unusually large`);
  // Type
  const t = normalizeType(raw.type || 'expense');
  if (raw.type && !VALID_TYPES.includes(t)) errors.push(`Row ${idx+1}: Invalid type "${raw.type}" (use income/expense)`);
  // Method
  if (raw.payment_method) {
    const m = normalizeMethod(raw.payment_method);
    if (!VALID_METHODS.includes(m) && raw.payment_method) {
      // auto-normalized to other, not error
    }
  }
  return { valid: errors.length === 0, errors, parsed: { date, amount: amt, type: t } };
}

export function dedupeKey(row) {
  const d = (row.occurred_on || '').slice(0,10);
  const amt = Number(row.amount).toFixed(2);
  const desc = String(row.description || '').trim().toLowerCase();
  const type = row.type || 'expense';
  return `${d}|${amt}|${desc}|${type}`;
}

export function detectDuplicates(rows, existingTx) {
  const existingKeys = new Set(existingTx.map(t => `${(t.occurred_on||'').slice(0,10)}|${Number(t.amount).toFixed(2)}|${String(t.description||'').trim().toLowerCase()}|${t.type}`));
  const seen = new Set();
  const dupCandidates = [];
  rows.forEach((r, idx) => {
    const key = dedupeKey(r);
    if (existingKeys.has(key)) dupCandidates.push({ idx, reason: 'matches existing transaction', key });
    else if (seen.has(key)) dupCandidates.push({ idx, reason: 'duplicate within file', key });
    else seen.add(key);
  });
  return dupCandidates;
}

export function normalizeRowForInsert(raw, idx) {
  const { parsed } = validateRow(raw, idx);
  return {
    occurred_on: parsed.date || new Date().toISOString().slice(0,10),
    type: parsed.type || 'expense',
    amount: Math.abs(parsed.amount || 0),
    categoryName: raw.category ? String(raw.category).trim() || null : null,
    payment_method: normalizeMethod(raw.payment_method || 'other'),
    description: raw.description ? String(raw.description).trim() : '',
    notes: raw.notes ? String(raw.notes).trim() : '',
    tags: raw.tags ? String(raw.tags).split('|').map(s=>s.trim()).filter(Boolean) : [],
    source: 'import',
  };
}

/**
 * Build preview from parsed CSV rows and header mapping
 * @param {Array} headers - raw header strings
 * @param {Array<Array>} dataRows - array of cell arrays
 * @param {Object} mapping - field->headerName
 * @param {Array} existingTx
 */
export function buildPreviewFromRows(headers, dataRows, mapping, existingTx) {
  const headerIndex = {};
  headers.forEach((h,i)=> headerIndex[h]=i);
  const rowsRaw = dataRows.map(cells => {
    const raw = {};
    for (const field of [...REQUIRED_FIELDS, ...OPTIONAL_FIELDS]) {
      const headerName = mapping[field];
      if (!headerName) raw[field] = '';
      else {
        const idx = headerIndex[headerName];
        raw[field] = cells[idx] !== undefined ? String(cells[idx]).trim() : '';
      }
    }
    // also allow raw direct if headers were already lowercased
    return raw;
  });

  const validated = rowsRaw.map((raw, idx) => {
    const v = validateRow(raw, idx);
    const normalized = normalizeRowForInsert(raw, idx);
    return { idx, raw, ...v, normalized };
  });

  const validRows = validated.filter(v => v.valid);
  const invalidRows = validated.filter(v => !v.valid);

  // Duplicate detection on valid rows only
  const normalizedValid = validRows.map(v => v.normalized);
  const dupCandidates = detectDuplicates(normalizedValid, existingTx);
  const dupIdxSet = new Set(dupCandidates.map(d=> validRows[d.idx].idx));

  // Stats
  const incomeRows = validRows.filter(v => v.normalized.type === 'income');
  const expenseRows = validRows.filter(v => v.normalized.type === 'expense');
  const totalIncome = incomeRows.reduce((s,v)=> s+Number(v.normalized.amount||0),0);
  const totalExpense = expenseRows.reduce((s,v)=> s+Number(v.normalized.amount||0),0);

  return {
    headers,
    mapping,
    rowsRaw,
    validated,
    validRows,
    invalidRows,
    dupCandidates,
    dupIdxSet,
    _dataRows: dataRows,
    stats: {
      total: rowsRaw.length,
      valid: validRows.length,
      invalid: invalidRows.length,
      duplicates: dupCandidates.length,
      income: incomeRows.length,
      expense: expenseRows.length,
      totalIncome,
      totalExpense,
    }
  };
}

export function parseCsvWithPreview(text, existingTx) {
  const rows = parseCsv(text);
  if (!rows.length) return { empty: true, stats: { total:0 } };
  const headers = rows[0].map(h=> String(h).trim());
  // detect if first row looks like header (contains date/amount words)
  const hasHeader = headers.some(h=> /date|amount|type|description|category/i.test(h));
  let dataRows, actualHeaders;
  if (hasHeader) {
    actualHeaders = headers;
    dataRows = rows.slice(1).filter(r=> r.some(c=> String(c||'').trim() !== ''));
  } else {
    // no header: treat as data, create generic headers
    actualHeaders = headers.map((_,i)=> `col${i}`);
    dataRows = rows.filter(r=> r.some(c=> String(c||'').trim() !== ''));
    // but first row was data, include it
    dataRows.unshift(headers);
    actualHeaders = actualHeaders.map((_,i)=> `col${i}`);
  }
  const autoMapping = autoMapHeaders(actualHeaders);
  // ensure at least date and amount mapped if possible, else try positional fallback
  if (!autoMapping.date && actualHeaders.length>0) autoMapping.date = actualHeaders[0];
  if (!autoMapping.amount && actualHeaders.length>1) autoMapping.amount = actualHeaders[1];
  return buildPreviewFromRows(actualHeaders, dataRows, autoMapping, existingTx);
}

// Large file guard
export function checkFileSize(rowsCount) {
  if (rowsCount > 5000) return { warn: `Large file (${rowsCount} rows) — import will be batched.` };
  if (rowsCount > 1000) return { warn: `File has ${rowsCount} rows — may take a moment.` };
  return null;
}
