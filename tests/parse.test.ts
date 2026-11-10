import { describe, expect, it } from 'vitest';
import { parseAss, parseSubtitle, parseVtt } from '../lib/parse';
import { makeBatches } from '../lib/translate';

describe('parseVtt', () => {
  it('parses cues, strips tags and joins lines', () => {
    const vtt = `WEBVTT

1
00:00:01.000 --> 00:00:03.500 line:90%
<i>Kakarot!</i>
You're late.

00:01:02.250 --> 00:01:04.000
- Hey &amp; hi
`;
    expect(parseVtt(vtt)).toEqual([
      { start: 1, end: 3.5, text: "Kakarot! You're late." },
      { start: 62.25, end: 64, text: '- Hey & hi' },
    ]);
  });
});

describe('parseAss', () => {
  const ass = `[Script Info]
Title: test

[V4+ Styles]
Format: Name, Fontname
Style: Default,Arial

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
Dialogue: 0,0:00:05.00,0:00:07.50,Default,,0,0,0,,{\\i1}Wait, Goku!{\\i0}\\NDon't go.
Dialogue: 0,0:00:01.00,0:00:02.00,Sign,,0,0,0,,{\\pos(320,50)}CAPSULE CORP
Dialogue: 0,0:00:03.00,0:00:04.00,Default,,0,0,0,,{\\p1}m 0 0 l 10 10{\\p0}
Comment: 0,0:00:08.00,0:00:09.00,Default,,0,0,0,,ignored
`;
  it('keeps dialogue with commas, drops signs and drawings', () => {
    expect(parseAss(ass)).toEqual([{ start: 5, end: 7.5, text: "Wait, Goku! Don't go." }]);
  });
  it('is auto-detected', () => {
    expect(parseSubtitle(ass)).toHaveLength(1);
    expect(parseSubtitle('WEBVTT\n\n00:01.000 --> 00:02.000\nHi')).toEqual([
      { start: 1, end: 2, text: 'Hi' },
    ]);
  });
});

describe('makeBatches', () => {
  it('keeps every line and respects the size limit', () => {
    const lines = Array.from({ length: 50 }, (_, i) => `line number ${i}`);
    const batches = makeBatches(lines, 100);
    expect(batches.flat()).toEqual(lines);
    for (const b of batches) expect(b.join('\n').length).toBeLessThanOrEqual(100);
  });
});
