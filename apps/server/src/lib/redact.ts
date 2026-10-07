/**
 * PII redaction applied before any text reaches an LLM (DPDP Act hygiene).
 * Real values go into a vault so the model's reply can be restored for the customer.
 */
export type Vault = Record<string, string>;

function luhn(digits: string): boolean {
  let sum = 0;
  let dbl = false;
  for (let i = digits.length - 1; i >= 0; i--) {
    let d = Number(digits[i]);
    if (dbl) {
      d *= 2;
      if (d > 9) d -= 9;
    }
    sum += d;
    dbl = !dbl;
  }
  return sum % 10 === 0;
}

interface Rule {
  kind: string;
  re: RegExp;
  accept?: (match: string) => boolean;
}

// Order matters: more specific patterns first.
const rules: Rule[] = [
  { kind: 'EMAIL', re: /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g },
  { kind: 'UPI', re: /\b[A-Za-z0-9._-]{2,}@(?:ok\w+|ybl|ibl|axl|paytm|upi|apl|yapl|icici|sbi|hdfcbank|axisbank)\b/gi },
  {
    kind: 'CARD',
    re: /\b(?:\d[ -]?){13,19}\b/g,
    accept: (m) => {
      const d = m.replace(/\D/g, '');
      return d.length >= 13 && d.length <= 19 && luhn(d);
    },
  },
  { kind: 'AADHAAR', re: /\b[2-9]\d{3}[ -]?\d{4}[ -]?\d{4}\b/g },
  { kind: 'PAN', re: /\b[A-Z]{5}\d{4}[A-Z]\b/g },
  { kind: 'PHONE', re: /(?:\+?91[ -]?)?\b[6-9]\d{4}[ -]?\d{5}\b|\+\d{1,3}[ -]?\d{3,4}[ -]?\d{3,4}[ -]?\d{3,4}\b/g },
];

export function redact(text: string, vault: Vault = {}): { text: string; vault: Vault } {
  const counters: Record<string, number> = {};
  for (const existing of Object.keys(vault)) {
    const m = existing.match(/^\[([A-Z]+)_(\d+)\]$/);
    if (m) counters[m[1]!] = Math.max(counters[m[1]!] ?? 0, Number(m[2]));
  }
  const reverse = new Map(Object.entries(vault).map(([k, v]) => [v, k]));
  let out = text;
  for (const rule of rules) {
    out = out.replace(rule.re, (match) => {
      if (match.startsWith('[') || (rule.accept && !rule.accept(match))) return match;
      const known = reverse.get(match);
      if (known) return known;
      counters[rule.kind] = (counters[rule.kind] ?? 0) + 1;
      const placeholder = `[${rule.kind}_${counters[rule.kind]}]`;
      vault[placeholder] = match;
      reverse.set(match, placeholder);
      return placeholder;
    });
  }
  return { text: out, vault };
}

export function restore(text: string, vault: Vault): string {
  return text.replace(/\[([A-Z]+)_(\d+)\]/g, (ph) => vault[ph] ?? ph);
}
