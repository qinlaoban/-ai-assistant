/**
 * 接口连通性自检 —— 换服务商、怀疑网络/Key 有问题时先跑这个。
 *
 * 关键点：它**直接复用应用真实的请求实现**（`sendMessageStream`），而不是另写一份模仿代码。
 * 因此它验证的是「应用真正会发出的那个请求」：地址归一化、鉴权头、字段名、
 * `stream_options` 兼容降级、SSE 解析全都在内。失败时的报错也已经过应用的文案层，
 * 拿到就是能直接照做的中文提示。
 *
 * 用法（Key 走环境变量，别写在命令行里，避免落进 shell 历史）：
 *
 *   API_KEY=sk-xxx node scripts/check-api.ts
 *   API_KEY=sk-xxx node scripts/check-api.ts --base-url https://api.xiaomimimo.com/v1 --model mimo-v2.5
 *
 * 不带参数时使用默认服务商配置。退出码 0 表示全通过，1 表示有失败项。
 */

import {
  DEFAULT_API_BASE_URL,
  normalizeBaseUrl,
  PROVIDER_PRESETS,
} from '../src/constants/chat-params.ts';
import { isAbortError, sendMessageStream, type Usage } from '../src/services/ai-service.ts';

/** 单次请求的硬超时：自检绝不能无限挂住 */
const REQUEST_TIMEOUT_MS = 90_000;
/** 探测地址是否可达用的短超时 */
const PROBE_TIMEOUT_MS = 20_000;

function readArg(name: string): string | undefined {
  const index = process.argv.indexOf(`--${name}`);
  if (index < 0) return undefined;
  const value = process.argv[index + 1];
  return value && !value.startsWith('--') ? value : undefined;
}

function maskKey(key: string): string {
  if (key.length <= 12) return '••••••';
  return `${key.slice(0, 6)}••••${key.slice(-4)}`;
}

function pass(label: string, detail = ''): void {
  console.log(`  ✓ ${label}${detail ? `   ${detail}` : ''}`);
}

function fail(label: string, detail = ''): void {
  console.log(`  ✗ ${label}${detail ? `   ${detail}` : ''}`);
}

function seconds(ms: number): string {
  return `${(ms / 1000).toFixed(2)}s`;
}

/** 探一次 /models：只要拿到 HTTP 响应就说明地址可达，404 只代表该服务商没实现这个接口 */
async function probeReachability(baseUrl: string, apiKey: string): Promise<boolean> {
  try {
    const response = await fetch(`${baseUrl}/models`, {
      headers: { Authorization: `Bearer ${apiKey}` },
      signal: AbortSignal.timeout(PROBE_TIMEOUT_MS),
    });

    if (response.status === 401 || response.status === 403) {
      fail('鉴权失败', `GET /models 返回 HTTP ${response.status}，请检查 API Key`);
      return false;
    }

    pass(
      '地址可达',
      response.ok
        ? `GET /models 返回 HTTP ${response.status}`
        : `GET /models 返回 HTTP ${response.status}（该服务商可能未实现此接口，不影响对话）`
    );
    return true;
  } catch (error) {
    fail('地址不可达', error instanceof Error ? error.message : String(error));
    return false;
  }
}

/** 真发一次流式对话，并沿途统计首个 token 延迟、回答长度与用量 */
async function probeCompletion(baseUrl: string, apiKey: string, model: string): Promise<boolean> {
  const stats = {
    firstDeltaMs: null as number | null,
    chars: 0,
    preview: '',
    usage: null as Usage | null,
  };
  const startedAt = Date.now();

  const controller = new AbortController();
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, REQUEST_TIMEOUT_MS);

  try {
    await sendMessageStream(
      [{ role: 'user', content: '用一句话介绍你自己' }],
      { model, apiKey, baseUrl },
      {
        onDelta: (delta) => {
          if (stats.firstDeltaMs === null) stats.firstDeltaMs = Date.now() - startedAt;
          stats.chars += delta.length;
          if (stats.preview.length < 80) {
            stats.preview = (stats.preview + delta).slice(0, 80);
          }
        },
        onUsage: (usage) => {
          stats.usage = usage;
        },
      },
      controller.signal
    );
  } catch (error) {
    // 超时是我们自己掐的，此时异常会被归一成 AbortError，要跟「真的连不上」区分开
    if (timedOut && isAbortError(error, controller.signal)) {
      fail('请求超时', `${seconds(REQUEST_TIMEOUT_MS)} 内没有等到完整响应`);
      return false;
    }
    fail('请求失败', error instanceof Error ? error.message : String(error));
    return false;
  } finally {
    clearTimeout(timer);
  }

  const totalMs = Date.now() - startedAt;
  pass('流式对话成功', `${seconds(totalMs)}`);
  pass('首个内容 token', stats.firstDeltaMs === null ? '没有内容' : seconds(stats.firstDeltaMs));

  if (stats.firstDeltaMs !== null && stats.firstDeltaMs > 1500) {
    console.log(
      '    ↑ 延迟偏高：开启思考模式的模型（如 MiMo）会先把思考过程推完才开始输出正文，' +
        '这段等待在界面上表现为「只有等待动画」'
    );
  }

  pass('回答长度', `${stats.chars} 字符`);
  if (stats.preview) {
    const ellipsis = stats.chars > stats.preview.length ? '…' : '';
    pass('回答内容', `「${stats.preview.replace(/\s+/g, ' ')}${ellipsis}」`);
  }

  if (stats.usage) {
    const { promptTokens, completionTokens, totalTokens } = stats.usage;
    pass('用量统计', `输入 ${promptTokens} / 输出 ${completionTokens} / 总计 ${totalTokens}`);
    if (completionTokens > 0 && stats.chars < completionTokens / 3) {
      console.log('    ↑ 输出 token 远多于可见字符数，其中大部分应是思考（reasoning）token');
    }
  } else {
    console.log('  · 用量统计   服务端未返回（不影响对话）');
  }

  return true;
}

async function main(): Promise<void> {
  const baseUrl = normalizeBaseUrl(
    readArg('base-url') ?? process.env.API_BASE_URL ?? DEFAULT_API_BASE_URL
  );
  const apiKey = readArg('api-key') ?? process.env.API_KEY ?? '';
  const model =
    readArg('model') ??
    process.env.MODEL ??
    PROVIDER_PRESETS.find((preset) => preset.baseUrl === baseUrl)?.models[0] ??
    'gpt-4o-mini';

  console.log('\n接口自检');
  console.log(`  接口地址   ${baseUrl}`);
  console.log(`  模型       ${model}`);
  console.log(`  密钥       ${apiKey ? maskKey(apiKey) : '（未提供）'}`);
  console.log('');

  if (!apiKey) {
    console.log('缺少 API Key。这样传：');
    console.log('  API_KEY=sk-xxx node scripts/check-api.ts\n');
    process.exitCode = 1;
    return;
  }

  const reachable = await probeReachability(baseUrl, apiKey);
  if (!reachable) {
    console.log('\n地址或鉴权没过，后面的对话探测就不做了。');
    process.exitCode = 1;
    return;
  }

  const completed = await probeCompletion(baseUrl, apiKey, model);

  console.log('');
  console.log(completed ? '结论：这个接口可以正常使用。' : '结论：接口没通，按上面的失败项排查。');
  process.exitCode = completed ? 0 : 1;
}

void main();
