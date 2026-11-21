import { en, type MessageKey } from './en';
import { am } from './am';
import { om } from './om';

export type Locale = 'en' | 'am' | 'om';

const CATALOGS: Record<Locale, Record<MessageKey, string>> = {
  en,
  am,
  om,
};

export function translate(locale: Locale, key: MessageKey, params?: Record<string, string | number>): string {
  const catalog = CATALOGS[locale] || en;
  let text = catalog[key] || en[key] || key;
  if (params) {
    for (const [k, v] of Object.entries(params)) {
      text = text.replaceAll(`{${k}}`, String(v));
    }
  }
  return text;
}
