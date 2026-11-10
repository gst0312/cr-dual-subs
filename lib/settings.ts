import { browser } from 'wxt/browser';

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
}

export const DEFAULTS: Settings = {
  enabled: true,
  sourceLang: 'en-US',
  targetLang: 'zh-CN',
  showOriginal: true,
  fontSize: 100,
  bottomOffset: 8,
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
