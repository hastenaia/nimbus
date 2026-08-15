// Pure category-suggestion engine shared by manual entry and imports.
// No DOM / Supabase dependencies — safe to unit test in isolation.

const KEYWORDS = [
  ['Food', ['jollibee', 'mcdo', 'mcdonald', 'chowking', 'greenwich', 'mang inasal', '7-eleven', '7 eleven', 'minimart', 'puregold', 'pure gold', 'market', 'grocery', 'groceries', 'food', 'lunch', 'dinner', 'coffee', 'starbucks', 'restaurant', 'kfc', 'wendy']],
  ['Transportation', ['grab', 'angkas', 'joyride', 'move it', 'lalamove', 'jeep', 'taxi', 'tricycle', 'fuel', 'gasoline', 'gas', 'petron', 'shell', 'caltex', 'lrt', 'mrt', 'bus', 'commute', 'parking', 'toll']],
  ['Bills', ['meralco', 'electric', 'water', 'maynilad', 'manila water', 'pldt', 'globe', 'smart', 'internet', 'wifi', 'stream', 'postpaid', 'prepaid load', 'cable', 'sky cable', 'utility', 'municipal', 'barangay', 'rent', 'condo dues', 'hoadmin', 'pag-ibig', 'sss']],
  ['Shopping', ['sm', 'robinson', 'landmark', 'lazada', 'shopee', 'tiktok shop', 'malls', 'mall', 'shein', 'zalora', 'department', 'sneakers', 'clothes', 'apparel', 'shoes', 'gadget', 'electronics']],
  ['Entertainment', ['netflix', 'spotify', 'youtube', 'youtube premium', 'steam', 'playstation', 'xbox', 'nintendo', 'cinema', 'movie', 'concert', 'game', 'battle pass', 'spotify premium', 'disney+', 'hbomax', 'max']],
  ['Education', ['tuition', 'school', 'college', 'university', 'book', 'course', 'udemy', 'coursera', 'seminar', 'training', 'review']],
  ['Health', ['pharmacy', 'mercury', 'watsons', 'doctor', 'hospital', 'clinic', 'medicine', 'medical', 'dental', 'checkup', 'laboratory', 'gym', 'vitamin']],
  ['Savings', ['savings', 'bank deposit', 'mp2', 'time deposit', 'investment', 'stocks', 'crypto', 'fund']],
];

const INCOME_KEYWORDS = [
  ['Salary', ['salary', 'payroll', 'wage', 'paycheck', 'bonus', '13th month', 'compensation']],
  ['Freelance', ['upwork', 'fiverr', 'freelance', 'client payment', 'gig', 'onlinejobs', 'design service']],
  ['Allowance', ['allowance', 'baon', 'pocket money']],
  ['Investment', ['dividend', 'interest', 'stock', 'crypto profit', 'yield']],
];

const SIMILARITY_MIN_TOKENS = 1;
const SIMILARITY_MAX_CANDIDATES = 8;

function normalize(s) {
  return String(s || '').toLowerCase().replace(/[^a-z0-9\s]/g, ' ');
}

function tokenize(s) {
  return normalize(s).split(/\s+/).filter((t) => t.length > 1);
}

function findCategoryByName(categories, name, type) {
  const n = name.toLowerCase();
  return categories.find((c) => c.type === type && c.name.toLowerCase() === n) ||
    categories.find((c) => c.type === type && c.name.toLowerCase().includes(n)) ||
    categories.find((c) => c.type === type && n.includes(c.name.toLowerCase()));
}

function matchKeywords(description, categories, type) {
  const table = type === 'income' ? INCOME_KEYWORDS : KEYWORDS;
  for (const [name, words] of table) {
    for (const w of words) {
      if (normalize(description).includes(normalize(w))) {
        const cat = findCategoryByName(categories, name, type);
        if (cat) return cat.id;
      }
    }
  }
  return null;
}

function majorityFromHistory(description, categories, type, transactions) {
  const tokens = new Set(tokenize(description));
  if (!tokens.size) return null;

  const scored = new Map();
  for (const t of transactions || []) {
    if (t.type !== type) continue;
    const txTokens = new Set(tokenize(t.description));
    let overlap = 0;
    for (const tok of tokens) if (txTokens.has(tok)) overlap++;
    if (overlap >= SIMILARITY_MIN_TOKENS) {
      scored.set(t.category_id, (scored.get(t.category_id) || 0) + overlap);
    }
  }
  if (!scored.size) return null;

  const ranked = [...scored.entries()].sort((a, b) => b[1] - a[1]).slice(0, SIMILARITY_MAX_CANDIDATES);
  const top = ranked[0];
  if (categories.some((c) => c.id === top[0] && c.type === type)) return top[0];
  return null;
}

function defaultCategory(categories, type) {
  return categories.find((c) => c.type === type && c.is_default) ||
    categories.find((c) => c.type === type) ||
    null;
}

/** Best-guess category id for a description, or null. */
export function suggestCategoryId(description, type, categories, transactions) {
  if (!categories?.length) return null;
  const t = type === 'income' ? 'income' : 'expense';
  return matchKeywords(description, categories, t) ||
    majorityFromHistory(description, categories, t, transactions) ||
    (defaultCategory(categories, t)?.id || null);
}

export { normalize };
