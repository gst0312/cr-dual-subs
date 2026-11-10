import { translateWithClaude } from '@/lib/claude';
import { loadApiKey, loadSettings } from '@/lib/settings';
import { translateLines } from '@/lib/translate';
import type { Cue } from '@/lib/types';

const INDEX_KEY = 'trIndex';
const MAX_CACHED_EPISODES = 200;

interface TranslateRequest {
  type: 'translate';
  key: string;
  cues: Cue[];
  sl: string;
  tl: string;
  audioLocale: string | null;
  /** Playback position when the request was made, seconds */
  time: number;
}

/** Latest job per tab: an older job stops once a newer episode starts. */
const jobs = new Map<number, string>();

async function readCache(cacheKey: string, cues: Cue[]): Promise<string[] | null> {
  const stored = await browser.storage.local.get(cacheKey);
  const tr = stored[cacheKey] as string[] | undefined;
  return Array.isArray(tr) && tr.length === cues.length ? tr : null;
}

async function writeCache(cacheKey: string, tr: string[]): Promise<void> {
  const stored = await browser.storage.local.get(INDEX_KEY);
  const index = ((stored[INDEX_KEY] as string[] | undefined) ?? []).filter((k) => k !== cacheKey);
  index.push(cacheKey);
  const evicted = index.splice(0, Math.max(0, index.length - MAX_CACHED_EPISODES));
  if (evicted.length) await browser.storage.local.remove(evicted);
  await browser.storage.local.set({ [cacheKey]: tr, [INDEX_KEY]: index });
}

async function handleTranslate(req: TranslateRequest, tabId: number, tabTitle: string): Promise<void> {
  jobs.set(tabId, req.key);
  const current = () => jobs.get(tabId) === req.key;
  const send = (cues: Cue[], status?: string) => {
    if (!current()) return Promise.resolve();
    return browser.tabs.sendMessage(tabId, { type: 'cues', key: req.key, cues, status }).catch(() => {});
  };
  const withTr = (tr: (string | undefined)[]) => req.cues.map((c, i) => ({ ...c, tr: tr[i] }));

  const [settings, apiKey] = await Promise.all([loadSettings(), loadApiKey()]);

  // Machine translation runs only when it is the chosen engine: with a Claude
  // engine every line on screen comes from Claude, and nothing goes to Google.
  if (settings.engine === 'machine') {
    const machineKey = `tr|mt|${req.key}`;
    const cached = await readCache(machineKey, req.cues);
    if (cached) return void send(withTr(cached), '双语字幕：已载入机翻译文');
    await send(req.cues, '双语字幕：翻译中…');
    try {
      const map = await translateLines(
        req.cues.map((c) => c.text),
        req.sl,
        req.tl,
        (partial) => void send(withTr(req.cues.map((c) => partial.get(c.text)))),
      );
      const tr = req.cues.map((c) => map.get(c.text));
      await writeCache(
        machineKey,
        tr.map((t) => t ?? ''),
      );
      await send(withTr(tr), '双语字幕：机翻完成');
    } catch (e) {
      await send(req.cues, `双语字幕：机翻失败（${String(e)}）`);
    }
    return;
  }

  if (settings.engine === 'api' && !apiKey) {
    return void send(req.cues, '双语字幕：请先在扩展弹窗填入 Claude API key');
  }

  const claudeKey = `tr|claude|${settings.model}|${settings.nameStyle}|${req.key}`;
  const cached = await readCache(claudeKey, req.cues);
  if (cached) return void send(withTr(cached), '双语字幕：已载入 Claude 译文');

  // Context-aware translation, starting from what is being watched. Lines
  // show the original alone until their translation arrives.
  const tr: (string | undefined)[] = [];
  await send(req.cues, '双语字幕：Claude 翻译中…');
  const startIndex = Math.max(
    0,
    req.cues.findIndex((c) => c.end > req.time),
  );
  let translated = 0;
  try {
    await translateWithClaude({
      engine: settings.engine === 'api' ? 'api' : 'claude-code',
      apiKey,
      model: settings.model,
      lines: req.cues.map((c) => c.text),
      startIndex,
      meta: {
        title: tabTitle,
        audioLocale: req.audioLocale,
        sourceLang: req.sl,
        targetLang: req.tl,
        nameStyle: settings.nameStyle,
      },
      isCancelled: () => !current(),
      onChunk: (done) => {
        for (const [i, text] of done) {
          if (tr[i] === undefined) translated++;
          tr[i] = text;
        }
        void send(withTr(tr), `双语字幕：Claude 翻译中… ${translated}/${req.cues.length}`);
      },
    });
    if (!current()) return;
    if (translated === req.cues.length) {
      await writeCache(
        claudeKey,
        tr.map((t) => t ?? ''),
      );
      await send(withTr(tr), '双语字幕：Claude 翻译完成');
    } else {
      await send(withTr(tr), `双语字幕：Claude 完成 ${translated}/${req.cues.length} 行，其余没有译文`);
    }
  } catch (e) {
    await send(withTr(tr), `双语字幕：${e instanceof Error ? e.message : String(e)}`);
  }
}

export default defineBackground(() => {
  browser.runtime.onMessage.addListener((msg: any, sender) => {
    const tabId = sender.tab?.id;
    if (tabId == null || !msg) return;
    if (msg.type === 'translate') {
      void handleTranslate(msg as TranslateRequest, tabId, sender.tab?.title ?? '');
    }
    // Lets one frame tell every frame in the tab something (the player may live in an iframe).
    if (msg.type === 'relay') void browser.tabs.sendMessage(tabId, msg.payload).catch(() => {});
  });
  browser.tabs.onRemoved.addListener((tabId) => jobs.delete(tabId));
});
