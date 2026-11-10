import { browser } from 'wxt/browser';
import type { ClaudeModel, Engine, NameStyle } from './claude';

export interface Settings {
  enabled: boolean;
  /** Locale of the subtitle track to translate from, e.g. en-US */
  sourceLang: string;
  /** Translation target, e.g. zh-CN */
  targetLang: string;
  /** Draw the original line above the translation */
  showOriginal: boolean;
  /** Percent, 100 = default size */
  fontSize: number;
  /** Distance from the bottom of the video, in percent of its height */
  bottomOffset: number;
  /** Subtitle typeface: sans (hei), rounded (yuan), serif (song), brush (kai), handwritten (hand) */
  fontFamily: 'hei' | 'yuan' | 'song' | 'kai' | 'hand';
  /** Colour theme, named after the colour of the translated line */
  trColor: 'white' | 'cream' | 'yellow' | 'sky' | 'mint' | 'sakura';
  /** How the context-aware translation is produced */
  engine: Engine;
  /** Claude model used for the context-aware translation */
  model: ClaudeModel;
  /** Which Chinese-speaking region's established names to use */
  nameStyle: NameStyle;
}

export const DEFAULTS: Settings = {
  enabled: true,
  sourceLang: 'en-US',
  targetLang: 'zh-CN',
  showOriginal: true,
  fontSize: 100,
  bottomOffset: 8,
  fontFamily: 'hand',
  trColor: 'mint',
  engine: 'claude-code',
  model: 'claude-opus-5-5',
  nameStyle: 'mainland',
};

export async function loadSettings(): Promise<Settings> {
  const stored = await browser.storage.sync.get(DEFAULTS as unknown as Record<string, unknown>);
  return { ...DEFAULTS, ...(stored as Partial<Settings>) };
}

export async function saveSettings(patch: Partial<Settings>): Promise<void> {
  await browser.storage.sync.set(patch);
}

export function onSettingsChanged(cb: (s: Settings) => void): void {
  browser.storage.onChanged.addListener((_changes, area) => {
    if (area === 'sync') void loadSettings().then(cb);
  });
}

// The API key stays in local storage: it must not be synced across devices.
const API_KEY = 'anthropicApiKey';

export async function loadApiKey(): Promise<string> {
  const stored = await browser.storage.local.get(API_KEY);
  return (stored[API_KEY] as string | undefined) ?? '';
}

export async function saveApiKey(key: string): Promise<void> {
  await browser.storage.local.set({ [API_KEY]: key.trim() });
}
