import { StyleSheet, TextInput, View } from 'react-native';

import { ChipGroup, SegmentedControl, Stepper } from '@/components/settings/settings-controls';
import { SettingsCard, SettingsSection } from '@/components/settings/settings-section';
import { useDraftField } from '@/components/settings/use-draft-field';
import { ThemedText } from '@/components/themed-text';
import {
  formatMaxTokens,
  formatTemperature,
  MAX_TOKENS_OPTIONS,
  SYSTEM_PROMPT_MAX_LENGTH,
  TEMPERATURE_MAX,
  TEMPERATURE_MIN,
  TEMPERATURE_PRESETS,
} from '@/constants/chat-params';
import { BorderRadius, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { useChat } from '@/store/chat-store';

/** 提示词停笔多久后落盘 */
const PROMPT_COMMIT_DELAY = 500;
/** 随机性微调的步长 */
const TEMPERATURE_STEP = 0.1;

const MAX_TOKENS_CONTROL_OPTIONS = MAX_TOKENS_OPTIONS.map((value) => ({
  value,
  label: formatMaxTokens(value),
}));

const TEMPERATURE_CONTROL_OPTIONS = TEMPERATURE_PRESETS.map((preset) => ({
  value: preset.value,
  label: preset.label,
}));

/** 「生成参数」分区：系统提示词、随机性、最大长度 */
export function GenerationSection() {
  const theme = useTheme();
  const { generationSettings, updateGenerationSettings } = useChat();

  // 设置页是在启动读取完成之后才挂载的，所以挂载时取到的就是已持久化的值
  const prompt = useDraftField(
    generationSettings.systemPrompt,
    (value) => void updateGenerationSettings({ systemPrompt: value }),
    PROMPT_COMMIT_DELAY
  );

  const activePreset = TEMPERATURE_PRESETS.find(
    (preset) => Math.abs(preset.value - generationSettings.temperature) < 1e-9
  );

  return (
    <SettingsSection title="生成参数" caption="影响模型如何组织回答，仅作用于本机发出的请求">
      <SettingsCard>
        <View style={styles.fieldHeader}>
          <ThemedText style={styles.fieldLabel}>系统提示词</ThemedText>
          <ThemedText type="small" themeColor="textTertiary">
            留空则不注入
          </ThemedText>
        </View>
        <TextInput
          style={[
            styles.promptInput,
            {
              color: theme.text,
              backgroundColor: theme.backgroundInput,
              borderColor: theme.border,
            },
          ]}
          value={prompt.draft}
          onChangeText={(value) => prompt.setDraft(value)}
          placeholder="例如：你是一位资深工程师，回答先给结论，再给必要的推导。"
          placeholderTextColor={theme.textTertiary}
          multiline
          maxLength={SYSTEM_PROMPT_MAX_LENGTH}
          textAlignVertical="top"
        />
      </SettingsCard>

      <SettingsCard>
        <View style={styles.fieldHeader}>
          <ThemedText style={styles.fieldLabel}>随机性</ThemedText>
          <ThemedText type="small" themeColor="textTertiary">
            {activePreset ? activePreset.hint : '已自定义'}
          </ThemedText>
        </View>
        <SegmentedControl
          options={TEMPERATURE_CONTROL_OPTIONS}
          value={generationSettings.temperature}
          onChange={(next) => void updateGenerationSettings({ temperature: next })}
        />
        <View style={styles.stepperRow}>
          <ThemedText type="small" themeColor="textTertiary">
            精确调节
          </ThemedText>
          <View style={styles.stepperBox}>
            <Stepper
              value={generationSettings.temperature}
              min={TEMPERATURE_MIN}
              max={TEMPERATURE_MAX}
              step={TEMPERATURE_STEP}
              formatValue={formatTemperature}
              onChange={(next) => void updateGenerationSettings({ temperature: next })}
            />
          </View>
        </View>
      </SettingsCard>

      <SettingsCard>
        <View style={styles.fieldHeader}>
          <ThemedText style={styles.fieldLabel}>最大长度</ThemedText>
          <ThemedText type="small" themeColor="textTertiary">
            单条回答的上限
          </ThemedText>
        </View>
        <ChipGroup
          options={MAX_TOKENS_CONTROL_OPTIONS}
          value={generationSettings.maxTokens}
          onChange={(next) => void updateGenerationSettings({ maxTokens: next })}
        />
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
  promptInput: {
    minHeight: 96,
    maxHeight: 200,
    fontSize: 15,
    lineHeight: 21,
    padding: Spacing.three,
    borderRadius: BorderRadius.medium,
    borderWidth: StyleSheet.hairlineWidth,
  },
  stepperRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: Spacing.three,
  },
  stepperBox: { width: 160 },
});
