export function normalizeName(input: string): string {
  return input
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .replace(/['’`]/g, "")
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function tokenSort(input: string): string {
  return normalizeName(input).split(" ").filter(Boolean).sort().join(" ");
}

export function levenshtein(a: string, b: string): number {
  if (a === b) return 0;
  if (!a.length) return b.length;
  if (!b.length) return a.length;
  const prev = new Array<number>(b.length + 1);
  const curr = new Array<number>(b.length + 1);
  for (let j = 0; j <= b.length; j++) prev[j] = j;
  for (let i = 1; i <= a.length; i++) {
    curr[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      curr[j] = Math.min(curr[j - 1] + 1, prev[j] + 1, prev[j - 1] + cost);
    }
    for (let j = 0; j <= b.length; j++) prev[j] = curr[j];
  }
  return prev[b.length];
}

/** 0–1 similarity after case, diacritic, punctuation, and token-order normalization. */
export function nameSimilarity(a: string, b: string): number {
  const left = tokenSort(a);
  const right = tokenSort(b);
  if (!left || !right) return 0;
  if (left === right) return 1;
  const dist = levenshtein(left, right);
  return 1 - dist / Math.max(left.length, right.length);
}

export function normalizePostcode(input: string): string {
  return input.toUpperCase().replace(/[^A-Z0-9]/g, "");
}

const COUNTRIES: Record<string, string> = {
  US: "US",
  USA: "US",
  "UNITED STATES": "US",
  "UNITED STATES OF AMERICA": "US",
  美国: "US",
  GB: "GB",
  UK: "GB",
  "UNITED KINGDOM": "GB",
  "GREAT BRITAIN": "GB",
  英国: "GB",
  DE: "DE",
  GERMANY: "DE",
  DEUTSCHLAND: "DE",
  德国: "DE",
  AU: "AU",
  AUSTRALIA: "AU",
  澳大利亚: "AU",
  澳洲: "AU",
  CA: "CA",
  CANADA: "CA",
  加拿大: "CA",
};

export function normalizeCountry(input: string): string {
  const trimmed = input.trim();
  if (!trimmed) return "";
  if (COUNTRIES[trimmed]) return COUNTRIES[trimmed];
  const upper = trimmed.toUpperCase();
  if (COUNTRIES[upper]) return COUNTRIES[upper];
  return COUNTRIES[trimmed] || upper.slice(0, 8);
}

export function keywordOverlap(a: string, b: string): number {
  const toSet = (value: string) =>
    new Set(
      normalizeName(value)
        .split(" ")
        .filter((word) => word.length > 2),
    );
  const left = toSet(a);
  const right = toSet(b);
  if (!left.size || !right.size) return 0;
  let shared = 0;
  for (const word of left) if (right.has(word)) shared += 1;
  const union = new Set([...left, ...right]).size;
  return union ? shared / union : 0;
}

export function normalizeRef(input: string): string {
  return input.trim().toUpperCase().replace(/\s+/g, "");
}
