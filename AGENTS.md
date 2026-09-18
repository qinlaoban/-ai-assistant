# Expo HAS CHANGED

Read the exact versioned docs at https://docs.expo.dev/versions/v57.0.0/ before writing any code.

## 架构约定（改动前先读）

### 分层与依赖方向

| 目录 | 职责 | 允许依赖 |
| --- | --- | --- |
| `src/constants/` | 常量与纯函数契约（生成参数、主题 token、字体） | 无 |
| `src/services/` | 纯逻辑与契约（请求、存储、消息变换、附件、导出、`key-value-store.ts`） | `src/constants/` 与其它 services |
| `src/platform/` | 平台实现：存储后端（**唯一 import `react-native` / `expo-*` 的地方**） | `src/services/` 里的契约类型 |
| `src/store/` | React 状态编排：把 services 的结果写进 Context | 上面几层 |
| `src/hooks/` | 可复用的状态逻辑 | 上面几层 |
| `src/components/`、`src/app/` | 渲染与交互 | 任意一层 |

**`src/services/` 与 `src/constants/` 禁止 import React 或 react-native**，否则会立刻失去可测试性。平台差异一律下沉到 `src/platform/`：services 只依赖契约（如 `TextFileStore` / `SecretStore`），平台实现由 services 在真正读写时**动态 import**，测试则通过注入替换。

### 可测试层的写法（改坏会静默弄挂测试）

`src/services/` 与 `src/constants/` 里的模块要能被 Node 直接加载，`tests/` 才能复用**真实实现**而不是另写一份模仿代码。因此：

- 用**相对路径 + 显式 `.ts` 扩展名**导入，例如 `import { X } from '../constants/chat-params.ts'`。**不要**用 `@/` 别名 —— 别名只在 Metro/webpack 里生效，Node 解析不到，测试会在 import 阶段直接崩。
- 不要引入 `react-native` / `expo-*` 原生模块。平台差异下沉到 `src/platform/`，services 只依赖 `src/services/key-value-store.ts` 里的契约；测试用 `setStorageBackend()` 注入 `tests/_memory-stores.ts` 的内存实现，完全不碰原生模块。
- 新增纯函数优先放进 services，让 store 只剩「事件 → setState」。

⚠️ `tests/_stub-loader.mjs` 把 `Platform.OS` 固定为 `'web'`，所以**附件 / 导出 / 转写 / 朗读这几个模块的原生分支不会被任何测试覆盖**（存储层已改为注入式，不受此限制）。改动这几处时，测试全绿不等于原生端没问题。

### 改动后如何验证

```bash
npm test                    # node:test，覆盖 services 与 constants
npx tsc --noEmit            # 全量类型检查
npx eslint <改动过的文件>    # 按文件跑，避免被历史告警淹没
```

## 状态该放哪

- 跨页面共享、或需要落盘 → `src/store/chat-store.tsx`；
- 只服务单个页面、且高频变化（如输入草稿）→ 页面内的 hook。**别塞进 Context**：Context 的 value 每次变化都会惊动全部消费方，流式刷新期间尤其明显。
