import { defineConfig } from 'wxt';

export default defineConfig({
  manifest: {
    name: 'Dual Subs for Crunchyroll',
    description: 'Shows a translated line under the original subtitle on Crunchyroll.',
    permissions: ['storage'],
    host_permissions: ['*://*.crunchyroll.com/*', 'https://translate.googleapis.com/*', 'https://api.anthropic.com/*',
      'http://127.0.0.1:47615/*',
    ],
  },
});
