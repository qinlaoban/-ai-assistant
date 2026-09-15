# Design System Master File

> **LOGIC:** When building a specific page, first check `design-system/pages/[page-name].md`.
> If that file exists, its rules **override** this Master file.
> If not, strictly follow the rules below.

---

**Project:** AI Assistant
**Category:** AI/Chatbot Platform (native app: iOS / Android；Web 保底可用)
**Style:** AI-Native UI — 清透、克制、原生质感
**Updated:** 2026-09-15

---

## Global Rules

### Color Palette

单一色源：`src/constants/theme.ts`。禁止在组件里写死色值，所有颜色一律通过 `useTheme()` 的语义 token 取用。

主题色：**深青绿（关注/关键操作）+ 暖橙（点睛/CTA）**。

| Role | Light | Dark | 说明 |
|------|-------|------|------|
| primary | `#0F766E` | `#14B8A6` | 交互填充色；承载 `onPrimary` 文字，明暗均 ≥4.5:1 |
| secondary | `#0D9488` | `#2DD4BF` | 品牌亮色，仅用于装饰（不分承载文字） |
| cta | `#F97316` | `#FB923C` | 关键动作强调（如发送），配 `onCta` 深色文字 |
| background | `#F0FDFA` | `#04211F` | 页面底色 |
| backgroundElement | `#E2F6F1` | `#0B2C2A` | 卡片 / 次级表面 |
| backgroundSelected | `#C6EDE6` | `#12403C` | 选中态表面 |
| backgroundInput | `#FFFFFF` | `#0B2C2A` | 输入框底色 |
| border | `#CDE8E3` | `#1D4642` | 常规描边 |
| borderStrong | `#A6D8D0` | `#2C5C57` | 强描边 / 抓手条 |
| text | `#0F172A` | `#F0FDFA` | 正文 |
| textSecondary | `#475569` | `#94A3B8` | 次级文字 |
| textTertiary | `#64748B` | `#7C8FA3` | 三级文字 / 占位符（浅色 ≈4.6:1） |
| onPrimary | `#FFFFFF` | `#04211F` | 压在 primary 上的文字 |
| onCta | `#3B1204` | `#04211F` | 压在 cta 上的文字 |
| link | `#0F766E` | `#5EEAD4` | 链接 / 可点文字 |
| danger | `#DC2626` | `#F87171` | 危险 / 不可逆操作 |

对话气泡 / 代码 / 引用 / 提示：

| Role | Light | Dark |
|------|-------|------|
| bubbleUser / bubbleUserText | `#0F766E` / `#FFFFFF` | `#0F766E` / `#F0FDFA` |
| bubbleAssistant / bubbleAssistantText | `#FFFFFF` / `#0F172A` | `#0B2C2A` / `#D6F5F1` |
| codeBackground / codeText | `#EAFBF4` / `#115E59` | `#06201F` / `#99F6E4` |
| quoteBorder / quoteBackground | `#14B8A6` / `#F0FDFA` | `#2DD4BF` / `#06201F` |
| noticeBackground / noticeText | `#FFEDD5` / `#9A3412` | `#3A2410` / `#FDBA74` |
| overlay | `rgba(15,23,42,0.32)` | `rgba(0,0,0,0.6)` |

**约束：**
- `Colors.light` 与 `Colors.dark` 的键必须**完全一致**（`ThemeColor` 类型取交集）。
- 承载文字的填充色必须实测对比度 ≥4.5:1；对比度不足的亮色只可用于装饰。
- 禁止新增硬编码色值（品牌 Logo / 启动图除外，见 `animated-icon` 与 `app.json`）。

### Typography

- **Font:** Plus Jakarta Sans（原生运行时加载，`src/constants/fonts.ts`；Web 由 `src/global.css` 引入）
- **Mood:** friendly, modern, clean, approachable, professional

| 层级 | 字号 / 行高 / 字重 |
|------|--------------------|
| title | 36 / 44 / 700 |
| subtitle | 26 / 34 / 700 |
| default (body) | 16 / 24 / 500 |
| small | 14 / 20 / 500 |
| smallBold | 14 / 20 / 700 |
| code | 12（等宽） |

### Spacing

沿用 `Spacing` token：`half 2 / one 4 / two 8 / three 16 / four 24 / five 32 / six 64`。

### Border Radius

沿用 `BorderRadius` token：`small 8 / medium 12 / large 16 / xl 24`。

---

## Component Specs

### Buttons（`Pressable`）

- 主操作：`backgroundColor: primary` + `onPrimary` 文字；`pressed` 用 `opacity: 0.7`。
- 关键动作（发送）：`backgroundColor: cta` + `onCta` 文字。
- 次操作 / 停止：`backgroundColor: backgroundSelected` + `text` 文字。
- 禁用：`opacity: 0.4`，不改变布局。

### Chips / Segmented / Stepper

- 未选中：`backgroundElement` 底 + `border` 描边 + `textSecondary` 文字。
- 选中：`primary` 底 + `onPrimary` 文字（不得只靠描边区分选中）。

### Cards / Settings

- `backgroundElement` 底 + `border` 细描边 + `BorderRadius.medium`。
- 分区标题：`textSecondary` + 700 字重 + 轻微字距。

### Bubbles

- 用户：`bubbleUser` 底、右下角小圆角收窄。
- 助手：`bubbleAssistant` 底 + `border` 描边，与页面底色拉开层次。

### Sheets / Toast

- 统一 `backgroundSheet` 底 + `border`，圆角 `xl`（面板）/`large`（Toast）。
- 遮罩用 `overlay`，抓手条用 `borderStrong`。

---

## Style Guidelines

**Style:** AI-Native UI

**Keywords:** chatbot, conversational, streaming text, ambient, minimal chrome, calm teal, warm accent

**Key Effects:** 三点脉冲（首个 token 前）、流式光标、底部操作表上滑、Toast 淡入淡出、抽屉横滑。
所有动效必须尊重 `prefers-reduced-motion`（`useReducedMotion`）。

---

## Anti-Patterns (Do NOT Use)

- ❌ 空白加载态（冷启动不得出现纯色白屏，须给加载反馈）
- ❌ 空态只有文字、没有可执行动作
- ❌ 用 emoji 当图标（用 `react-native-svg` 图标）
- ❌ 硬编码色值 / 绕过语义 token
- ❌ 承载文字的颜色对比度低于 4.5:1
- ❌ 悬停/按压引发位移（用颜色/透明度过渡）
- ❌ 无反馈的瞬时状态切换（过渡 150–300ms）

---

## Pre-Delivery Checklist

- [ ] 明暗两套 token 键一致，各自对比度达标（≥4.5:1）
- [ ] 无新增硬编码色值
- [ ] 图标来自统一图标集（本项目用 `react-native-svg`），无 emoji
- [ ] 所有可点元素有按压/选中反馈与无障碍标签
- [ ] 加载态、空态、错误态均有明确反馈
- [ ] 动效尊重 `prefers-reduced-motion`
- [ ] 通过 `npx tsc --noEmit`、`npx eslint .`、`npm test`
