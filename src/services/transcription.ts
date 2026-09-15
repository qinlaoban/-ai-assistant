/**
 * 语音转写。
 *
 * 走 OpenAI 兼容的 `POST {baseUrl}/audio/transcriptions`，直接复用用户已经配好的
 * 接口地址与 API Key —— 不引入另一套账号体系，也不用额外的原生语音识别模块。
 * 代价是这条链路依赖服务商实现该接口，不支持时会拿到明确的服务端报错。
 *
 * 刻意用相对路径 + `.ts` 扩展名导入，保持可被 Node 直接加载（与 ai-service 同策略）。
 */
import { Platform } from 'react-native';

import { DEFAULT_API_BASE_URL, normalizeBaseUrl } from '../constants/chat-params.ts';
import { AIError } from './ai-service.ts';

export interface TranscriptionConfig {
  /** 接口地址，填到 /v1 为止；不传则用 OpenAI 官方地址 */
  baseUrl?: string;
  apiKey: string;
  /** 转写模型，如 whisper-1 */
  model: string;
}

/** 录音文件的容器格式：iOS/Android 的 expo-audio 默认产出 m4a，web 是 webm */
const NATIVE_AUDIO = { name: 'speech.m4a', type: 'audio/m4a' } as const;
const WEB_AUDIO_NAME = 'speech.webm';

async function readErrorMessage(response: Response): Promise<string> {
  const body = await response.json().catch(() => null);
  const detail = body?.error?.message;
  if (typeof detail === 'string' && detail.length > 0) return detail;
  if (response.status === 401) return 'API Key 无效或已过期（HTTP 401）';
  if (response.status === 404) {
    return '该接口地址不支持语音转写（HTTP 404）。可在设置里换成支持 /audio/transcriptions 的服务商。';
  }
  if (response.status === 429) return '请求过于频繁或额度不足（HTTP 429）';
  return `语音转写失败（HTTP ${response.status}）`;
}

/** 把录音文件塞进 FormData：原生端用 RN 的 { uri, name, type } 形状，web 端要真正的 Blob */
async function appendAudio(form: FormData, uri: string): Promise<void> {
  if (Platform.OS === 'web') {
    const blob = await (await fetch(uri)).blob();
    form.append('file', blob, WEB_AUDIO_NAME);
    return;
  }
  form.append('file', { uri, name: NATIVE_AUDIO.name, type: NATIVE_AUDIO.type } as unknown as Blob);
}

/**
 * 把一段录音转成文字。
 * 成功返回去掉首尾空白的文本；失败抛 AIError（文案已可直接展示）。
 */
export async function transcribeAudio(
  uri: string,
  config: TranscriptionConfig,
  signal?: AbortSignal
): Promise<string> {
  if (!config.apiKey) throw new AIError('请先设置 API Key');

  const endpoint = `${normalizeBaseUrl(config.baseUrl ?? DEFAULT_API_BASE_URL)}/audio/transcriptions`;
  const form = new FormData();
  await appendAudio(form, uri);
  form.append('model', config.model);

  // 不要手动设 Content-Type：multipart 的 boundary 必须由 fetch 自己生成
  const response = await fetch(endpoint, {
    method: 'POST',
    headers: { Authorization: `Bearer ${config.apiKey}` },
    body: form,
    signal,
  });

  if (!response.ok) {
    throw new AIError(await readErrorMessage(response), response.status);
  }

  const data = (await response.json().catch(() => null)) as { text?: unknown } | null;
  const text = typeof data?.text === 'string' ? data.text.trim() : '';
  if (text.length === 0) throw new AIError('语音识别没有返回文本，换个说法再试一次');
  return text;
}
