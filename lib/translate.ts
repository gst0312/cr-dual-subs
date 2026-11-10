/**
 * Translation provider. Uses Google Translate's keyless web endpoint, which is
 * unofficial and rate limited: fine for personal use, swap it for a real API
 * (DeepL, an LLM, ...) by replacing `translateBatch`.
 */

const MAX_BATCH_CHARS = 1200;
const CONCURRENCY = 3;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function request(text: string, sl: string, tl: string): Promise<string> {
  const url =
    'https://translate.googleapis.com/translate_a/single?client=gtx&dt=t' +
    `&sl=${encodeURIComponent(sl)}&tl=${encodeURIComponent(tl)}&q=${encodeURIComponent(text)}`;
  let lastError: unknown;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const res = await fetch(url);
      if (!res.ok) throw new Error(`translate HTTP ${res.status}`);
      const data = await res.json();
      return (data[0] as unknown[][]).map((seg) => seg[0] ?? '').join('');
    } catch (e) {
      lastError = e;
      await sleep(600 * (attempt + 1));
    }
  }
  throw lastError;
}

async function translateBatch(lines: string[], sl: string, tl: string): Promise<string[]> {
  const joined = await request(lines.join('\n'), sl, tl);
  const parts = joined.split('\n').map((s) => s.trim());
  if (parts.length === lines.length) return parts;
  // The engine merged or split lines: fall back to one request per line.
  const out: string[] = [];
  for (const line of lines) out.push((await request(line, sl, tl)).trim());
  return out;
}

export function makeBatches(lines: string[], maxChars = MAX_BATCH_CHARS): string[][] {
  const batches: string[][] = [];
  let cur: string[] = [];
  let size = 0;
  for (const line of lines) {
    if (cur.length && size + line.length + 1 > maxChars) {
      batches.push(cur);
      cur = [];
      size = 0;
    }
    cur.push(line);
    size += line.length + 1;
  }
  if (cur.length) batches.push(cur);
  return batches;
}

/**
 * Translates unique lines and reports progress as a text -> translation map.
 * `sl` / `tl` are locales such as en-US or zh-CN.
 */
export async function translateLines(
  lines: string[],
  sl: string,
  tl: string,
  onProgress: (done: Map<string, string>) => void,
): Promise<Map<string, string>> {
  const source = sl.split('-')[0];
  const unique = [...new Set(lines)];
  const batches = makeBatches(unique);
  const result = new Map<string, string>();
  let next = 0;
  let failure: unknown;

  async function worker() {
    while (next < batches.length && !failure) {
      const batch = batches[next++];
      try {
        const translated = await translateBatch(batch, source, tl);
        batch.forEach((line, i) => result.set(line, translated[i]));
        onProgress(result);
      } catch (e) {
        failure = e;
      }
    }
  }
  await Promise.all(Array.from({ length: CONCURRENCY }, worker));
  if (failure) throw failure;
  return result;
}
