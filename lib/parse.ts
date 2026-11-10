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

export interface AssFont {
  font: string;
  bold: boolean;
}

/**
 * The typeface of the style that carries most of the dialogue in an ASS file,
 * so the overlay can set the original line the way the player itself would.
 * Returns null for other formats or when no usable style is found.
 */
export function assDialogueFont(input: string): AssFont | null {
  const styles = new Map<string, AssFont>();
  const uses = new Map<string, number>();
  let section = '';
  let format: string[] = [];
  for (const raw of input.replace(/\r/g, '').split('\n')) {
    const line = raw.trim();
    if (line.startsWith('[')) {
      section = /styles\]/i.test(line) ? 'styles' : /^\[events\]/i.test(line) ? 'events' : '';
      format = [];
      continue;
    }
    if (/^format:/i.test(line)) {
      format = line
        .slice(7)
        .split(',')
        .map((f) => f.trim().toLowerCase());
      continue;
    }
    if (!format.length) continue;
    if (section === 'styles' && /^style:/i.test(line)) {
      const f = line.slice(6).split(',');
      const name = f[format.indexOf('name')]?.trim();
      const font = f[format.indexOf('fontname')]?.trim().replace(/^@/, '');
      const bold = f[format.indexOf('bold')]?.trim();
      // Only plain family names: this ends up inside a CSS font-family value.
      if (name && font && /^[\p{L}\p{N} ._-]+$/u.test(font)) {
        styles.set(name, { font, bold: !!bold && bold !== '0' });
      }
    } else if (section === 'events' && /^dialogue:/i.test(line)) {
      const f = line.slice(9).split(',');
      const text = f.slice(format.indexOf('text')).join(',');
      if (/\\p[1-9]/.test(text) || /\\(pos|move)\s*\(/.test(text)) continue;
      const name = f[format.indexOf('style')]?.trim().replace(/^\*/, '') ?? '';
      uses.set(name, (uses.get(name) ?? 0) + 1);
    }
  }
  let best: AssFont | null = null;
  let bestUses = 0;
  for (const [name, n] of uses) {
    const style = styles.get(name);
    if (style && n > bestUses) {
      best = style;
      bestUses = n;
    }
  }
  return best;
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
