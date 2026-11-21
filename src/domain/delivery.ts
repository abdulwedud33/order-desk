// src/domain/delivery.ts
// Pure functions for courier deliveries: URL sanitization, link building, amount calculations

/**
 * Validates and formats a phone number for dialer links.
 * Strictly cleans whitespace, dashes, and parentheses, and checks that
 * the result consists solely of an optional leading '+' and 7 to 15 digits.
 * Returns empty string for invalid, empty, or malicious strings (preventing javascript: or protocol injection).
 */
export function formatTelUri(phone: string | null | undefined): string {
  if (!phone) return '';
  const trimmed = phone.trim();
  // Remove common separators
  const cleaned = trimmed.replace(/[\s\-().]/g, '');
  // Strictly validate phone format (7-15 digits, optional leading +)
  if (!/^\+?[0-9]{7,15}$/.test(cleaned)) {
    return '';
  }
  return `tel:${cleaned}`;
}

/**
 * Builds a safe Google Maps search link from a delivery address.
 * Strictly percent-encodes the query parameter to guarantee that
 * raw model text, special characters, quotes, or script tags cannot break
 * URI syntax or inject malicious schemes.
 */
export function formatMapUri(address: string | null | undefined): string {
  if (!address) return '';
  const trimmed = address.trim();
  if (trimmed.length === 0) return '';
  return `https://maps.google.com/?q=${encodeURIComponent(trimmed)}`;
}

/**
 * Calculates the amount to collect from the customer upon delivery.
 * Amount = max(0, total - paidAmount), rounded to santim (2 decimal places).
 */
export function calculateAmountToCollect(total: number, paidAmount: number): number {
  const t = Math.max(0, Number(total) || 0);
  const p = Math.max(0, Number(paidAmount) || 0);
  const remaining = Math.max(0, t - p);
  return Math.round(remaining * 100) / 100;
}

/**
 * Determines if an order is an assigned active delivery for a given courier user id.
 */
export function isCourierAssignedToOrder(
  order: { type: string; assigned_to?: string | null },
  userId: string | null | undefined
): boolean {
  if (!userId) return false;
  return order.type === 'delivery' && order.assigned_to === userId;
}
