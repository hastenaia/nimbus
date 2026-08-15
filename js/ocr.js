// Uses Tesseract.js v5 (window.Tesseract, loaded lazily via loadScript).
// Parses a GCash-style receipt screenshot and extracts likely fields.
// This is heuristic text parsing over OCR output — always shown to the
// user for confirmation/correction before anything is saved.
//
// A single worker is created lazily and reused for every scan, so the
// language data / wasm core is only downloaded once instead of per image.

import { loadScript } from './utils.js';

const TESSERACT_URL = 'https://unpkg.com/tesseract.js@5/dist/tesseract.min.js';

let worker = null;
let progressCb = null;

/** Starts the ~2MB Tesseract download early (e.g. when the OCR modal opens). */
export function preloadOcr() {
  loadScript(TESSERACT_URL).catch(() => {});
}

async function getWorker() {
  if (worker) return worker;
  worker = await window.Tesseract.createWorker('eng', 1, {
    logger: (m) => {
      if (m.status === 'recognizing text' && progressCb) progressCb(Math.round(m.progress * 100));
    },
  });
  return worker;
}

export async function runOcr(file, onProgress) {
  await loadScript(TESSERACT_URL);
  if (!window.Tesseract) throw new Error('Tesseract.js not loaded');

  progressCb = onProgress || null;
  const w = await getWorker();
  const {
    data: { text },
  } = await w.recognize(file);

  return { rawText: text, parsed: parseGcashText(text) };
}

function parseGcashText(text) {
  const lines = text.split('\n').map((l) => l.trim()).filter(Boolean);
  const joined = text.replace(/\n/g, ' ');

  // Amount: look for "PHP 1,234.56" / "₱1,234.56" patterns, pick the largest.
  const amountMatches = [...joined.matchAll(/(?:₱|PHP)\s*([\d,]+\.\d{2})/gi)];
  let amount = null;
  if (amountMatches.length) {
    amount = Math.max(...amountMatches.map((m) => parseFloat(m[1].replace(/,/g, ''))));
  }

  // Date: common GCash formats like "Jul 18, 2026" or "07/18/2026"
  const dateMatch = joined.match(/([A-Z][a-z]{2}\s+\d{1,2},\s+\d{4})/) || joined.match(/(\d{1,2}\/\d{1,2}\/\d{4})/);
  let date = null;
  if (dateMatch) {
    const d = new Date(dateMatch[1]);
    if (!isNaN(d)) date = d.toISOString().slice(0, 10);
  }

  // Reference number: "Ref No. 1234567890123" style
  const refMatch = joined.match(/Ref(?:erence)?\.?\s*(?:No\.?)?\s*[:#]?\s*(\d{8,20})/i);

  // Merchant / recipient: line following "To" / "Sent to" / "Received from"
  let merchant = null;
  const merchantLine = lines.find((l) => /^(to|sent to|received from|pay to|name)\b/i.test(l));
  if (merchantLine) {
    merchant = merchantLine.replace(/^(to|sent to|received from|pay to|name)[:\s]*/i, '').trim();
  }

  const type = /received|cash in|incoming/i.test(joined) ? 'income' : 'expense';

  return {
    amount,
    date: date || new Date().toISOString().slice(0, 10),
    merchant,
    reference: refMatch ? refMatch[1] : null,
    type,
  };
}
