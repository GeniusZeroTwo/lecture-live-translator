# 🎓 ClassSync AI · 留学课堂实时双语同传助手 (支持俄语 / 英语实时对照)

专为**海外留学课堂（俄罗斯 / 欧美 / 日韩等高校）实时听课与记笔记**设计的同声传译网页端。

---

## ✨ 核心特性

1. **🇷🇺 全面支持俄语 (`ru-RU`)、🇺🇸 英语 (`en-US`) 等多语种课堂同传**：
   - 支持一键切换 **🇷🇺 俄语课堂 (`Русский · ru-RU`)** 与 **🇺🇸 英语课堂 (`English · en-US`)**，以及日语、德语、法语、韩语、西班牙语。
   - 针对俄语/英语教授长难句内置从句连词智能切分（如俄语 `потому что`, `который`, `однако`, `поэтому` 等），不等教授整段讲完即可提前切分翻译。
2. **⚡ 翻译实时显示「原始语言 ⇄ 中文翻译」同步对照**：
   - **第一轨（顶部边说边译流）**：教授说话过程中，左侧 `0.1秒级` 实时跳出正在识别的**原始语言（俄语/英语等）**，右侧同步实时刷新**中文翻译对照**。
   - **第二轨（双语对照笔记卡片）**：每讲完一句自动生成**「原始语言原文 ⇄ 中文翻译对照」**双栏并排卡片（支持一键切换「左右双栏对照」或「上下双行对照」），并自动提取本节课**俄汉 / 英汉专业学术术语**。
3. **🔐 前台隐藏 API 添加入口 · 后台环境变量支持丰富 API 选项**：
   - **前台网页不显示任何 API 添加接口或密钥弹窗**，保证界面纯净与密钥安全。
   - 后端 [`functions/api/translate.js`](./functions/api/translate.js) 支持在 Cloudflare 后台 **「设置 -> 变量和密钥 (Variables and Secrets)」** 中通过环境变量灵活配置多种大模型 API 选项，且内置免密翻译自动兜底。

---

## ⚙️ 环境变量 API 选项配置指南（Cloudflare「变量和密钥」）

在 Cloudflare 后台进入你的项目 -> **设置 (Settings)** -> **变量和密钥 (Variables and Secrets)**，点击 **添加**，支持以下任意一种配置方式：

### 方式 A：通用环境变量（推荐，自动识别服务商）
| 变量名称 | 说明与可选值 |
| :--- | :--- |
| **`API_KEY`** | **必填（若使用自定义大模型）**：直接填入你的 API 密钥。系统会自动根据密钥格式识别：<br>• `AIza...` 自动识别为 **Google Gemini**<br>• `xxx.xxx` 自动识别为 **智谱 GLM-4-Flash**<br>• `sk-...` 自动识别为 **硅基流动 / DeepSeek / OpenAI** |
| **`API_PROVIDER`** | *(可选)* 显式指定 API 服务商选项：<br>`gemini` \| `glm` \| `siliconflow` \| `deepseek` \| `openai` \| `custom` \| `free` |
| **`API_MODEL`** | *(可选)* 指定具体模型名称，例如：<br>• Gemini: `gemini-2.5-flash` 或 `gemini-2.5-flash-lite`<br>• 智谱: `glm-4-flash`<br>• 硅基流动: `Qwen/Qwen2.5-7B-Instruct`<br>• DeepSeek: `deepseek-chat` |
| **`API_BASE_URL`** | *(可选)* 自定义 API 代理或第三方 OpenAI 兼容接口地址（如填入域名将自动补全 `/v1/chat/completions`） |
| **`ACCESS_PASSWORD`** | *(可选)* **访问密码保护变量**（也兼容填写变量名 **`ACCESS_PASSCODE`** 或 **`PASSWORD`**）。配置后，打开网页需输入正确访问密码才能调用云端同传接口，防止他人盗刷你的 API 额度 |

### 方式 B：直接按服务商专属变量名添加
你也可以直接在「变量和密钥」中添加以下任意一个变量名：
- **`GEMINI_API_KEY`**（或 `GOOGLE_API_KEY`）：Google Gemini 密钥
- **`GLM_API_KEY`**（或 `ZHIPU_API_KEY`）：智谱清言 GLM 密钥
- **`SILICONFLOW_API_KEY`**：硅基流动 SiliconFlow 密钥
- **`DEEPSEEK_API_KEY`**：DeepSeek 密钥
- **`OPENAI_API_KEY`**：OpenAI 密钥

> 💡 **智能容错与自动兜底**：
> - 即使你在「变量和密钥」的值里不小心多粘贴了 `GEMINI_API_KEY=`、`Bearer ` 或引号，系统也会自动清洗识别。
> - 若未配置任何环境变量，或所配置的 API 触发限流，系统会自动无缝降级至内置免密实时神经翻译引擎，确保课堂同传 100% 正常工作。
