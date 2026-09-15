import { Pressable, StyleSheet, Text, View } from 'react-native';

import { BorderRadius, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

export interface ControlOption<T> {
  value: T;
  label: string;
}

interface ChipGroupProps<T> {
  options: readonly ControlOption<T>[];
  value: T;
  onChange: (value: T) => void;
  disabled?: boolean;
}

/** 可换行的胶囊选择组：模型、最大长度这类「离散多选一」都用它 */
export function ChipGroup<T extends string | number>({
  options,
  value,
  onChange,
  disabled,
}: ChipGroupProps<T>) {
  const theme = useTheme();

  return (
    <View style={styles.chips}>
      {options.map((option) => {
        const active = option.value === value;
        return (
          <Pressable
            key={String(option.value)}
            accessibilityRole="button"
            accessibilityState={{ selected: active, disabled: Boolean(disabled) }}
            disabled={disabled}
            onPress={() => onChange(option.value)}
            style={({ pressed }) => [
              styles.chip,
              {
                backgroundColor: active ? theme.primary : theme.backgroundElement,
                borderColor: active ? theme.primary : theme.border,
              },
              pressed && styles.pressed,
              disabled && styles.disabled,
            ]}>
            <Text
              style={[styles.chipText, { color: active ? theme.onPrimary : theme.textSecondary }]}>
              {option.label}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

interface SegmentedControlProps<T> {
  options: readonly ControlOption<T>[];
  value: T;
  onChange: (value: T) => void;
  disabled?: boolean;
}

/** 等宽分段控件：档位固定且互斥时比胶囊组更紧凑、也更像原生控件 */
export function SegmentedControl<T extends string | number>({
  options,
  value,
  onChange,
  disabled,
}: SegmentedControlProps<T>) {
  const theme = useTheme();

  return (
    <View style={[styles.track, { backgroundColor: theme.backgroundElement, borderColor: theme.border }]}>
      {options.map((option) => {
        const active = option.value === value;
        return (
          <Pressable
            key={String(option.value)}
            accessibilityRole="button"
            accessibilityState={{ selected: active, disabled: Boolean(disabled) }}
            disabled={disabled}
            onPress={() => onChange(option.value)}
            style={({ pressed }) => [
              styles.segment,
              active && { backgroundColor: theme.primary },
              pressed && styles.pressed,
              disabled && styles.disabled,
            ]}>
            <Text
              numberOfLines={1}
              style={[
                styles.segmentLabel,
                { color: active ? theme.onPrimary : theme.textSecondary },
              ]}>
              {option.label}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

interface StepperProps {
  value: number;
  min: number;
  max: number;
  step: number;
  onChange: (value: number) => void;
  formatValue?: (value: number) => string;
}

/** 数值微调器：给分段控件补一个「精确到位」的出口 */
export function Stepper({ value, min, max, step, onChange, formatValue }: StepperProps) {
  const theme = useTheme();
  const atMin = value <= min + 1e-9;
  const atMax = value >= max - 1e-9;

  const nudge = (delta: number) => {
    const next = Math.min(max, Math.max(min, value + delta));
    // 0.1 步进会攒出 1.0000000000000002 这种脏值，按 step 的小数位收敛一下
    const decimals = `${step}`.split('.')[1]?.length ?? 0;
    onChange(Number(next.toFixed(decimals)));
  };

  return (
    <View
      style={[styles.stepper, { backgroundColor: theme.backgroundElement, borderColor: theme.border }]}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="减小"
        disabled={atMin}
        onPress={() => nudge(-step)}
        style={({ pressed }) => [
          styles.stepperButton,
          pressed && styles.pressed,
          atMin && styles.disabled,
        ]}>
        <Text style={[styles.stepperSign, { color: theme.text }]}>-</Text>
      </Pressable>

      <Text style={[styles.stepperValue, { color: theme.text }]}>
        {(formatValue ?? String)(value)}
      </Text>

      <Pressable
        accessibilityRole="button"
        accessibilityLabel="增大"
        disabled={atMax}
        onPress={() => nudge(step)}
        style={({ pressed }) => [
          styles.stepperButton,
          pressed && styles.pressed,
          atMax && styles.disabled,
        ]}>
        <Text style={[styles.stepperSign, { color: theme.text }]}>+</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.two },
  chip: {
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.two,
    borderRadius: BorderRadius.large,
    borderWidth: StyleSheet.hairlineWidth,
  },
  chipText: { fontSize: 13, fontWeight: '500' },
  track: {
    flexDirection: 'row',
    borderRadius: BorderRadius.large,
    borderWidth: StyleSheet.hairlineWidth,
    padding: Spacing.half,
    gap: Spacing.half,
  },
  segment: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: Spacing.two,
    borderRadius: BorderRadius.medium,
  },
  segmentLabel: { fontSize: 13, fontWeight: '600' },
  stepper: {
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: BorderRadius.large,
    borderWidth: StyleSheet.hairlineWidth,
  },
  stepperButton: {
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.two,
    minWidth: 44,
    alignItems: 'center',
  },
  stepperSign: { fontSize: 18, fontWeight: '600', lineHeight: 22 },
  stepperValue: {
    flex: 1,
    textAlign: 'center',
    fontSize: 15,
    fontWeight: '600',
  },
  pressed: { opacity: 0.7 },
  disabled: { opacity: 0.4 },
});
