import { loadApiKey, loadSettings, saveApiKey, saveSettings, type Settings } from '@/lib/settings';

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

const checkboxes = ['enabled', 'showOriginal'] as const;
const selects = ['sourceLang', 'targetLang', 'engine', 'model', 'nameStyle', 'fontFamily', 'trColor'] as const;
const ranges = ['fontSize', 'bottomOffset'] as const;

void loadSettings().then((s: Settings) => {
  for (const k of checkboxes) {
    const el = $<HTMLInputElement>(k);
    el.checked = s[k];
    el.addEventListener('change', () => void saveSettings({ [k]: el.checked }));
  }
  for (const k of selects) {
    const el = $<HTMLSelectElement>(k);
    el.value = s[k];
    el.addEventListener('change', () => void saveSettings({ [k]: el.value }));
  }
  for (const k of ranges) {
    const el = $<HTMLInputElement>(k);
    el.value = String(s[k]);
    el.addEventListener('input', () => void saveSettings({ [k]: Number(el.value) }));
  }
});

void loadApiKey().then((key) => {
  const el = $<HTMLInputElement>('apiKey');
  el.value = key;
  el.addEventListener('change', () => void saveApiKey(el.value));
});
