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
}

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

async function handleTranslate(req: TranslateRequest, tabId: number): Promise<void> {
  const send = (cues: Cue[], state: 'translating' | 'done' | 'error', error?: string) =>
    browser.tabs.sendMessage(tabId, { type: 'cues', key: req.key, cues, state, error }).catch(() => {});

  const cacheKey = `tr|${req.tl}|${req.key}`;
  const cached = await readCache(cacheKey, req.cues);
  if (cached) {
    await send(
      req.cues.map((c, i) => ({ ...c, tr: cached[i] })),
      'done',
    );
    return;
  }

  await send(req.cues, 'translating');
  const apply = (map: Map<string, string>) => req.cues.map((c) => ({ ...c, tr: map.get(c.text) }));
  try {
    const map = await translateLines(
      req.cues.map((c) => c.text),
      req.sl,
      req.tl,
      (partial) => void send(apply(partial), 'translating'),
    );
    const done = apply(map);
    await send(done, 'done');
    await writeCache(
      cacheKey,
      done.map((c) => c.tr ?? ''),
    );
  } catch (e) {
    await send(req.cues, 'error', String(e));
  }
}

export default defineBackground(() => {
  browser.runtime.onMessage.addListener((msg: any, sender) => {
    const tabId = sender.tab?.id;
    if (tabId == null || !msg) return;
    if (msg.type === 'translate') void handleTranslate(msg as TranslateRequest, tabId);
    // Lets one frame tell every frame in the tab something (the player may live in an iframe).
    if (msg.type === 'relay') void browser.tabs.sendMessage(tabId, msg.payload).catch(() => {});
  });
});
