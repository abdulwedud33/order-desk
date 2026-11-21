/**
 * Shared AI Guardrails for Deno Edge Functions
 */
export function sanitizeInput(value: unknown, max = 600): string {
  if (typeof value !== 'string') return '';
  const cleaned = value
    .normalize('NFKC')
    .replace(/[\u0000-\u001F\u007F\u200B-\u200F\u202A-\u202E\u2060\uFEFF]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return cleaned ? cleaned.slice(0, max) : '';
}

export function wrapUntrusted(name: string, value: string): string {
  const safe = value.replace(/<\/?untrusted_data[^>]*>/gi, '[removed]');
  return `<untrusted_data name="${name.replace(/[^a-z_]/gi, '')}">\n${safe}\n</untrusted_data>`;
}

export function hasPhonePattern(text: string): boolean {
  return /(?:\+251\s*|0)[97]\d(?:[\s.-]?\d){7}/.test(text);
}

export function extractAndRedactPhones(text: string): {
  redactedText: string;
  phones: string[];
  extractedPhones: string[];
} {
  const phones: string[] = [];
  let counter = 0;

  const phoneRegex = /(?:\+251\s*|0)?([97]\d(?:[\s.-]?\d){7})/g;
  const redactedText = text.replace(phoneRegex, (match) => {
    counter++;
    const digitsOnly = match.replace(/[\s.-]/g, '');
    phones.push(digitsOnly);
    return `[PHONE_${counter}]`;
  });

  return { redactedText, phones, extractedPhones: phones };
}

const INJECTION = /(ignore (all |any |the )?(previous|prior|above|your)|disregard (all |any |the )?(prior |previous )?(rules|instructions|directives)|system prompt|reveal (your )?(prompt|instructions)|you are now|act as|override (all |any |the )?(rules|instructions|system)|bypass security|developer message|jailbreak)/i;

export function looksLikeInjection(text: string): boolean {
  return INJECTION.test(text);
}

export function numbersIn(text: string): number[] {
  const out: number[] = [];
  for (const m of text.matchAll(/\d[\d,]*(?:\.\d+)?/g)) {
    const n = Number(m[0].replace(/,/g, ''));
    if (Number.isFinite(n)) out.push(n);
  }
  return out;
}

export function collectNumbers(value: unknown, into: Set<number> = new Set()): Set<number> {
  if (typeof value === 'number' && Number.isFinite(value)) into.add(value);
  else if (typeof value === 'string') for (const n of numbersIn(value)) into.add(n);
  else if (Array.isArray(value)) for (const v of value) collectNumbers(v, into);
  else if (value && typeof value === 'object') for (const v of Object.values(value)) collectNumbers(v, into);
  return into;
}

export function ungroundedNumbers(text: string, allowed: Set<number>): number[] {
  const bad: number[] = [];
  for (const n of numbersIn(text)) {
    if (allowed.has(n)) continue;
    if (Number.isInteger(n) && n >= 0 && n <= 10) continue;
    bad.push(n);
  }
  return bad;
}

const THREATS = [
  /\b(police|court|lawsuit|sue|sued|legal action|lawyer|attorney|jail|prison|arrest|report you|blacklist|shame|ashamed|expose|publicly|consequences?|or else|final warning)\b/i,
  /ፖሊስ|ፍርድ ቤት|ክስ|እስር/,
  /poolisii|mana murtii|himata|hidhaa/i,
];

export function isSafeCustomerMessage(
  message: string,
  orderCode?: string,
  shopName?: string
): { safe: boolean; ok: boolean; reason?: string } {
  if (!message || message.trim().length === 0) return { safe: false, ok: false, reason: 'empty' };

  const words = message.trim().split(/\s+/).filter(Boolean);
  if (words.length > 60) return { safe: false, ok: false, reason: 'word_count_exceeded' };

  if (orderCode && !message.includes(orderCode)) {
    return { safe: false, ok: false, reason: 'missing_order_code' };
  }

  if (shopName && !message.toLowerCase().includes(shopName.toLowerCase())) {
    return { safe: false, ok: false, reason: 'missing_shop_name' };
  }

  if (hasPhonePattern(message)) {
    return { safe: false, ok: false, reason: 'contains_phone' };
  }

  if (/\b(birr|etb|\$|€|£)\b/i.test(message) || /ብር/.test(message) || /qarshii/i.test(message)) {
    return { safe: false, ok: false, reason: 'contains_money' };
  }

  if (THREATS.some((r) => r.test(message))) {
    return { safe: false, ok: false, reason: 'threat_or_hostile_tone' };
  }

  return { safe: true, ok: true };
}

export function parseJsonLoose<T = unknown>(text: string): T | null {
  const t = text.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');
  const start = t.indexOf('{');
  const end = t.lastIndexOf('}');
  if (start < 0 || end <= start) return null;
  try {
    return JSON.parse(t.slice(start, end + 1)) as T;
  } catch {
    return null;
  }
}
