import { useMemo, useState } from 'react';
import { StyleSheet, TextInput, View } from 'react-native';

import { ChipGroup } from '@/components/settings/settings-controls';
import {
  FieldHint,
  SettingsCard,
  SettingsNote,
  SettingsSection,
} from '@/components/settings/settings-section';
import { useDraftField } from '@/components/settings/use-draft-field';
import { ThemedText } from '@/components/themed-text';
import {
  DEFAULT_TRANSCRIPTION_MODEL,
  findProviderByBaseUrl,
  isValidBaseUrl,
  normalizeBaseUrl,
  PROVIDER_PRESETS,
  type ProviderPreset,
} from '@/constants/chat-params';
import { BorderRadius, Spacing } from '@/constants/theme';
import { useSavedFlash } from '@/hooks/use-transient-flag';
import { useTheme } from '@/hooks/use-theme';
import { useChat } from '@/store/chat-store';

/** 文本类设置停笔多久后落盘 */
const COMMIT_DELAY = 500;

/**
 * 「接口」与「语音输入」两个分区。
 *
 * 「接口」决定请求发到哪家服务商、用哪个模型 —— 这是自建/多服务商场景下最容易配错的地方，
 * 也是失败率最高的地方，所以除了输入框还给了服务商预设，并把**最终会请求的完整地址**
 * 直接显示出来，让用户在发消息之前就能确认自己没写错。
 *
 * 转写模型单独成一个分区：它复用「接口」里的地址与密钥（OpenAI 兼容的
 * /audio/transcriptions），但属于语音输入能力，混在接口卡片里只会让这一屏更长。
 */
