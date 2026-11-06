# 🎓 ClassSync AI · 留学课堂实时同传助手 (Cloudflare Pages Ready)

专为**海外留学课堂实时听课与记笔记**设计的同声传译网页端。当前主推 **方案一：【极简白嫖流】Chrome 内置语音识别 (`Web Speech API`) + `Google Gemini 2.5 Flash`**，并采用插件化多 API 架构，内置完整的 **API 健康监控仪表盘**，支持一键部署到 **Cloudflare Pages**。

---

## ✨ 针对留学课堂的专项优化

1. **实时 API 健康监控仪表盘 (`APIHealthMonitor`)**：
   - 顶部实时展示 **语音识别 (ASR) 状态**、**大模型连接健康度与延迟 (ms)**、**Cloudflare 边缘节点状态**。
   - 内置 **免费额度 RPM 滑动窗口仪表 (`0 / 15 RPM`)**，直观监控 Gemini 免费层每分钟调用频次。
   - 支持一键发送诊断探测包（`🩺 诊断连通性`）验证 API Key 有效性与网络往返延迟。
2. **教室远场拾音增强 (`ClassroomAudioGuardian`)**：
   - 自动关闭浏览器针对近场会议设计的默认回声消除（`echoCancellation: false`）与激进降噪（`noiseSuppression: false`），开启自动增益（`autoGainControl: true`），避免坐在大教室中后排时远处教授的声音被浏览器当成噪音滤除。
   - 提供实时麦克风电平条与 `Screen Wake Lock API` 防息屏常亮锁。
3. **快慢双轨显示 + 超长从句抢先切分**：
   - **第一轨（0.1秒级）**：实时显示老师正在说的原文字幕；若教授长篇大论超过 28 个词未停顿，自动在从句引导词（`which`, `because`, `therefore` 等）处智能切分并提前送去翻译。
   - **第二轨（学术精翻）**：结合你选定的**课程学科背景**与**本节课 PPT 专有名词**，由 `Gemini 2.5 Flash` 自动修正语音识别的同音错词、附上中英术语对照，并自动在右侧汇总生成**本节课核心词汇表**。
4. **置顶画中画悬浮字幕窗 (`Document Picture-in-Picture`)**：
   - 一键弹出始终置顶在 PDF 课件或 Notion 笔记上方的迷你双语字幕窗。
5. **防丢本地缓存与一键导出 Markdown 复习笔记**：
   - 每句话实时存入浏览器 `LocalStorage`（校园网断网或误刷新不丢记录），支持一键标记 `⭐ 课堂重点/考点` 并导出结构化 Markdown 笔记。

---

## 🚀 部署到 Cloudflare Pages 指南

本项目完全遵循 **Cloudflare Pages + Pages Functions** 目录规范：
- `public/`：静态前端资源目录（`pages_build_output_dir = "public"`）
- `functions/api/health.js`：Cloudflare 边缘健康检查接口 (`/api/health`)
- `functions/api/translate.js`：Cloudflare 边缘同传代理接口 (`/api/translate`)

### 方式 A：通过命令行一键部署（最快捷）
在项目根目录下执行：
```bash
npx wrangler pages deploy public --project-name lecture-live-translator
```
*(在项目根目录执行时，Wrangler 会自动将 `public/` 与根目录下的 `functions/` 一起打包部署到 Cloudflare Pages)*

### 方式 B：通过 GitHub / GitLab 自动部署
1. 将本目录推送到你的 GitHub 仓库。
2. 登录 [Cloudflare Dashboard](https://dash.cloudflare.com/) -> **Workers & Pages** -> **Create application** -> **Pages** -> **Connect to Git**。
3. 构建设置（Build settings）：
   - **Framework preset**: `None`
   - **Build command**: *(留空)*
   - **Build output directory**: `public`
4. *(可选)* 在 **Settings -> Environment variables** 中添加：
   - `GEMINI_API_KEY`：填入你的 Google AI Studio 免费密钥（配置后你在手机/iPad 打开网页无需再手动输入 Key）。
   - `ACCESS_PASSCODE`：设置一个自定义访问密码，防止他人知道你的网址后消耗你的额度。

---

## 💻 本地运行与调试

```bash
# 方式 1：使用纯静态 HTTP 服务启动（纯前端直连模式）
npm run serve
# 浏览器打开 http://localhost:8080

# 方式 2：使用 Cloudflare Wrangler 本地模拟边缘函数
npm run dev
# 浏览器打开 http://localhost:8788
```

