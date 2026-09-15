/**
 * 生成参数契约 —— 设置页、store 与请求层共用，避免接口地址、温度、长度这类取值散落在各文件里。
 *
 * 采样字段都取「中性默认值」（温度 1 与服务端默认一致、长度 0 表示不下发 max_tokens、
 * 提示词空串表示不注入），因此默认配置下的请求体与引入本文件之前完全等价。
 */

/** 默认走 OpenAI 官方；换服务商改设置页即可，不用动代码 */
export const DEFAULT_API_BASE_URL = 'https://api.openai.com/v1';

export interface GenerationSettings {
  /** 接口地址，填到 /v1 为止（不含 /chat/completions） */
  apiBaseUrl: string;
  /** 系统提示词；空串表示不注入 */
  systemPrompt: string;
  /** 随机性；1 与服务端默认一致 */
  temperature: number;
  /** 最大生成长度；0 表示不限制（不下发） */
  maxTokens: number;
  /** 语音转写模型（/audio/transcriptions）；各家命名不同，所以做成可配置 */
  transcriptionModel: string;
}

/**
 * 温度上限取 1.5 而不是 OpenAI 的 2：小米 MiMo 等国产模型的文档范围是 [0, 1.5]，
 * 取各家的交集，换服务商时提示词参数才不会越界被拒。
 */
export const TEMPERATURE_MIN = 0;
export const TEMPERATURE_MAX = 1.5;
/** 提示词上限，防止用户粘贴一整篇文档把设置文件撑大 */
export const SYSTEM_PROMPT_MAX_LENGTH = 4000;
/** 转写模型名上限（模型 ID 都很短，这里只是兜底防脏数据） */
export const TRANSCRIPTION_MODEL_MAX_LENGTH = 60;
/** OpenAI 兼容实现的通用转写模型名 */
export const DEFAULT_TRANSCRIPTION_MODEL = 'whisper-1';

export const DEFAULT_GENERATION_SETTINGS: GenerationSettings = {
  apiBaseUrl: DEFAULT_API_BASE_URL,
  systemPrompt: '',
  temperature: 1,
  maxTokens: 0,
  transcriptionModel: DEFAULT_TRANSCRIPTION_MODEL,
};

export interface TemperaturePreset {
  key: 'precise' | 'balanced' | 'creative';
  label: string;
  hint: string;
  value: number;
}

export const TEMPERATURE_PRESETS: readonly TemperaturePreset[] = [
  { key: 'precise', label: '精确', hint: '代码与事实问答', value: 0.2 },
  { key: 'balanced', label: '平衡', hint: '日常对话', value: 1 },
  { key: 'creative', label: '创意', hint: '写作与灵感', value: 1.4 },
];

/** 最大生成长度档位，0 表示不限制 */
export const MAX_TOKENS_OPTIONS: readonly number[] = [0, 512, 1024, 2048, 4096];

export interface ProviderPreset {
  key: string;
  label: string;
  baseUrl: string;
  models: readonly string[];
}

/**
 * 常见服务商的接口地址与模型 ID。
 * 设置页里点一下就把地址和模型一起填好，省得用户手抄；填错地址是这类应用最常见的失败原因。
 */
export const PROVIDER_PRESETS: readonly ProviderPreset[] = [
  {
    key: 'openai',
    label: 'OpenAI',
    baseUrl: 'https://api.openai.com/v1',
    models: ['gpt-4o-mini', 'gpt-4o', 'gpt-4.1-mini', 'gpt-4.1'],
  },
  {
    key: 'mimo',
    label: '小米 MiMo',
    baseUrl: 'https://api.xiaomimimo.com/v1',
    // 顺序即默认选中项：mimo-v2.5-pro 是排队型的高峰模型，
    // 实测常常只回 `: PROCESSING` 注释、长时间不出内容，因此把稳定的 mimo-v2.5 放在首位
    models: ['mimo-v2.5', 'mimo-v2.5-pro'],
  },
];

/** 当前地址属于哪个预设服务商；认不出来返回 null（说明用户用的是自定义/中转地址） */
export function findProviderByBaseUrl(baseUrl: string): ProviderPreset | null {
  const target = normalizeBaseUrl(baseUrl);
  return PROVIDER_PRESETS.find((preset) => preset.baseUrl === target) ?? null;
}

/**
 * 收敛用户填的接口地址，吸收两种最常见的粘贴错误：
 * 整条 endpoint（末尾带 /chat/completions）和只填了协议+域名。
 */
export function normalizeBaseUrl(raw: unknown): string {
  if (typeof raw !== 'string') return DEFAULT_API_BASE_URL;

  let url = raw.trim().replace(/\/+$/, '');
  if (url.length === 0) return DEFAULT_API_BASE_URL;

  url = url.replace(/\/chat\/completions$/, '');
  // 只填域名没有路径时补 /v1：这是绝大多数服务商的约定，包括 OpenAI 与 MiMo
  if (/^https?:\/\/[^/]+$/.test(url)) url = `${url}/v1`;

  return url;
}

export function formatMaxTokens(value: number): string {
  return value <= 0 ? '不限制' : `${value}`;
}

/** 统一成一位小数，避免设置页出现 0.19999999999999998 这种脏数字 */
export function formatTemperature(value: number): string {
  return value.toFixed(1);
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

/**
 * 把任意来源（旧版本 JSON、被手动改过的文件）的输入收敛成合法配置。
 * 类型不对或越界一律回退默认值，绝不抛错——启动期读配置失败不该拖垮整个应用。
 */
export function normalizeGenerationSettings(raw: unknown): GenerationSettings {
  if (!raw || typeof raw !== 'object') return DEFAULT_GENERATION_SETTINGS;
  const source = raw as Partial<Record<keyof GenerationSettings, unknown>>;

  const apiBaseUrl = normalizeBaseUrl(source.apiBaseUrl);

  const systemPrompt =
    typeof source.systemPrompt === 'string'
      ? source.systemPrompt.slice(0, SYSTEM_PROMPT_MAX_LENGTH)
      : DEFAULT_GENERATION_SETTINGS.systemPrompt;

  const temperature =
    typeof source.temperature === 'number' && Number.isFinite(source.temperature)
      ? clamp(source.temperature, TEMPERATURE_MIN, TEMPERATURE_MAX)
      : DEFAULT_GENERATION_SETTINGS.temperature;

  const maxTokens =
    typeof source.maxTokens === 'number' && Number.isFinite(source.maxTokens) && source.maxTokens >= 0
      ? Math.floor(source.maxTokens)
      : DEFAULT_GENERATION_SETTINGS.maxTokens;

  // 旧版本没有这个字段：空值一律回退默认模型，而不是留一个空串去请求
  const transcriptionModel =
    typeof source.transcriptionModel === 'string' && source.transcriptionModel.trim().length > 0
      ? source.transcriptionModel.trim().slice(0, TRANSCRIPTION_MODEL_MAX_LENGTH)
      : DEFAULT_GENERATION_SETTINGS.transcriptionModel;

  return { apiBaseUrl, systemPrompt, temperature, maxTokens, transcriptionModel };
}
