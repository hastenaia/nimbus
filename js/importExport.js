// CSV/JSON handled natively. Excel (.xlsx) uses SheetJS (window.XLSX,
// loaded lazily via loadScript) for both reading and writing.

import { loadScript } from './utils.js';

const XLSX_URL = 'https://cdn.jsdelivr.net/npm/xlsx@0.18.5/dist/xlsx.full.min.js';

export function exportToJson(transactions) {
  const blob = new Blob([JSON.stringify(transactions, null, 2)], { type: 'application/json' });
  downloadBlob(blob, `nimbus-transactions-${Date.now()}.json`);
}

export function exportToCsv(transactions) {
  const headers = ['date', 'type', 'amount', 'category', 'payment_method', 'description', 'notes', 'tags'];
  const rows = transactions.map((t) => [
    t.occurred_on,
    t.type,
    t.amount,
    t.categories?.name || '',
    t.payment_method,
    t.description,
    t.notes,
    (t.tags || []).join('|'),
  ]);
  const csv = [headers, ...rows].map((r) => r.map(csvSafe).join(',')).join('\n');
  const blob = new Blob([csv], { type: 'text/csv' });
  downloadBlob(blob, `nimbus-transactions-${Date.now()}.csv`);
}

export async function exportToExcel(transactions) {
  await loadScript(XLSX_URL);
  if (!window.XLSX) throw new Error('SheetJS (XLSX) not loaded');
  const rows = transactions.map((t) => ({
    Date: t.occurred_on,
    Type: t.type,
    Amount: t.amount,
    Category: t.categories?.name || '',
    'Payment Method': t.payment_method,
    Description: t.description || '',
    Notes: t.notes || '',
    Tags: (t.tags || []).join('|'),
  }));
  const ws = window.XLSX.utils.json_to_sheet(rows);
  const wb = window.XLSX.utils.book_new();
  window.XLSX.utils.book_append_sheet(wb, ws, 'Transactions');
  window.XLSX.writeFile(wb, `nimbus-transactions-${Date.now()}.xlsx`);
}

export async function parseImportFile(file) {
  const ext = file.name.split('.').pop().toLowerCase();
  if (ext === 'json') return parseJsonFile(file);
  if (ext === 'csv') return parseCsvFile(file);
  if (ext === 'xlsx' || ext === 'xls') return parseExcelFile(file);
  throw new Error('Unsupported file type. Use CSV, XLSX, or JSON.');
}

async function parseJsonFile(file) {
  const text = await file.text();
  const data = JSON.parse(text);
  return Array.isArray(data) ? data.map(normalizeRow) : [];
}

async function parseCsvFile(file) {
  const text = await file.text();
  const rows = parseCsv(text);
  if (!rows.length) return [];
  const headers = rows[0].map((h) => h.trim().toLowerCase());
  return rows
    .slice(1)
    .filter((r) => r.some((c) => c.trim() !== ''))
    .map((cells) => {
      const row = {};
      headers.forEach((h, i) => (row[h] = (cells[i] || '').trim()));
      return normalizeRow(row);
    });
}

/** Minimal RFC-4180 CSV parser: handles quoted fields, "" escapes and newlines inside quotes. */
function parseCsv(text) {
  const rows = [];
  let row = [];
  let cell = '';
  let inQuotes = false;

  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          cell += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        cell += ch;
      }
    } else if (ch === '"') {
      inQuotes = true;
    } else if (ch === ',') {
      row.push(cell);
      cell = '';
    } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && text[i + 1] === '\n') i++;
      row.push(cell);
      cell = '';
      if (row.some((c) => c.trim() !== '')) rows.push(row);
      row = [];
    } else {
      cell += ch;
    }
  }
  if (cell !== '' || row.length) {
    row.push(cell);
    if (row.some((c) => c.trim() !== '')) rows.push(row);
  }
  return rows;
}

async function parseExcelFile(file) {
  await loadScript(XLSX_URL);
  if (!window.XLSX) throw new Error('SheetJS (XLSX) not loaded');
  const buffer = await file.arrayBuffer();
  const wb = window.XLSX.read(buffer, { type: 'array' });
  const sheet = wb.Sheets[wb.SheetNames[0]];
  const rows = window.XLSX.utils.sheet_to_json(sheet);
  return rows.map((r) =>
    normalizeRow({
      date: r.Date,
      type: (r.Type || '').toLowerCase(),
      amount: r.Amount,
      category: r.Category,
      payment_method: r['Payment Method'],
      description: r.Description,
      notes: r.Notes,
      tags: r.Tags,
    })
  );
}

function normalizeRow(row) {
  return {
    occurred_on: row.date || row.occurred_on || new Date().toISOString().slice(0, 10),
    type: (row.type || 'expense').toLowerCase() === 'income' ? 'income' : 'expense',
    amount: parseFloat(row.amount) || 0,
    categoryName: row.category || null,
    payment_method: (row.payment_method || 'other').toLowerCase(),
    description: row.description || '',
    notes: row.notes || '',
    tags: row.tags ? String(row.tags).split('|').filter(Boolean) : [],
  };
}

function csvSafe(s) {
  if (!s) return '';
  const escaped = String(s).replace(/"/g, '""');
  return /[",\n]/.test(escaped) ? `"${escaped}"` : escaped;
}

function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}
