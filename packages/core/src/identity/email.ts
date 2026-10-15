import { domainToASCII } from 'node:url';

/**
 * docs/04 §1: trim, lowercase, convert the domain to IDNA/punycode. Dots and +tags are kept.
 * Returns undefined for anything that is not a plausible single address.
 */
export function normalizeEmail(input: string): string | undefined {
  const value = input.trim();
  if (value.length > 254) return undefined;
  const at = value.lastIndexOf('@');
  if (at < 1 || at === value.length - 1) return undefined;
  const local = value.slice(0, at);
  const domain = domainToASCII(value.slice(at + 1).toLowerCase());
  if (domain === '' || !domain.includes('.') || local.length > 64) return undefined;
  if (/[\s<>()[\]\\,;:"]/.test(local) || local.includes('@')) return undefined;
  return `${local.toLowerCase()}@${domain}`;
}
