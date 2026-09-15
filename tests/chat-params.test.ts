import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  DEFAULT_API_BASE_URL,
  DEFAULT_GENERATION_SETTINGS,
  findProviderByBaseUrl,
  formatMaxTokens,
  formatTemperature,
  MAX_TOKENS_OPTIONS,
  normalizeBaseUrl,
  normalizeGenerationSettings,
  PROVIDER_PRESETS,
  SYSTEM_PROMPT_MAX_LENGTH,
  TEMPERATURE_MAX,
  TEMPERATURE_MIN,
} from '../src/constants/chat-params.ts';

// ------------------------------------------------------------ 接口地址归一化

test('normalizeBaseUrl：只填域名时补 /v1', () => {
  assert.equal(normalizeBaseUrl('https://api.xiaomimimo.com'), 'https://api.xiaomimimo.com/v1');
  assert.equal(normalizeBaseUrl('https://api.openai.com'), 'https://api.openai.com/v1');
});

test('normalizeBaseUrl：本地部署（带端口、无路径）补 /v1', () => {
  assert.equal(normalizeBaseUrl('http://192.168.1.9:8000'), 'http://192.168.1.9:8000/v1');
  assert.equal(normalizeBaseUrl('http://localhost:11434/v1'), 'http://localhost:11434/v1');
});

test('normalizeBaseUrl：容忍末尾斜杠', () => {
  assert.equal(normalizeBaseUrl('https://api.xiaomimimo.com/v1/'), 'https://api.xiaomimimo.com/v1');
  assert.equal(normalizeBaseUrl('https://api.xiaomimimo.com///'), 'https://api.xiaomimimo.com/v1');
});

test('normalizeBaseUrl：粘贴了整条 endpoint 时截掉 /chat/completions', () => {
  assert.equal(
    normalizeBaseUrl('https://api.xiaomimimo.com/v1/chat/completions'),
    'https://api.xiaomimimo.com/v1'
  );
});

test('normalizeBaseUrl：保留自定义网关自身的子路径', () => {
  assert.equal(
    normalizeBaseUrl('https://gateway.example.com/openai'),
    'https://gateway.example.com/openai'
  );
});

test('normalizeBaseUrl：空值或非法类型回退默认地址', () => {
  assert.equal(normalizeBaseUrl(''), DEFAULT_API_BASE_URL);
  assert.equal(normalizeBaseUrl('   '), DEFAULT_API_BASE_URL);
  assert.equal(normalizeBaseUrl(undefined), DEFAULT_API_BASE_URL);
  assert.equal(normalizeBaseUrl(42), DEFAULT_API_BASE_URL);
});

// ------------------------------------------------------------ 服务商预设

test('内置预设：MiMo 的地址与模型 ID 与官方文档一致', () => {
  const mimo = PROVIDER_PRESETS.find((preset) => preset.key === 'mimo');
  assert.ok(mimo, '应存在 MiMo 预设');
  assert.equal(mimo.baseUrl, 'https://api.xiaomimimo.com/v1');
  assert.deepEqual([...mimo.models], ['mimo-v2.5', 'mimo-v2.5-pro']);
});

test('内置预设：点一下会选中的那个模型必须是稳定的', () => {
  // 点预设会选中 models[0]。mimo-v2.5-pro 实测常常只在 SSE 里回 `: PROCESSING` 保活注释、
  // 长时间不产出正文（服务端排队），一旦成为默认，用户点完就是无限等待
  const mimo = PROVIDER_PRESETS.find((preset) => preset.key === 'mimo');
  assert.equal(mimo?.models[0], 'mimo-v2.5');
});

test('findProviderByBaseUrl：能容忍用户少填 /v1 或末尾多斜杠', () => {
  assert.equal(findProviderByBaseUrl('https://api.xiaomimimo.com')?.key, 'mimo');
  assert.equal(findProviderByBaseUrl('https://api.openai.com/v1/')?.key, 'openai');
});

test('findProviderByBaseUrl：自定义或中转地址返回 null（此时模型列表回落为全集）', () => {
  assert.equal(findProviderByBaseUrl('https://my-gateway.example.com/v1'), null);
});

// ------------------------------------------------------------ 设置收敛

test('normalizeGenerationSettings：温度被钳制到各家支持范围的交集内', () => {
  assert.equal(normalizeGenerationSettings({ temperature: 2 }).temperature, TEMPERATURE_MAX);
  assert.equal(normalizeGenerationSettings({ temperature: -1 }).temperature, TEMPERATURE_MIN);
  assert.equal(normalizeGenerationSettings({ temperature: 0.7 }).temperature, 0.7);
  assert.equal(
    normalizeGenerationSettings({ temperature: Number.NaN }).temperature,
    DEFAULT_GENERATION_SETTINGS.temperature
  );
});

test('normalizeGenerationSettings：长度与提示词做边界收敛', () => {
  assert.equal(normalizeGenerationSettings({ maxTokens: -5 }).maxTokens, 0);
  assert.equal(normalizeGenerationSettings({ maxTokens: 512.9 }).maxTokens, 512);
  assert.equal(
    normalizeGenerationSettings({ systemPrompt: 'x'.repeat(99999) }).systemPrompt.length,
    SYSTEM_PROMPT_MAX_LENGTH
  );
});

test('normalizeGenerationSettings：接口地址在归一化时被一并收敛', () => {
  assert.equal(
    normalizeGenerationSettings({ apiBaseUrl: 'https://api.xiaomimimo.com/' }).apiBaseUrl,
    'https://api.xiaomimimo.com/v1'
  );
});

test('normalizeGenerationSettings：垃圾输入整体回退默认值，绝不抛错', () => {
  assert.deepEqual(normalizeGenerationSettings(null), DEFAULT_GENERATION_SETTINGS);
  assert.deepEqual(normalizeGenerationSettings('not an object'), DEFAULT_GENERATION_SETTINGS);
  assert.deepEqual(normalizeGenerationSettings(undefined), DEFAULT_GENERATION_SETTINGS);
});

test('normalizeGenerationSettings：旧版本没有 apiBaseUrl 的设置文件能平滑升级', () => {
  const migrated = normalizeGenerationSettings({
    systemPrompt: '你好',
    temperature: 0.5,
    maxTokens: 1024,
  });
  assert.equal(migrated.apiBaseUrl, DEFAULT_API_BASE_URL);
  assert.equal(migrated.temperature, 0.5);
  assert.equal(migrated.maxTokens, 1024);
});

// ------------------------------------------------------------ 展示格式化

test('展示格式化', () => {
  assert.equal(formatMaxTokens(0), '不限制');
  assert.equal(formatMaxTokens(1024), '1024');
  assert.equal(formatTemperature(1), '1.0');
  assert.ok(MAX_TOKENS_OPTIONS.includes(0), '长度档位里必须有「不限制」这一项');
});
