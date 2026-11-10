# cr-dual-subs

Chrome extension (Manifest V3, WXT + TypeScript) that draws bilingual subtitles on Crunchyroll: the original subtitle line plus a translation (default English -> Simplified Chinese). Personal side project.

## Commands

- `npm run dev` — launch Chrome with the extension and hot reload
- `npm run build` — production build into `.output/chrome-mv3` (load this folder unpacked)
- `npm run typecheck` — `wxt prepare && tsc --noEmit`
- `npm test` — vitest (parsers, batching)

Run typecheck, test and build before calling a change done.

## Architecture

- `entrypoints/injected.content.ts` — MAIN world, all frames. Hooks `fetch`/XHR, finds the playback JSON that lists `subtitles` / `captions` tracks, and fetches subtitle files for the content script. No extension APIs here; talks via `window.postMessage`.
- `entrypoints/overlay.content.ts` — isolated world, all frames. Chooses the track (captions first, then subtitles), parses it, asks the background to translate, renders the overlay over the largest `<video>`.
- `entrypoints/background.ts` — translation, per-episode cache in `chrome.storage.local`, relays messages to every frame of a tab.
- `lib/parse.ts` — ASS / WebVTT parsing; drops positioned signs and vector drawings.
- `lib/translate.ts` — translation provider (currently Google's keyless web endpoint).
- `lib/settings.ts` — settings in `chrome.storage.sync`; `entrypoints/popup/` is the settings UI.

## Constraints

- Never depend on Crunchyroll CSS class names or DOM structure; they change often. Detect by network response shape and by the `<video>` element.
- The player may be in a cross-origin iframe: anything a frame learns must go through the background `relay` to reach the frame that holds the video.
- Hooks in the MAIN world must never break the page's own requests: wrap in try/catch and always return the original response.
- Cues must stay index-aligned with their translations; any translator has to return exactly one result per input line.
- User-facing strings (popup, on-video status) are in Simplified Chinese; code and comments in English.
- No video downloading or DRM circumvention; subtitles only.

## Status

- Not yet verified on a real Crunchyroll playback page: the playback JSON shape (`subtitles`, `captions`, `audioLocale`) is assumed.
- Planned: replace machine translation with whole-episode, context-aware LLM translation (series metadata, per-series glossary, line-id aligned output, machine translation as the instant fallback, official Chinese track used directly when present).
