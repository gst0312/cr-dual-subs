import { CONTENT_SOURCE, MAIN_SOURCE, type Track } from '@/lib/types';

/**
 * Runs in the page's own JS world. Watches the player's network calls for the
 * playback response that lists subtitle tracks, and fetches subtitle files on
 * behalf of the content script (same origin and CORS rules as the player).
 */
export default defineContentScript({
  matches: ['*://*.crunchyroll.com/*'],
  allFrames: true,
  runAt: 'document_start',
  world: 'MAIN',
  main() {
    const post = (msg: Record<string, unknown>) =>
      window.postMessage({ source: MAIN_SOURCE, ...msg }, '*');

    const pick = (obj: unknown): Track[] => {
      if (!obj || typeof obj !== 'object') return [];
      const out: Track[] = [];
      for (const [locale, v] of Object.entries(obj as Record<string, any>)) {
        if (v && typeof v.url === 'string' && v.url) {
          out.push({ locale: v.language ?? v.locale ?? locale, url: v.url, format: v.format ?? '' });
        }
      }
      return out;
    };

    const inspect = (data: any) => {
      if (!data || typeof data !== 'object') return;
      const subtitles = pick(data.subtitles);
      const captions = pick(data.captions);
      if (!subtitles.length && !captions.length) return;
      post({ type: 'tracks', tracks: { subtitles, captions, audioLocale: data.audioLocale ?? null } });
    };

    const interesting = (url: string) => /play/i.test(url);

    const origFetch = window.fetch;
    window.fetch = async function (this: unknown, ...args: Parameters<typeof fetch>) {
      const res = await origFetch.apply(this as any, args);
      try {
        const url = res.url || '';
        if (interesting(url) && (res.headers.get('content-type') || '').includes('json')) {
          res
            .clone()
            .json()
            .then(inspect)
            .catch(() => {});
        }
      } catch {
        // never break the page's own request
      }
      return res;
    } as typeof fetch;

    const origOpen = XMLHttpRequest.prototype.open;
    XMLHttpRequest.prototype.open = function (this: XMLHttpRequest, ...args: any[]) {
      const url = String(args[1] ?? '');
      if (interesting(url)) {
        this.addEventListener('load', () => {
          try {
            if (this.responseType === 'json') inspect(this.response);
            else if (this.responseType === '' || this.responseType === 'text')
              inspect(JSON.parse(this.responseText));
          } catch {
            // not JSON
          }
        });
      }
      return (origOpen as any).apply(this, args);
    } as typeof XMLHttpRequest.prototype.open;

    window.addEventListener('message', (ev) => {
      if (ev.source !== window) return;
      const msg = ev.data;
      if (!msg || msg.source !== CONTENT_SOURCE || msg.type !== 'fetch') return;
      if (typeof msg.url !== 'string' || !msg.url.startsWith('https://')) return;
      origFetch(msg.url)
        .then((r) => {
          if (!r.ok) throw new Error(`HTTP ${r.status}`);
          return r.text();
        })
        .then((text) => post({ type: 'fetched', id: msg.id, ok: true, text }))
        .catch((e) => post({ type: 'fetched', id: msg.id, ok: false, error: String(e) }));
    });
  },
});
