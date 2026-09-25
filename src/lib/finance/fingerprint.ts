/**
 * A short one-way fingerprint, so the event log can say "the same payment" or
 * "the same finding" without holding a merchant name or an amount.
 */
export function fingerprint(text: string, prefix = "fp"): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) h = Math.imul(h ^ text.charCodeAt(i), 0x01000193) >>> 0;
  return `${prefix}-${h.toString(16)}`;
}
