import { parseSubtitle } from '@/lib/parse';
import { DEFAULTS, loadSettings, onSettingsChanged, type Settings } from '@/lib/settings';
import { CONTENT_SOURCE, MAIN_SOURCE, type Cue, type Track, type TrackList } from '@/lib/types';

/**
 * Runs in every Crunchyroll frame. Picks the subtitle track to translate,
 * hands it to the background for translation, and draws the bilingual
 * subtitle over whichever frame holds the <video>.
 */
export default defineContentScript({
  matches: ['*://*.crunchyroll.com/*'],
  allFrames: true,
  runAt: 'document_start',
  main() {
    let settings: Settings = DEFAULTS;
    let cues: Cue[] = [];
    let currentKey = '';
    let lastTracks: TrackList | null = null;
    let fetchSeq = 0;
    const pendingFetches = new Map<number, (r: { ok: boolean; text?: string; error?: string }) => void>();

    // ---- talking to the MAIN-world script --------------------------------
    const fetchInPage = (url: string) =>
      new Promise<string>((resolve, reject) => {
        const id = ++fetchSeq;
        pendingFetches.set(id, (r) => (r.ok ? resolve(r.text ?? '') : reject(new Error(r.error))));
        window.postMessage({ source: CONTENT_SOURCE, type: 'fetch', id, url }, '*');
      });

    window.addEventListener('message', (ev) => {
      if (ev.source !== window) return;
      const msg = ev.data;
      if (!msg || msg.source !== MAIN_SOURCE) return;
      if (msg.type === 'fetched') {
        pendingFetches.get(msg.id)?.(msg);
        pendingFetches.delete(msg.id);
      } else if (msg.type === 'tracks') {
        lastTracks = msg.tracks as TrackList;
        void startEpisode();
      }
    });

    // ---- choosing and loading a track ------------------------------------
    function chooseTrack(tracks: TrackList, lang: string): Track | undefined {
      const base = lang.split('-')[0];
      const find = (list: Track[]) =>
        list.find((t) => t.locale === lang) ?? list.find((t) => t.locale.split('-')[0] === base);
      // Closed captions carry the full dialogue of a dub; on a dub the plain
      // subtitle track is usually signs and songs only.
      return find(tracks.captions) ?? find(tracks.subtitles);
    }

    const broadcast = (payload: Record<string, unknown>) =>
      browser.runtime.sendMessage({ type: 'relay', payload }).catch(() => {});

    async function startEpisode() {
      if (!lastTracks || !settings.enabled) return;
      const track = chooseTrack(lastTracks, settings.sourceLang);
      if (!track) {
        const have = [...lastTracks.captions, ...lastTracks.subtitles].map((t) => t.locale);
        void broadcast({
          type: 'status',
          text: `双语字幕：这一集没有 ${settings.sourceLang} 字幕轨（可用：${[...new Set(have)].join(', ') || '无'}）`,
        });
        return;
      }
      let key: string;
      try {
        key = `${track.locale}|${new URL(track.url).pathname}`;
      } catch {
        key = `${track.locale}|${track.url}`;
      }
      const requestKey = `${key}|${settings.targetLang}`;
      if (requestKey === currentKey) return;
      currentKey = requestKey;
      try {
        const parsed = parseSubtitle(await fetchInPage(track.url));
        if (requestKey !== currentKey) return;
        if (!parsed.length) {
          void broadcast({ type: 'status', text: '双语字幕：字幕轨里没有找到对白' });
          return;
        }
        await browser.runtime.sendMessage({
          type: 'translate',
          key: requestKey,
          cues: parsed,
          sl: track.locale,
          tl: settings.targetLang,
        });
      } catch (e) {
        currentKey = '';
        void broadcast({ type: 'status', text: `双语字幕：读取字幕失败（${String(e)}）` });
      }
    }

    // ---- messages from the background (reach every frame) ----------------
    let activeKey = '';
    browser.runtime.onMessage.addListener((msg: any) => {
      if (!msg) return;
      if (msg.type === 'cues') {
        const fresh = msg.key !== activeKey;
        activeKey = msg.key;
        cues = msg.cues as Cue[];
        if (msg.state === 'error') showStatus(`双语字幕：翻译失败（${msg.error}）`);
        else if (msg.state === 'done') showStatus('双语字幕：翻译完成');
        else if (fresh) showStatus('双语字幕：翻译中…');
      } else if (msg.type === 'status') {
        showStatus(msg.text);
      }
    });

    // ---- drawing ---------------------------------------------------------
    let box: HTMLDivElement | null = null;
    let origEl: HTMLDivElement | null = null;
    let trEl: HTMLDivElement | null = null;
    let statusEl: HTMLDivElement | null = null;
    let statusText = '';
    let statusUntil = 0;
    let shownOrig = '';
    let shownTr = '';

    const SHADOW =
      '0 0 4px #000, 0 0 4px #000, 2px 2px 3px #000, -1px -1px 2px #000, 1px -1px 2px #000, -1px 1px 2px #000';

    function ensureElements(host: Element) {
      if (!box) {
        box = document.createElement('div');
        box.style.cssText =
          'position:fixed;z-index:2147483647;pointer-events:none;text-align:center;' +
          'font-family:"PingFang SC","Microsoft YaHei","Noto Sans CJK SC",Arial,sans-serif;' +
          `font-weight:600;line-height:1.3;text-shadow:${SHADOW};white-space:pre-line;`;
        origEl = document.createElement('div');
        origEl.style.color = '#fff';
        trEl = document.createElement('div');
        trEl.style.color = '#ffe66d';
        box.append(origEl, trEl);

        statusEl = document.createElement('div');
        statusEl.style.cssText =
          'position:fixed;z-index:2147483647;pointer-events:none;padding:4px 10px;border-radius:6px;' +
          'background:rgba(0,0,0,.65);color:#fff;font:13px/1.4 "PingFang SC",Arial,sans-serif;';
      }
      if (box.parentElement !== host) host.append(box, statusEl!);
    }

    function showStatus(text: string) {
      statusText = text;
      statusUntil = Date.now() + 4000;
    }

    function findVideo(): HTMLVideoElement | null {
      let best: HTMLVideoElement | null = null;
      let bestArea = 0;
      for (const v of document.querySelectorAll('video')) {
        const r = v.getBoundingClientRect();
        const area = r.width * r.height;
        if (area > bestArea) {
          best = v;
          bestArea = area;
        }
      }
      return bestArea > 200 * 100 ? best : null;
    }

    function tick() {
      const video = findVideo();
      if (!video || !settings.enabled) {
        if (box) box.style.display = 'none';
        if (statusEl) statusEl.style.display = 'none';
        return;
      }
      ensureElements(document.fullscreenElement ?? document.documentElement);
      const r = video.getBoundingClientRect();

      const showStatusNow = Date.now() < statusUntil;
      statusEl!.style.display = showStatusNow ? 'block' : 'none';
      if (showStatusNow) {
        statusEl!.textContent = statusText;
        statusEl!.style.left = `${r.left + 12}px`;
        statusEl!.style.top = `${r.top + 12}px`;
      }

      const t = video.currentTime;
      const active = cues.filter((c) => t >= c.start && t < c.end);
      const orig = settings.showOriginal ? active.map((c) => c.text).join('\n') : '';
      const tr = active
        .map((c) => c.tr ?? '')
        .filter(Boolean)
        .join('\n');
      if (!orig && !tr) {
        box!.style.display = 'none';
        shownOrig = shownTr = '';
        return;
      }
      if (orig !== shownOrig) origEl!.textContent = shownOrig = orig;
      if (tr !== shownTr) trEl!.textContent = shownTr = tr;

      const size = Math.max(12, r.height * 0.042 * (settings.fontSize / 100));
      box!.style.display = 'block';
      box!.style.left = `${r.left + r.width * 0.05}px`;
      box!.style.width = `${r.width * 0.9}px`;
      box!.style.bottom = `${window.innerHeight - r.bottom + r.height * (settings.bottomOffset / 100)}px`;
      origEl!.style.fontSize = `${size * 0.85}px`;
      trEl!.style.fontSize = `${size}px`;
    }

    // ---- boot ------------------------------------------------------------
    void loadSettings().then((s) => {
      settings = s;
      void startEpisode();
    });
    onSettingsChanged((s) => {
      const retranslate = s.targetLang !== settings.targetLang || s.sourceLang !== settings.sourceLang;
      const reenabled = s.enabled && !settings.enabled;
      settings = s;
      if (retranslate || reenabled) void startEpisode();
    });
    setInterval(tick, 100);
  },
});