export function EndpointSection() {
  const theme = useTheme();
  const { model, updateModel, generationSettings, updateGenerationSettings } = useChat();

  const baseUrl = useDraftField(
    generationSettings.apiBaseUrl,
    (value) => void updateGenerationSettings({ apiBaseUrl: value }),
    COMMIT_DELAY
  );
  const modelField = useDraftField(model, (value) => void updateModel(value), COMMIT_DELAY);
  const transcriptionField = useDraftField(
    generationSettings.transcriptionModel,
    (value) => void updateGenerationSettings({ transcriptionModel: value }),
    COMMIT_DELAY
  );

  // 失焦后才提示：边打字边报错会一路闪红，而用户很可能只是还没打完
  const [baseUrlTouched, setBaseUrlTouched] = useState(false);
  const baseUrlInvalid = baseUrlTouched && !isValidBaseUrl(baseUrl.draft);

  const baseUrlSaved = useSavedFlash(baseUrl.savedTick);
  const modelSaved = useSavedFlash(modelField.savedTick);
  const transcriptionSaved = useSavedFlash(transcriptionField.savedTick);

  const provider = findProviderByBaseUrl(generationSettings.apiBaseUrl);

  // 只列当前服务商自己的模型。预设变多之后，把全部服务商的模型摊平会堆出几十个胶囊、把页面撑得极长。
  // 认不出地址（自定义/中转网关）时索性一个都不列 —— 那种场景只能照对方文档手填模型 ID。
  const modelOptions = useMemo(() => {
    if (!provider) return [];
    return [...new Set(provider.models)].map((name) => ({ value: name, label: name }));
  }, [provider]);

  const providerOptions = PROVIDER_PRESETS.map((preset) => ({
    value: preset.key,
    label: preset.label,
  }));

  const applyProvider = (preset: ProviderPreset) => {
    baseUrl.setDraft(preset.baseUrl, true);
    // 只在当前模型不属于新服务商时才替换，避免把用户特意选的模型冲掉
    if (!preset.models.includes(modelField.draft)) {
      modelField.setDraft(preset.models[0], true);
    }
    // 转写模型是服务商相关的：换服务商时不重置，会把 whisper-1 发到不认它的地址上
    if (provider?.key !== preset.key) {
      transcriptionField.setDraft(DEFAULT_TRANSCRIPTION_MODEL, true);
    }
  };

  const endpoint = `${normalizeBaseUrl(generationSettings.apiBaseUrl)}/chat/completions`;

  return (
    <>
      <SettingsSection title="接口" caption="决定请求发往哪家服务商，换模型前先确认这里">
        <SettingsCard>
          <View style={styles.fieldHeader}>
            <ThemedText style={styles.fieldLabel}>接口地址</ThemedText>
            <FieldHint hint="填到 /v1 为止" saved={baseUrlSaved} />
          </View>

          <TextInput
            style={[
              styles.input,
              {
                color: theme.text,
                backgroundColor: theme.backgroundInput,
                borderColor: baseUrlInvalid ? theme.danger : theme.border,
              },
            ]}
            value={baseUrl.draft}
            onChangeText={(value) => baseUrl.setDraft(value)}
            onBlur={() => setBaseUrlTouched(true)}
            placeholder="https://api.openai.com/v1"
            placeholderTextColor={theme.textTertiary}
            autoCapitalize="none"
            autoCorrect={false}
            keyboardType="url"
          />

          <ChipGroup
            options={providerOptions}
            value={provider?.key ?? ''}
            onChange={(key) => {
              const preset = PROVIDER_PRESETS.find((item) => item.key === key);
              if (preset) applyProvider(preset);
            }}
          />

          {baseUrlInvalid ? (
            <ThemedText type="small" themeColor="danger">
              地址要以 http:// 或 https:// 开头，例如 https://api.openai.com/v1
            </ThemedText>
          ) : (
            <SettingsNote>{`实际请求：${endpoint}`}</SettingsNote>
          )}
        </SettingsCard>

        <SettingsCard>
          <View style={styles.fieldHeader}>
            <ThemedText style={styles.fieldLabel}>模型 ID</ThemedText>
            <FieldHint hint="按服务商的文档填写" saved={modelSaved} />
          </View>

          <TextInput
            style={[
              styles.input,
              {
                color: theme.text,
                backgroundColor: theme.backgroundInput,
                borderColor: theme.border,
              },
            ]}
            value={modelField.draft}
            onChangeText={(value) => modelField.setDraft(value)}
            placeholder="gpt-4o-mini"
            placeholderTextColor={theme.textTertiary}
            autoCapitalize="none"
            autoCorrect={false}
          />

          {modelOptions.length > 0 ? (
            <ChipGroup
              options={modelOptions}
              value={modelField.draft}
              onChange={(name) => modelField.setDraft(name, true)}
            />
          ) : (
            <SettingsNote>
              当前是自定义/中转地址，模型 ID 请按服务商文档手填；点上方服务商胶囊可切回内置预设。
            </SettingsNote>
          )}
        </SettingsCard>
      </SettingsSection>

      <SettingsSection title="语音输入" caption="录音转文字，复用「接口」里的地址与密钥">
        <SettingsCard>
          <View style={styles.fieldHeader}>
            <ThemedText style={styles.fieldLabel}>语音转写模型</ThemedText>
            <FieldHint hint="留空则用默认" saved={transcriptionSaved} />
          </View>

          <TextInput
            style={[
              styles.input,
              {
                color: theme.text,
                backgroundColor: theme.backgroundInput,
                borderColor: theme.border,
              },
            ]}
            value={transcriptionField.draft}
            onChangeText={(value) => transcriptionField.setDraft(value)}
            placeholder={DEFAULT_TRANSCRIPTION_MODEL}
            placeholderTextColor={theme.textTertiary}
            autoCapitalize="none"
            autoCorrect={false}
          />

          <SettingsNote>
            {`语音输入会把录音发到 ${normalizeBaseUrl(
              generationSettings.apiBaseUrl
            )}/audio/transcriptions 识别；留空则用 ${DEFAULT_TRANSCRIPTION_MODEL}。`}
          </SettingsNote>
        </SettingsCard>
      </SettingsSection>
    </>
  );
}

const styles = StyleSheet.create({
  fieldHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: Spacing.two,
  },
  fieldLabel: { fontSize: 15, fontWeight: '600' },
  input: {
    fontSize: 15,
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.three,
    borderRadius: BorderRadius.medium,
    borderWidth: StyleSheet.hairlineWidth,
  },
});
