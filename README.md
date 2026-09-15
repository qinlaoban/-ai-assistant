# AI Assistant

一个用 [Expo](https://docs.expo.dev/versions/v57.0.0/) 构建的跨平台 AI 对话应用，同时支持 iOS、Android 与 Web。

直连 OpenAI Chat Completions 接口，流式输出；会话、密钥与生成参数全部留在本机，不经过任何中间服务。

## 功能

**对话**
- SSE 流式输出，带打字光标与「等待首个 token」的三点脉冲动画
- 自动滚动跟随（手动上滑查看历史时不会被强行拽回底部）
- 生成中可随时「停止」；失败时给出错误条与「重试」

**消息级操作**（长按任意气泡）
- 复制：把整条消息写入剪贴板
- 重新生成：从该条 AI 回复处截断，重新向模型请求
- 编辑并重发：改写你的提问后从该处重新请求
- 删除这条消息

**会话管理**
- 多会话本地持久化，标题由首条提问自动生成
- 按标题实时搜索
- 重命名、删除（删除有二次确认）

**设置中心**
- 接口地址：任何 OpenAI 兼容端点，内置常用服务商一键填写，并回显最终会请求的完整地址
- 模型 ID：可自由填写，按当前服务商给出常见模型快捷选项
- 系统提示词：只在请求时注入，不落盘进会话记录
- 随机性：精确 / 平衡 / 创意三档，可再按 0.1 步长微调
- 最大生成长度：档位选择，含「不限制」
- 用量统计：最近一次的输入 / 输出 token，以及本会话累计

**呈现**
- 自研 Markdown 渲染器（不用 WebView）：标题、代码块、引用、有序 / 无序 / 任务列表、表格、行内样式
- 自动跟随系统深浅色
- 会话列表与对话页在 iOS 26+ 呈现 Liquid Glass 毛玻璃质感，其他平台回退为纯色表面

## 环境要求

- Node.js 20 或更高版本
- 任意 OpenAI 兼容服务商的 API Key（OpenAI 官方、小米 MiMo 等，见下）
- 运行原生端需要 Xcode（iOS）或 Android Studio（Android），也可以用 Expo Go 快速体验

## 快速开始

```bash
npm install
npm start
```

启动后按提示选择目标平台，或直接：

```bash
npm run ios       # iOS 模拟器
npm run android   # Android 模拟器 / 设备
npm run web       # 浏览器
```

首次进入应用会要求填入 API Key，保存后即可开始对话。

## 可用脚本

| 脚本 | 说明 |
| --- | --- |
| `npm start` | 启动开发服务器 |
| `npm run ios` / `npm run android` / `npm run web` | 直接启动对应平台 |
| `npm run lint` | ESLint 检查（flat config，见 `eslint.config.js`） |
| `npm test` | 单元测试（Node 内置 test runner，无需额外依赖） |
| `npm run check:api` | 接口连通性自检，见下 |
| `npm run reset-project` | 模板自带的清空脚本，本项目已改造完，通常不需要 |

类型检查：`npx tsc --noEmit`

## 接口连通性自检

换服务商、或者怀疑网络 / Key 有问题时，先跑这个：

```bash
API_KEY=sk-xxx npm run check:api
API_KEY=sk-xxx npm run check:api -- --base-url https://api.xiaomimimo.com/v1 --model mimo-v2.5
```

它会用**应用真实的请求实现**（`sendMessageStream`，不是另写一份模仿代码）发一次真实请求，逐项报告：

- 地址可达性与鉴权（探一次 `/models`）
- 流式对话是否跑通、总耗时
- 首个内容 token 的延迟（思考型模型会体现为一段延迟）
- 回答内容与用量

退出码 0 表示全通过。Key 走环境变量，别写进命令行参数，避免落进 shell 历史。

## 接入其他服务商

应用请求的是标准的 OpenAI Chat Completions 接口，任何兼容实现都能直接用。在「设置 → 接口」里填两项即可：

| 服务商 | 接口地址 | 模型 ID |
| --- | --- | --- |
| OpenAI | `https://api.openai.com/v1` | `gpt-4o-mini`、`gpt-4o` 等 |
| 小米 MiMo | `https://api.xiaomimimo.com/v1` | `mimo-v2.5-pro`、`mimo-v2.5` |

点对应的服务商按钮会一次填好这两项；API Key 填在同一页，两家都走 `Authorization: Bearer`。页面底部会显示**最终请求的完整地址**，发消息前可以先核对。

两处兼容处理：

- 长度参数下发 `max_completion_tokens`（OpenAI 已用它替代 `max_tokens`，MiMo 等实现只认新名字），温度上限取 1.5（OpenAI 允许 2，MiMo 只到 1.5，取交集）
- `stream_options` 仅用于获取用量统计；若服务商不认这个参数（会返回 400），应用会自动摘掉它重发一次，代价是这一轮没有用量数据，不影响回答本身

> MiMo 的 `mimo-v2.5` / `mimo-v2.5-pro` 默认开启思考模式，回答前会有一段「没有可见输出」的推理时间，此时界面显示等待动画属正常现象。
>
> 另外实测 `mimo-v2.5-pro` 经常长时间只返回 SSE 保活注释（服务端排队），正文迟迟不出。因此设置页把 `mimo-v2.5` 排在前面作为默认；如果一直转圈，先换成 `mimo-v2.5` 试试。

## 隐私与数据

- **API Key**：原生端存 `expo-secure-store`（系统钥匙串 / Keystore），Web 端存 `localStorage`。仅在 `Authorization` 头里发往你在设置中填写的接口地址，不写入任何日志。
- **会话记录**：原生端写在应用文档目录的 `chats/<id>.json`，Web 端存 `localStorage`（键前缀 `ai_assistant:chat:`）。
- **生成参数**：原生端写 `settings.json`，Web 端存 `localStorage`。系统提示词可能较长，因此不走 SecureStore（其单值上限约 2 KB）。
- 除你配置的接口地址外，应用不向任何第三方发送数据。字体在原生端会向 jsDelivr（Google Fonts 镜像）请求一次，失败即回退系统字体。

## 目录结构

```
src/
├── app/                      # expo-router 文件路由
│   ├── _layout.tsx           # 根布局：主题、字体加载、启动屏、Tab
│   ├── index.tsx             # 对话页（含首次使用的 API Key 引导）
│   ├── chats.tsx             # 会话列表：搜索 / 重命名 / 删除
│   └── settings.tsx          # 设置：模型、生成参数、密钥、用量
├── components/
│   ├── action-sheet.tsx      # 通用底部操作表（消息与会话共用）
│   ├── session-actions.tsx   # 会话级操作浮层
│   ├── glass-surface.tsx     # 毛玻璃容器（不支持时回退纯色）
│   ├── toast.tsx             # 轻提示
│   ├── chat/                 # 气泡、Markdown 渲染器、消息操作、等待动画
│   └── settings/             # 设置页分区（接口 / 生成参数）、控件、用量卡片、草稿提交 hook
├── constants/
│   ├── theme.ts              # 设计 token（颜色 / 字体 / 间距 / 圆角）
│   ├── chat-params.ts        # 生成参数契约、服务商预设、接口地址归一化
│   └── fonts.ts              # 字体来源
├── services/
│   ├── ai-service.ts         # OpenAI 流式请求与 SSE 解析
│   └── chat-storage.ts       # 会话 / 密钥 / 生成参数持久化
└── store/chat-store.tsx      # 全局状态与全部动作
```

设计规范见 `design-system/ai-assistant/MASTER.md`，配色与字体 token 以 `src/constants/theme.ts` 为准。

## 已知限制

- 只实现了 Chat Completions 协议：换服务商需要它兼容此协议；Anthropic 原生协议尚未接入
- 模型的「思考过程」未单独展示（MiMo 等模型的 `reasoning_content` 会被忽略），思考期间只显示等待动画
- 流式过程中不落盘：回答生成到一半退出应用，本轮内容会丢失
- 暂不支持图片 / 文件 / 语音等多模态输入
- 会话存储为「一个会话一个文件」，列表每次全量读取；会话数量很大时会有性能压力

## 技术栈

Expo 57 / React 19 / React Native 0.86 / expo-router / TypeScript（strict）。
状态管理使用 React Context + `useState` + `useRef` 镜像，未引入 Redux 或 Zustand。
