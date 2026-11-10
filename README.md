# cr-dual-subs

Crunchyroll 双语字幕扩展：在原字幕下面加一行机器翻译（默认英文 → 简体中文）。英配的 CC 字幕和日配的英文字幕都支持。

## 安装（开发版）

```bash
npm install
npm run build
```

然后在 Chrome 打开 `chrome://extensions`，开启右上角“开发者模式”，点“加载已解压的扩展程序”，选择 `.output/chrome-mv3` 目录。

开发时用 `npm run dev`，会自动打开一个带扩展的 Chrome 并热重载。

## 使用

1. 打开 Crunchyroll 任意一集并开始播放（装好扩展后要刷新页面）。
2. 视频左上角会提示“翻译中… / 翻译完成”，之后底部显示白色原文 + 黄色译文。
3. 在播放器设置里把 Crunchyroll 自带字幕关掉，避免重叠；或者在扩展弹窗里关掉“显示原文”，只叠加译文并调整“离底部距离”。

## 原理

| 文件 | 作用 |
| --- | --- |
| `entrypoints/injected.content.ts` | 运行在页面自己的 JS 环境里，拦截播放器的 `fetch`/XHR，从播放接口的返回里拿到字幕轨列表（`subtitles` / `captions`），并代为下载字幕文件 |
| `entrypoints/overlay.content.ts` | 选字幕轨（优先 CC）、解析、把双语字幕画在 `<video>` 上方 |
| `entrypoints/background.ts` | 整集翻译、按集缓存（`chrome.storage.local`） |
| `lib/parse.ts` | ASS / WebVTT 解析，过滤掉定位的招牌字和矢量图 |
| `lib/translate.ts` | 翻译实现，目前用 Google 翻译的免 key 网页接口 |

不依赖页面的 class 名，播放器在 iframe 里也能工作（每个 frame 都注入，通过 background 广播）。

## 排查

- 没有任何提示：在视频页打开 DevTools → Network，搜 `play`，看返回的 JSON 里有没有 `subtitles` / `captions` 字段。字段名变了就改 `injected.content.ts` 里的 `inspect`。
- 提示“没有 en-US 字幕轨”：这一集的英配没有 CC 字幕。
- 提示“翻译失败”：免 key 接口被限流，稍等再试。

## 后续想法

- 换成 DeepL / LLM 翻译（带上下文，人名和招式名更准）
- 鼠标悬停英文单词查词
- 快捷键开关、重复上一句
- 人名术语表（Kakarot → 卡卡罗特）
- Firefox 版（`wxt build -b firefox`）
