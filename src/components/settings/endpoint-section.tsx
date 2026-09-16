import { useMemo } from 'react';
import { StyleSheet, TextInput, View } from 'react-native';

import { ChipGroup } from '@/components/settings/settings-controls';
import { SettingsCard, SettingsNote, SettingsSection } from '@/components/settings/settings-section';
import { useDraftField } from '@/components/settings/use-draft-field';
import { ThemedText } from '@/components/themed-text';
import {
  DEFAULT_TRANSCRIPTION_MODEL,
  findProviderByBaseUrl,
  normalizeBaseUrl,
  PROVIDER_PRESETS,
  type ProviderPreset,
} from '@/constants/chat-params';
import { BorderRadius, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { useChat } from '@/store/chat-store';

/** 文本类设置停笔多久后落盘 */
const COMMIT_DELAY = 500;

/**
 * 「接口」分区：决定请求发到哪家服务商、用哪个模型。
 *
 * 这两项是自建/多服务商场景下最容易配错的地方，也是失败率最高的地方，
 * 所以除了输入框还给了快捷预设，并把**最终会请求的完整地址**直接显示出来，
 * 让用户在发消息之前就能确认自己没写错。
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

  const provider = findProviderByBaseUrl(generationSettings.apiBaseUrl);

  // 认不出当前地址（自定义或中转）时，把所有已知模型都列出来当参考
  const modelOptions = useMemo(() => {
    const names = provider ? provider.models : PROVIDER_PRESETS.flatMap((preset) => preset.models);
    return [...new Set(names)].map((name) => ({ value: name, label: name }));
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
    <SettingsSection title="接口" caption="决定请求发往哪家服务商，换模型前先确认这里">
      <SettingsCard>
        <View style={styles.fieldHeader}>
          <ThemedText style={styles.fieldLabel}>接口地址</ThemedText>
          <ThemedText type="small" themeColor="textTertiary">
            填到 /v1 为止
          </ThemedText>
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
          value={baseUrl.draft}
          onChangeText={(value) => baseUrl.setDraft(value)}
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

        <SettingsNote>{`实际请求：${endpoint}`}</SettingsNote>
      </SettingsCard>

      <SettingsCard>
        <View style={styles.fieldHeader}>
          <ThemedText style={styles.fieldLabel}>模型 ID</ThemedText>
          <ThemedText type="small" themeColor="textTertiary">
            按服务商的文档填写
          </ThemedText>
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

        <ChipGroup
          options={modelOptions}
          value={modelField.draft}
          onChange={(name) => modelField.setDraft(name, true)}
        />
      </SettingsCard>

      <SettingsCard>
        <View style={styles.fieldHeader}>
          <ThemedText style={styles.fieldLabel}>语音转写模型</ThemedText>
          <ThemedText type="small" themeColor="textTertiary">
            语音输入用
          </ThemedText>
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
