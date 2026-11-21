/**
 * Pure AI Guardrail & Redaction helpers (usable in Node, browser, and Deno).
 * Rules: docs/guardrails.md, docs/prompts.md, docs/tools.md, docs/memory.md.
 */

/** Cleans user text before any model call. Returns null when nothing usable is left. */
export function sanitizeInput(value: unknown, max = 600): string {
  if (typeof value !== 'string') return '';
  const cleaned = value
    .normalize('NFKC')
    .replace(/[\u0000-\u001F\u007F\u200B-\u200F\u202A-\u202E\u2060\uFEFF]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return cleaned ? cleaned.slice(0, max) : '';
}

/** Marks data as untrusted. The closing tag inside the data is neutralised so it cannot escape the block. */
export function wrapUntrusted(name: string, value: string): string {
  const safe = value.replace(/<\/?untrusted_data[^>]*>/gi, '[removed]');
  return `<untrusted_data name="${name.replace(/[^a-z_]/gi, '')}">\n${safe}\n</untrusted_data>`;
}

/** Regex to match phone numbers without stateful /g flag */
export function hasPhonePattern(text: string): boolean {
  return /(?:\+251\s*|0)[97]\d(?:[\s.-]?\d){7}/.test(text);
}

/**
 * Extracts and redacts phone numbers with [PHONE_n] placeholders.
 * Returns the redacted text for the model prompt and the extracted real numbers in order.
 */
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

/** Only used for metrics and alerts. Detection never gates safety. */
export function looksLikeInjection(text: string): boolean {
  return INJECTION.test(text);
}

/** Pulls every number out of a text: "1,200.50" -> 1200.5. */
export function numbersIn(text: string): number[] {
  const out: number[] = [];
  for (const m of text.matchAll(/\d[\d,]*(?:\.\d+)?/g)) {
    const n = Number(m[0].replace(/,/g, ''));
    if (Number.isFinite(n)) out.push(n);
  }
  return out;
}

/** Collects every number that appears anywhere in a JSON-like value. */
export function collectNumbers(value: unknown, into: Set<number> = new Set()): Set<number> {
  if (typeof value === 'number' && Number.isFinite(value)) into.add(value);
  else if (typeof value === 'string') for (const n of numbersIn(value)) into.add(n);
  else if (Array.isArray(value)) for (const v of value) collectNumbers(v, into);
  else if (value && typeof value === 'object') for (const v of Object.values(value)) collectNumbers(v, into);
  return into;
}

/**
 * Every number the model wrote must exist in the tool results (small whole numbers 0-10 are allowed
 * for counting words like "3 items"). Returns the offending numbers; empty means grounded.
 */
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

/** Verifies that a drafted customer status message is polite, under 60 words, and contains no phone/money */
export function isSafeCustomerMessage(
  message: string,
  orderCode?: string,
  shopName?: string
): { safe: boolean; ok: boolean; reason?: string } {
  if (!message || message.trim().length === 0) return { safe: false, ok: false, reason: 'empty' };

  // Word count cap: at most 60 words
  const words = message.trim().split(/\s+/).filter(Boolean);
  if (words.length > 60) return { safe: false, ok: false, reason: 'word_count_exceeded' };

  // If orderCode provided, check presence
  if (orderCode && !message.includes(orderCode)) {
    return { safe: false, ok: false, reason: 'missing_order_code' };
  }

  // If shopName provided, check presence
  if (shopName && !message.toLowerCase().includes(shopName.toLowerCase())) {
    return { safe: false, ok: false, reason: 'missing_shop_name' };
  }

  // Must NOT contain phone numbers
  if (hasPhonePattern(message)) {
    return { safe: false, ok: false, reason: 'contains_phone' };
  }

  // Must NOT contain monetary prices (e.g. "ETB", "birr", "350 birr")
  if (/\b(birr|etb|\$|€|£)\b/i.test(message) || /ብር/.test(message) || /qarshii/i.test(message)) {
    return { safe: false, ok: false, reason: 'contains_money' };
  }

  // Must NOT contain threats or shaming
  if (THREATS.some((r) => r.test(message))) {
    return { safe: false, ok: false, reason: 'threat_or_hostile_tone' };
  }

  return { safe: true, ok: true };
}

export interface StatusFallbackParams {
  orderCode: string;
  shopName: string;
  reason?: 'ready' | 'delayed' | 'needs_approval' | 'custom' | string;
  minutesDelayed?: number;
  locale?: 'en' | 'am' | 'om';
  firstName?: string;
  statusWord?: string;
}

/** Fallback template when AI status draft fails safety checks */
export function buildStatusFallbackMessage(
  paramsOrOrderCode: StatusFallbackParams | string,
  shopNameArg?: string,
  firstNameArg?: string,
  statusWordArg?: string
): string {
  if (typeof paramsOrOrderCode === 'object') {
    const { orderCode, shopName, reason = 'ready', minutesDelayed, locale = 'en', firstName } = paramsOrOrderCode;
    const greeting = firstName ? (locale === 'am' ? `ሰላም ${firstName}` : locale === 'om' ? `Akkam ${firstName}` : `Hello ${firstName}`) : (locale === 'am' ? 'ሰላም' : locale === 'om' ? 'Akkam' : 'Hello');

    if (reason === 'delayed') {
      const mins = minutesDelayed ? `${minutesDelayed}` : '15';
      if (locale === 'am') {
        return `${greeting}፣ ከ${shopName} ነው። ትዕዛዝዎ #${orderCode} በ${mins} ደቂቃ ዘግይቷል። በትዕግስትዎ እናመሰግናለን።`;
      }
      if (locale === 'om') {
        return `${greeting}, ${shopName} irraa. Ajajni keessan #${orderCode} daqiiqaa ${mins}n tureera. Obsa keessaniif galatoomaa.`;
      }
      return `${greeting}, this is ${shopName}. Your order #${orderCode} is delayed by about ${mins} minutes. Thank you for your patience.`;
    }

    if (locale === 'am') {
      return `${greeting}፣ ከ${shopName} ነው። ትዕዛዝዎ #${orderCode} ዝግጁ ሆኗል። እናመሰግናለን።`;
    }
    if (locale === 'om') {
      return `${greeting}, ${shopName} irraa. Ajajni keessan #${orderCode} qophaa'eera. Galatoomaa.`;
    }
    return `${greeting}, this is ${shopName}. Your order #${orderCode} is ready. Thank you.`;
  }

  const orderCode = paramsOrOrderCode;
  const shopName = shopNameArg || 'Order Desk';
  const greeting = firstNameArg ? `Hello ${firstNameArg}` : 'Hello';
  const status = statusWordArg || 'updated';
  return `${greeting}, this is ${shopName}. Your order #${orderCode} is ${status}. Thank you.`;
}

/** Validates that memory item key/value does not contain instructions or personal phone numbers */
export function isMemorySafe(key: string, value: string): { safe: boolean; ok: boolean; reason?: string } {
  if (!key || key.length > 80) return { safe: false, ok: false, reason: 'invalid_key_length' };
  if (!value || value.length > 300) return { safe: false, ok: false, reason: 'invalid_value_length' };

  // Reject phone numbers
  if (hasPhonePattern(key) || hasPhonePattern(value)) {
    return { safe: false, ok: false, reason: 'contains_phone_number' };
  }

  // Reject instruction-like phrases
  if (looksLikeInjection(key) || looksLikeInjection(value)) {
    return { safe: false, ok: false, reason: 'contains_instruction_phrase' };
  }

  return { safe: true, ok: true };
}

/** Extracts a JSON object from model text, tolerating code fences */
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
