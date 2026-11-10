import { assDialogueFont, parseSubtitle, type AssFont } from '@/lib/parse';
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
        const body = await fetchInPage(track.url);
        const parsed = parseSubtitle(body);
        if (requestKey !== currentKey) return;
        // The frame that holds the video may be another one: relay the font.
        void broadcast({ type: 'font', font: assDialogueFont(body) });
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
          audioLocale: lastTracks.audioLocale,
          time: findVideo()?.currentTime ?? 0,
        });
      } catch (e) {
        currentKey = '';
        void broadcast({ type: 'status', text: `双语字幕：读取字幕失败（${String(e)}）` });
      }
    }

    // ---- messages from the background (reach every frame) ----------------
    browser.runtime.onMessage.addListener((msg: any) => {
      if (!msg) return;
      if (msg.type === 'cues') {
        cues = msg.cues as Cue[];
        if (msg.status) showStatus(msg.status);
      } else if (msg.type === 'font') {
        playerFont = (msg.font as AssFont | null) ?? PLAYER_FONT;
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

    // What Crunchyroll's own renderer sets dialogue in. The real value is read
    // from the subtitle file's styles; this is the usual one, used until then
    // and for tracks that carry no styles (WebVTT).
    const PLAYER_FONT: AssFont = { font: 'Trebuchet MS', bold: true };
    let playerFont = PLAYER_FONT;
    const isCjk = (lang: string) => /^(zh|ja|ko)\b/i.test(lang);

    // Each stack pairs a Latin face with a CJK face of the same character, so
    // the two lines (and digits inside the CJK line) look like one typeface:
    // grotesque + hei, geometric + rounded, Charter/Times + song (similar stroke
    // contrast), Palatino + kai (both calligraphic). Windows faces follow the
    // macOS ones in each stack.
    const FONTS: Record<Settings['fontFamily'], string> = {
      hei: `"Helvetica Neue", "Segoe UI", Arial, "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", "Noto Sans CJK SC", sans-serif`,
      yuan: `"Avenir Next", "Segoe UI", Arial, "Yuanti SC", YouYuan, "PingFang SC", "Microsoft YaHei", sans-serif`,
      song: `Charter, "Times New Roman", Times, "Songti SC", "Noto Serif CJK SC", SimSun, serif`,
      kai: `Palatino, "Palatino Linotype", "Book Antiqua", "Kaiti SC", STKaiti, KaiTi, serif`,
      hand: `"Hannotate SC", "Kaiti SC", STKaiti, KaiTi, sans-serif`,
    };
    // Pastel translation colours over a white original line. The outline takes
    // a very dark shade of the same hue, which reads softer than pure black.
    const THEMES: Record<Settings['trColor'], { tr: string; orig: string; edge: string }> = {
      white: { tr: '#ffffff', orig: '#dde1e7', edge: '10,12,20' },
      cream: { tr: '#fff2cf', orig: '#ffffff', edge: '20,14,6' },
      yellow: { tr: '#ffd97a', orig: '#f6f3ec', edge: '24,16,4' },
      sky: { tr: '#c4e8ff', orig: '#ffffff', edge: '6,14,28' },
      mint: { tr: '#c8f7dc', orig: '#ffffff', edge: '6,20,14' },
      sakura: { tr: '#ffd6e4', orig: '#ffffff', edge: '28,8,16' },
    };

    /**
     * Per-script metrics. CJK glyphs fill the em box and want air between
     * them; Latin text is already spaced by its sidebearings and sets tighter.
     * `lang` also makes the browser pick the right regional glyph variants.
     */
    function styleLine(el: HTMLElement, lang: string) {
      if (el.lang === lang) return;
      el.lang = lang;
      const cjk = isCjk(lang);
      el.style.letterSpacing = cjk ? '.05em' : '.01em';
      el.style.lineHeight = cjk ? '1.3' : '1.22';
    }

    function ensureElements(host: Element) {
      if (!box) {
        box = document.createElement('div');
        box.style.cssText =
          'position:fixed;z-index:2147483647;pointer-events:none;text-align:center;' +
          'font-weight:500;white-space:pre-line;font-kerning:normal;' +
          // Wrapped lines break into even lengths instead of leaving one orphan word.
          'text-wrap:balance;' +
          // The outline is drawn behind the glyphs; its colour comes from the theme.
          'paint-order:stroke fill;stroke-linejoin:round;-webkit-font-smoothing:antialiased;';
        origEl = document.createElement('div');
        origEl.style.cssText = 'margin-bottom:.16em;';
        trEl = document.createElement('div');
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
      box!.style.left = `${r.left + r.width * 0.07}px`;
      box!.style.width = `${r.width * 0.86}px`;
      box!.style.bottom = `${window.innerHeight - r.bottom + r.height * (settings.bottomOffset / 100)}px`;
      const stack = FONTS[settings.fontFamily] ?? FONTS.hei;
      // The original line keeps the player's own typeface and weight. With the
      // sans stack the translation shares that Latin face (digits, names) and
      // goes semibold, so both lines carry the same visual weight.
      const latin = isCjk(settings.sourceLang) ? '' : `"${playerFont.font}", "Trebuchet MS", `;
      const sans = settings.fontFamily === 'hei';
      box!.style.fontFamily = stack;
      origEl!.style.fontFamily = latin + stack;
      origEl!.style.fontWeight = latin && playerFont.bold ? '700' : '500';
      trEl!.style.fontFamily = sans ? latin + stack : stack;
      trEl!.style.fontWeight = sans && latin && playerFont.bold ? '600' : '500';
      styleLine(origEl!, settings.sourceLang);
      styleLine(trEl!, settings.targetLang);
      // An empty line must not leave its margin behind.
      origEl!.style.display = orig ? 'block' : 'none';
      trEl!.style.display = tr ? 'block' : 'none';
      const theme = THEMES[settings.trColor] ?? THEMES.mint;
      // A crisp outline plus a tight halo and a soft drop shadow, so the text
      // holds up on bright scenes too.
      box!.style.webkitTextStroke = `.16em rgba(${theme.edge},.9)`;
      box!.style.textShadow = `0 0 .12em rgba(${theme.edge},.85),0 .07em .22em rgba(${theme.edge},.6)`;
      origEl!.style.color = theme.orig;
      trEl!.style.color = theme.tr;
      origEl!.style.fontSize = `${size * 0.8}px`;
      trEl!.style.fontSize = `${size}px`;
    }

    // ---- boot ------------------------------------------------------------
    void loadSettings().then((s) => {
      settings = s;
      void startEpisode();
    });
    const restart = () => {
      currentKey = '';
      void startEpisode();
    };
    onSettingsChanged((s) => {
      const retranslate =
        s.targetLang !== settings.targetLang ||
        s.sourceLang !== settings.sourceLang ||
        s.engine !== settings.engine ||
        s.model !== settings.model ||
        s.nameStyle !== settings.nameStyle;
      const reenabled = s.enabled && !settings.enabled;
      settings = s;
      if (retranslate || reenabled) restart();
    });
    // A newly entered API key upgrades the current episode right away.
    browser.storage.onChanged.addListener((changes, area) => {
      if (area === 'local' && 'anthropicApiKey' in changes) restart();
    });
    setInterval(tick, 100);
  },
});
