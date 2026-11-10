import Anthropic from '@anthropic-ai/sdk';
import { betaZodOutputFormat } from '@anthropic-ai/sdk/helpers/beta/zod';
import { z } from 'zod';

/**
 * Context-aware subtitle translation with Claude. The whole episode script is
 * sent as (cached) context and translated in chunks, so each line is rendered
 * with knowledge of the scene, the speakers and the series.
 */

export const CLAUDE_MODELS = ['claude-opus-5-5', 'claude-sonnet-5-5'] as const;
export type ClaudeModel = (typeof CLAUDE_MODELS)[number];
export type NameStyle = 'mainland' | 'taiwan' | 'hongkong';
/** claude-code: the Claude Code CLI on this machine, through the local bridge. api: the Claude API with the user's key. machine: no Claude pass. */
export type Engine = 'claude-code' | 'api' | 'machine';

export const BRIDGE_URL = 'http://127.0.0.1:47615';

export interface EpisodeMeta {
  /** Browser tab title: carries the series and episode name */
  title: string;
  /** e.g. en-US or ja-JP, null if unknown */
  audioLocale: string | null;
  sourceLang: string;
  targetLang: string;
  nameStyle: NameStyle;
}

const CHUNK_LINES = 80;
/** The first request covers only what is about to be spoken, so it comes back fast. */
const FIRST_CHUNK_LINES = 30;
const CONCURRENCY = 2;

const Output = z.object({
  lines: z.array(z.object({ id: z.number(), text: z.string() })),
});

const TARGET_NAMES: Record<string, string> = {
  'zh-CN': 'Simplified Chinese (简体中文)',
  'zh-TW': 'Traditional Chinese (繁體中文)',
  ja: 'Japanese',
  ko: 'Korean',
  en: 'English',
};

const NAME_STYLES: Record<NameStyle, string> = {
  mainland: 'the names established in mainland China (e.g. 贝吉塔, 比克, 龟派气功)',
  taiwan: 'the names established in Taiwan (e.g. 達爾, 比克, 龜派氣功)',
  hongkong: 'the names established in Hong Kong (e.g. 比達, 笛子魔童, 龜波氣功)',
};

export function systemPrompt(meta: EpisodeMeta): string {
  const target = TARGET_NAMES[meta.targetLang] ?? meta.targetLang;
  const dubbed = meta.audioLocale ? !meta.audioLocale.startsWith('ja') : null;
  const source =
    dubbed === false
      ? `The audio is the original Japanese and the script below is an English subtitle translation of it. Translate what the Japanese line most plausibly said, using what you know about the series, rather than mirroring English phrasing: restore forms of address, honorific nuance and catchphrases the way a ${target} audience knows them.`
      : dubbed === true
        ? `The audio is a dub (${meta.audioLocale}) and the script below is its closed-caption transcript. The viewer hears exactly these words, so translate what the dub says, even where it departs from the Japanese original.`
        : 'The script below is the subtitle track of the episode.';
  const names = target.includes('Chinese')
    ? `For character names, techniques, places and recurring terms, use ${NAME_STYLES[meta.nameStyle]}, and keep every name consistent across the whole episode.`
    : 'Use the names by which characters, techniques and places are established for that audience, and keep them consistent.';
  // English scripts carry localized or literal names ("Ox King"), and a
  // word-by-word rendering (牛王) is the most visible kind of mistake.
  const literal = `English subtitles and dubs often give names in a localized or literal English form, such as "Ox King", "Master Roshi", "Flying Nimbus" or "Spirit Bomb". These are names, not descriptions: work out from the series who or what is meant and write the name the ${target} audience already knows it by${target.includes('Chinese') ? ' ("Ox King" is 牛魔王, never 牛王)' : ''}. Only when a name has no established form in ${target} should you transliterate or translate it yourself, and then use that one form every time.`;

  return `You are translating the subtitles of an anime episode into ${target} for a viewer who is a native speaker of that language. They are watching together with someone who follows the original subtitles, and they miss part of the dialogue: idioms, slang, fast or emotional speech. Your line is drawn directly under the original line, so it has to convey what that line means in this scene, in the voice of whoever is speaking, the way a good human subtitler would write it.

${source}

${names}

${literal}

The script is a list of numbered lines in playback order. One sentence often runs across several lines; translate it as a sentence, then divide it so that each numbered line carries the part shown on screen at that moment. Subtitles are read in a second or two, so prefer short, natural spoken ${target} over complete but stiff sentences. Sound descriptions and speaker labels from closed captions (such as "[GRUNTS]" or "GOKU:") should stay brief and in the same style.

Return exactly one entry for every line number you are asked to translate, with the same id.`;
}

function userContext(meta: EpisodeMeta, lines: string[]): string {
  const script = lines.map((l, i) => `${i + 1}\t${l}`).join('\n');
  return `Page title: ${meta.title || 'unknown'}\nSubtitle language: ${meta.sourceLang}\n\nFull script of the episode:\n${script}`;
}

