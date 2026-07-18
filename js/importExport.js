// CSV/JSON handled natively. Excel (.xlsx) uses SheetJS (window.XLSX,
// loaded via CDN in index.html) for both reading and writing.

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
    csvSafe(t.description),
    csvSafe(t.notes),
    (t.tags || []).join('|'),
  ]);
  const csv = [headers.join(','), ...rows.map((r) => r.join(','))].join('\n');
  const blob = new Blob([csv], { type: 'text/csv' });
  downloadBlob(blob, `nimbus-transactions-${Date.now()}.csv`);
}

export function exportToExcel(transactions) {
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
  const [headerLine, ...lines] = text.trim().split('\n');
  const headers = headerLine.split(',').map((h) => h.trim().toLowerCase());
  return lines
    .filter(Boolean)
    .map((line) => {
      const cells = line.split(',');
      const row = {};
      headers.forEach((h, i) => (row[h] = cells[i]));
      return normalizeRow(row);
    });
}

async function parseExcelFile(file) {
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
