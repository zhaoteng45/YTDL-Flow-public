export interface ParsedUrlInput {
  urls: string[];
  invalidEntries: string[];
}

function isHttpUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === 'http:' || url.protocol === 'https:';
  } catch {
    return false;
  }
}

export function parseUrlInput(input: string): ParsedUrlInput {
  const urls: string[] = [];
  const invalidEntries: string[] = [];
  const seen = new Set<string>();

  for (const rawEntry of input.split(/\s+/)) {
    const value = rawEntry.trim();
    if (!value) continue;

    if (!isHttpUrl(value)) {
      invalidEntries.push(value);
      continue;
    }

    if (seen.has(value)) continue;
    seen.add(value);
    urls.push(value);
  }

  return { urls, invalidEntries };
}