function friendlyError(e: unknown): Error {
  if (e instanceof Anthropic.AuthenticationError) return new Error('Claude API key 无效');
  if (e instanceof Anthropic.PermissionDeniedError) return new Error('这个 API key 没有权限使用所选模型');
  if (e instanceof Anthropic.RateLimitError) return new Error('Claude 请求被限流，请稍后再试');
  if (e instanceof Anthropic.APIConnectionError) return new Error('连不上 Claude API');
  if (e instanceof Anthropic.APIError) return new Error(`Claude API 错误 ${e.status ?? ''}: ${e.message}`);
  return e instanceof Error ? e : new Error(String(e));
}

type Line = { id: number; text: string };
/** Sends one chunk request and returns the translated lines, or null to leave them untranslated. */
type Transport = (system: string, context: string, instruction: string) => Promise<Line[] | null>;

function apiTransport(apiKey: string, model: ClaudeModel): Transport {
  // The key is the user's own and lives in extension storage; requests go
  // straight from the extension's service worker to the API.
  const client = new Anthropic({ apiKey, dangerouslyAllowBrowser: true });
  return async (system, context, instruction) => {
    try {
      const response = await client.beta.messages.parse({
        model,
        max_tokens: 16000,
        betas: ['server-side-fallback-2026-07-01'],
        // If a safety classifier declines a chunk, retry it on the fallback model.
        fallbacks: 'default',
        thinking: { type: 'adaptive' },
        output_config: { effort: 'medium', format: betaZodOutputFormat(Output) },
        system,
        messages: [
          {
            role: 'user',
            content: [
              // Identical for every chunk of the episode, so it is cached.
              { type: 'text', text: context, cache_control: { type: 'ephemeral' } },
              { type: 'text', text: instruction },
            ],
          },
        ],
      });
      if (response.stop_reason === 'refusal' || !response.parsed_output) return null;
      return response.parsed_output.lines;
    } catch (e) {
      throw friendlyError(e);
    }
  };
}

function bridgeTransport(model: ClaudeModel): Transport {
  const alias = model.includes('sonnet') ? 'sonnet' : 'opus';
  return async (system, context, instruction) => {
    let res: Response;
    try {
      res = await fetch(`${BRIDGE_URL}/translate`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ system, prompt: `${context}\n\n${instruction}`, model: alias }),
      });
    } catch {
      throw new Error('连不上本机桥接服务，请先运行 npm run bridge');
    }
    const data = (await res.json().catch(() => ({}))) as { lines?: unknown; error?: string };
    if (!res.ok) throw new Error(`本机 Claude Code 出错：${data.error ?? res.status}`);
    const parsed = Output.safeParse(data);
    return parsed.success ? parsed.data.lines : null;
  };
}

/**
 * [start, end) ranges in the order they are translated: a short chunk at the
 * playback position, then the rest of the episode, then what came before.
 */
export function chunkOrder(total: number, startIndex: number): [number, number][] {
  const from = Math.max(0, Math.min(total, Math.floor(startIndex)));
  const order: [number, number][] = [];
  const firstEnd = Math.min(total, from + FIRST_CHUNK_LINES);
  if (firstEnd > from) order.push([from, firstEnd]);
  for (let i = firstEnd; i < total; i += CHUNK_LINES) order.push([i, Math.min(total, i + CHUNK_LINES)]);
  for (let i = 0; i < from; i += CHUNK_LINES) order.push([i, Math.min(from, i + CHUNK_LINES)]);
  return order;
}

export async function translateWithClaude(opts: {
  engine: Exclude<Engine, 'machine'>;
  apiKey: string;
  model: ClaudeModel;
  lines: string[];
  /** Index of the line being watched now: translation starts there */
  startIndex: number;
  meta: EpisodeMeta;
  /** Called after each chunk with index -> translation for that chunk */
  onChunk: (done: Map<number, string>) => void;
  isCancelled: () => boolean;
}): Promise<void> {
  const { lines, meta } = opts;
  const transport = opts.engine === 'api' ? apiTransport(opts.apiKey, opts.model) : bridgeTransport(opts.model);
  const system = systemPrompt(meta);
  const context = userContext(meta, lines);

  const order = chunkOrder(lines.length, opts.startIndex);

  async function runChunk([start, end]: [number, number]): Promise<void> {
    const result = await transport(system, context, `Translate lines ${start + 1} to ${end}.`);
    if (!result) return; // these lines stay untranslated
    const done = new Map<number, string>();
    for (const item of result) {
      const index = Math.round(item.id) - 1;
      const text = item.text.trim();
      if (index >= start && index < end && text) done.set(index, text);
    }
    opts.onChunk(done);
  }

  // First chunk alone (lets the API cache the shared context), then fan out.
  if (order.length && !opts.isCancelled()) await runChunk(order[0]);
  let next = 1;
  const worker = async () => {
    while (next < order.length && !opts.isCancelled()) await runChunk(order[next++]);
  };
  await Promise.all(Array.from({ length: CONCURRENCY }, worker));
}
