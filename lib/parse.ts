import type { Cue } from './types';

function clean(text: string): string {
  return text
    .replace(/<[^>]*>/g, '')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&nbsp;/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function vttTime(s: string): number {
  const parts = s.replace(',', '.').split(':').map(Number);
  let t = 0;
  for (const p of parts) t = t * 60 + p;
  return t;
}

export function parseVtt(input: string): Cue[] {
  const cues: Cue[] = [];
  const blocks = input.replace(/\r/g, '').split(/\n{2,}/);
  const timing = /((?:\d+:)?\d{1,2}:\d{2}[.,]\d{1,3})\s*-->\s*((?:\d+:)?\d{1,2}:\d{2}[.,]\d{1,3})/;
  for (const block of blocks) {
    const lines = block.split('\n');
    const i = lines.findIndex((l) => timing.test(l));
    if (i < 0) continue;
    const m = timing.exec(lines[i])!;
    const text = clean(lines.slice(i + 1).join(' '));
    if (!text) continue;
    cues.push({ start: vttTime(m[1]), end: vttTime(m[2]), text });
  }
  return finish(cues);
}

function assTime(s: string): number {
  const m = /(\d+):(\d{2}):(\d{2})[.:](\d{1,3})/.exec(s.trim());
  if (!m) return NaN;
  return +m[1] * 3600 + +m[2] * 60 + +m[3] + +m[4] / 10 ** m[4].length;
}

/**
 * Parses dialogue out of an ASS file. Typeset signs (positioned text, vector
 * drawings) are dropped: they would pile up at the bottom as noise.
 */
export function parseAss(input: string): Cue[] {
  const cues: Cue[] = [];
  let inEvents = false;
  let format: string[] = [];
  for (const raw of input.replace(/\r/g, '').split('\n')) {
    const line = raw.trim();
    if (line.startsWith('[')) {
      inEvents = /^\[events\]/i.test(line);
      continue;
    }
    if (!inEvents) continue;
    if (/^format:/i.test(line)) {
      format = line
        .slice(7)
        .split(',')
        .map((f) => f.trim().toLowerCase());
      continue;
    }
    if (!/^dialogue:/i.test(line) || !format.length) continue;
    const body = line.slice(9).trim();
    // The last field (Text) may itself contain commas.
    const fields: string[] = [];
    let rest = body;
    for (let i = 0; i < format.length - 1; i++) {
      const c = rest.indexOf(',');
      if (c < 0) break;
      fields.push(rest.slice(0, c));
      rest = rest.slice(c + 1);
    }
    fields.push(rest);
    if (fields.length !== format.length) continue;
    const get = (name: string) => fields[format.indexOf(name)] ?? '';
    const rawText = get('text');
    if (/\\p[1-9]/.test(rawText) || /\\(pos|move)\s*\(/.test(rawText)) continue;
    const text = clean(
      rawText
        .replace(/\{[^}]*\}/g, '')
        .replace(/\\[Nn]/g, ' ')
        .replace(/\\h/g, ' '),
    );
    const start = assTime(get('start'));
    const end = assTime(get('end'));
    if (!text || Number.isNaN(start) || Number.isNaN(end)) continue;
    cues.push({ start, end, text });
  }
  return finish(cues);
}

function finish(cues: Cue[]): Cue[] {
  cues.sort((a, b) => a.start - b.start || a.end - b.end);
  const out: Cue[] = [];
  for (const c of cues) {
    const prev = out[out.length - 1];
    if (prev && prev.start === c.start && prev.end === c.end && prev.text === c.text) continue;
    out.push(c);
  }
  return out;
}

export function parseSubtitle(input: string): Cue[] {
  const head = input.slice(0, 2000);
  if (/\[script info\]/i.test(head) || /\[events\]/i.test(input)) return parseAss(input);
  return parseVtt(input);
}
