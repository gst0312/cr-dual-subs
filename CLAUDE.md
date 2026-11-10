# cr-dual-subs

Chrome extension (Manifest V3, WXT + TypeScript) that draws bilingual subtitles on Crunchyroll: the original subtitle line plus a translation (default English -> Simplified Chinese). Personal side project.

## Commands

- `npm run dev` — launch Chrome with the extension and hot reload
- `npm run build` — production build into `.output/chrome-mv3` (load this folder unpacked)
- `npm run typecheck` — `wxt prepare && tsc --noEmit`
- `npm test` — vitest (parsers, batching)
- `npm run bridge` — local bridge on `127.0.0.1:47615` that translates through the Claude Code CLI

Run typecheck, test and build before calling a change done.

## Architecture

- `entrypoints/injected.content.ts` — MAIN world, all frames. Hooks `fetch`/XHR, finds the playback JSON that lists `subtitles` / `captions` tracks, and fetches subtitle files for the content script. No extension APIs here; talks via `window.postMessage`.
- `entrypoints/overlay.content.ts` — isolated world, all frames. Chooses the track (captions first, then subtitles), parses it, asks the background to translate, renders the overlay over the largest `<video>`.
- `entrypoints/background.ts` — translation, per-episode cache in `chrome.storage.local`, relays messages to every frame of a tab.
- `lib/parse.ts` — ASS / WebVTT parsing; drops positioned signs and vector drawings.
- `lib/translate.ts` — machine translation (Google's keyless web endpoint): used only when the engine is set to `machine`. With a Claude engine nothing is sent to Google and untranslated lines show the original alone.
- `lib/claude.ts` — context-aware translation: prompt, 80-line chunks starting at the playback position, line-id aligned output. Two transports: the local bridge (default engine `claude-code`) and the Anthropic SDK (`client.beta.messages.parse`, zod structured output, cached script context, server-side refusal fallback).
- `bridge/server.mjs` — dependency-free Node server that runs `claude -p` with all tools disabled in an empty temp directory. It only accepts requests with an extension origin and a localhost Host header; keep those checks, since any web page can reach localhost.
- `lib/settings.ts` — settings in `chrome.storage.sync`, the Claude API key in `chrome.storage.local`; `entrypoints/popup/` is the settings UI.

## Constraints

- Never depend on Crunchyroll CSS class names or DOM structure; they change often. Detect by network response shape and by the `<video>` element.
- The player may be in a cross-origin iframe: anything a frame learns must go through the background `relay` to reach the frame that holds the video.
- Hooks in the MAIN world must never break the page's own requests: wrap in try/catch and always return the original response.
- Cues must stay index-aligned with their translations; any translator has to return exactly one result per input line.
- User-facing strings (popup, on-video status) are in Simplified Chinese; code and comments in English.
- No video downloading or DRM circumvention; subtitles only.

## Status

- Not yet verified on a real Crunchyroll playback page: the playback JSON shape (`subtitles`, `captions`, `audioLocale`) is assumed.
- The bridge path has been run end to end from Node with the real prompt; the API path compiles but has not been run (no key on the dev machine). Neither has been exercised from inside the loaded extension yet.
- Planned: per-series editable glossary reused across episodes; use the official Chinese track directly when present.

## Claude API notes

- Use the official `@anthropic-ai/sdk`; models are `claude-opus-5-5` (default) and `claude-sonnet-5-5`. Do not add date suffixes to model ids.
- Never bundle an API key; the user supplies their own in the popup.
