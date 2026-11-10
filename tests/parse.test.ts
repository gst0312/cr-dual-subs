import { describe, expect, it } from 'vitest';
import { assDialogueFont, parseAss, parseSubtitle, parseVtt } from '../lib/parse';
import { chunkOrder, systemPrompt } from '../lib/claude';
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

describe('assDialogueFont', () => {
  const ass = `[Script Info]

[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, Bold, Italic
Style: Default,Trebuchet MS,24,&H00FFFFFF,-1,0
Style: Sign,Comic Sans MS,20,&H00FFFFFF,0,0
Style: Bad,Evil";x,20,&H00FFFFFF,0,0

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
Dialogue: 0,0:00:01.00,0:00:02.00,Default,,0,0,0,,Hello, there
Dialogue: 0,0:00:02.00,0:00:03.00,Default,,0,0,0,,Again
Dialogue: 0,0:00:03.00,0:00:04.00,Sign,,0,0,0,,{\\pos(10,10)}Shop
Dialogue: 0,0:00:04.00,0:00:05.00,Sign,,0,0,0,,{\\pos(10,10)}Shop
Dialogue: 0,0:00:05.00,0:00:06.00,Sign,,0,0,0,,{\\pos(10,10)}Shop
Dialogue: 0,0:00:06.00,0:00:07.00,Bad,,0,0,0,,x
Dialogue: 0,0:00:06.00,0:00:07.00,Bad,,0,0,0,,x
Dialogue: 0,0:00:06.00,0:00:07.00,Bad,,0,0,0,,x
`;
  it('returns the font of the style most dialogue uses, ignoring signs and unsafe names', () => {
    expect(assDialogueFont(ass)).toEqual({ font: 'Trebuchet MS', bold: true });
  });
  it('returns null without styles', () => {
    expect(assDialogueFont('WEBVTT\n\n00:00:01.000 --> 00:00:02.000\nHi\n')).toBeNull();
  });
});

describe('chunkOrder', () => {
  it('starts with a short chunk at the playback position and covers every line once', () => {
    const order = chunkOrder(200, 50);
    expect(order[0]).toEqual([50, 80]);
    expect(order).toEqual([
      [50, 80],
      [80, 160],
      [160, 200],
      [0, 50],
    ]);
  });
  it('handles the start, the end and an empty script', () => {
    expect(chunkOrder(20, 0)).toEqual([[0, 20]]);
    expect(chunkOrder(100, 100)).toEqual([
      [0, 80],
      [80, 100],
    ]);
    expect(chunkOrder(0, 0)).toEqual([]);
  });
});

describe('systemPrompt', () => {
  it('tells the translator to map literal English names to established ones', () => {
    const p = systemPrompt({ title: '', audioLocale: 'en-US', sourceLang: 'en-US', targetLang: 'zh-CN', nameStyle: 'mainland' });
    expect(p).toContain('牛魔王');
  });
});
