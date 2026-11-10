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

## Claude 精翻

选 Claude 时，译文全部由 Claude 结合整集台词、作品名、是英配还是日配来翻译，从当前播放位置开始一段一段出现（还没译到的行只显示原文），不会用到机翻；译完按集缓存。在扩展弹窗的“翻译方式”里选：

- **本机 Claude Code（默认）**：用你已登录的 Claude Code 订阅，不需要 API 额度。看番前在项目目录运行桥接服务并保持开着：

  ```bash
  npm run bridge
  ```

  它监听 `http://127.0.0.1:47615`，只接受浏览器扩展发来的请求，调用 `claude -p`（禁用全部工具）完成翻译。会占用订阅的用量额度。
- **Claude API**：填入自己的 API key（console.anthropic.com），按量付费，不需要桥接服务。key 只存在本机。
- **只用机翻**。

模型可选 Opus 5.5（默认）或 Sonnet 5.5，译名习惯可选大陆 / 台湾 / 香港。

## 原理

| 文件 | 作用 |
| --- | --- |
| `entrypoints/injected.content.ts` | 运行在页面自己的 JS 环境里，拦截播放器的 `fetch`/XHR，从播放接口的返回里拿到字幕轨列表（`subtitles` / `captions`），并代为下载字幕文件 |
| `entrypoints/overlay.content.ts` | 选字幕轨（优先 CC）、解析、把双语字幕画在 `<video>` 上方 |
| `entrypoints/background.ts` | 整集翻译、按集缓存（`chrome.storage.local`） |
| `lib/parse.ts` | ASS / WebVTT 解析，过滤掉定位的招牌字和矢量图 |
| `lib/translate.ts` | 机翻（Google 翻译的免 key 网页接口），只在“只用机翻”时使用 |
| `lib/claude.ts` | Claude 整集精翻：提示词、分块、按行号对齐；两种通道（本机桥接 / API） |
| `bridge/server.mjs` | 本机桥接服务，把翻译请求转给 Claude Code 命令行 |

不依赖页面的 class 名，播放器在 iframe 里也能工作（每个 frame 都注入，通过 background 广播）。

## 排查

- 没有任何提示：在视频页打开 DevTools → Network，搜 `play`，看返回的 JSON 里有没有 `subtitles` / `captions` 字段。字段名变了就改 `injected.content.ts` 里的 `inspect`。
- 提示“没有 en-US 字幕轨”：这一集的英配没有 CC 字幕。
- 提示“连不上本机桥接服务”：先运行 `npm run bridge`。
- 提示“机翻失败”：免 key 接口被限流，稍等再试。

## 后续想法

- 每部作品一份可编辑的术语表，跨集复用
- 有官方中文字幕轨时直接使用
- 鼠标悬停英文单词查词
- 快捷键开关、重复上一句
- 人名术语表（Kakarot → 卡卡罗特）
- Firefox 版（`wxt build -b firefox`）
