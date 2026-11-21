import type { LocalCustomer } from '../lib/db';

export function normalizeSearch(text: string): string {
  return text.trim().toLowerCase();
}

/**
 * Searches customers by name or phone number.
 * Rule (docs/01-prd.md FR-O1): suggestions appear after 2 characters.
 */
export function searchCustomers(query: string, customers: LocalCustomer[]): LocalCustomer[] {
  const q = normalizeSearch(query);
  if (q.length < 2) {
    return [];
  }

  const cleanPhoneQ = q.replace(/[^0-9]/g, '');

  return customers
    .filter((c) => {
      const nameMatch = normalizeSearch(c.name).includes(q);
      const phoneMatch = cleanPhoneQ.length >= 2 && c.phone
        ? c.phone.replace(/[^0-9]/g, '').includes(cleanPhoneQ)
        : false;
      return nameMatch || phoneMatch;
    })
    .sort((a, b) => {
      // Prioritize prefix name matches
      const aStarts = normalizeSearch(a.name).startsWith(q);
      const bStarts = normalizeSearch(b.name).startsWith(q);
      if (aStarts && !bStarts) return -1;
      if (!aStarts && bStarts) return 1;
      return a.name.localeCompare(b.name);
    })
    .slice(0, 10);
}
