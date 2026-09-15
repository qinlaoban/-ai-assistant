import {
  AudioModule,
  RecordingPresets,
  setAudioModeAsync,
  useAudioRecorder,
  useAudioRecorderState,
} from 'expo-audio';
import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet } from 'react-native';

import { MicIcon } from '@/components/icons';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { transcribeAudio } from '@/services/transcription';
import { useChat } from '@/store/chat-store';

export type VoiceStatus = 'idle' | 'recording' | 'transcribing';

/**
 * 语音输入按钮。
 *
 * 录音用 expo-audio，转写走服务商的 `/audio/transcriptions` —— 复用用户已配好的
 * 接口地址与 Key，不额外引入原生语音识别模块（那类模块还需要自定义开发版构建）。
 *
 * 状态只在「录音中 / 识别中」两个瞬时阶段存在，通过 onStatusChange 上抛给工具栏显示提示，
 * 组件本身不渲染文字，避免工具栏布局随状态抖动。
 */
export function VoiceButton({
  disabled = false,
  onTranscript,
  onError,
  onStatusChange,
}: {
  disabled?: boolean;
  /** 转写成功，把文本交给输入框 */
  onTranscript: (text: string) => void;
  /** 权限被拒 / 转写失败等，由父级统一用错误条或轻提示呈现 */
  onError: (message: string) => void;
  onStatusChange?: (status: VoiceStatus) => void;
}) {
  const theme = useTheme();
  const { apiKey, generationSettings } = useChat();
  const recorder = useAudioRecorder(RecordingPresets.HIGH_QUALITY);
  const recorderState = useAudioRecorderState(recorder);
  const [transcribing, setTranscribing] = useState(false);

  const recording = recorderState.isRecording;

  // 状态同步给父级，由它决定提示文案
  useEffect(() => {
    onStatusChange?.(transcribing ? 'transcribing' : recording ? 'recording' : 'idle');
  }, [recording, transcribing, onStatusChange]);

  const start = useCallback(async () => {
    const permission = await AudioModule.requestRecordingPermissionsAsync();
    if (!permission.granted) {
      onError('没有麦克风权限，请在系统设置里允许后重试');
      return;
    }
    // iOS 静音开关下也必须能录到声音
    await setAudioModeAsync({ playsInSilentMode: true, allowsRecording: true });
    await recorder.prepareToRecordAsync();
    recorder.record();
  }, [recorder, onError]);

  const stop = useCallback(async () => {
    await recorder.stop();
    // uri 只有 stop 之后才拿得到
    const uri = recorder.uri;
    setTranscribing(true);
    try {
      if (!uri) throw new Error('录音失败：没有拿到音频文件');
      const text = await transcribeAudio(uri, {
        apiKey,
        baseUrl: generationSettings.apiBaseUrl,
        model: generationSettings.transcriptionModel,
      });
      onTranscript(text);
    } catch (error) {
      onError(error instanceof Error ? error.message : '语音识别失败');
    } finally {
      setTranscribing(false);
      // 归还音频会话：录音会独占输入，不还回去之后的朗读/播放可能没声音
      await setAudioModeAsync({ playsInSilentMode: true, allowsRecording: false });
    }
  }, [recorder, apiKey, generationSettings, onTranscript, onError]);

  const toggle = useCallback(() => {
    if (transcribing) return;
    if (recording) {
      void stop();
      return;
    }
    void start();
  }, [recording, transcribing, start, stop]);

  const busy = disabled || transcribing;

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={recording ? '结束录音并转写' : '语音输入'}
      accessibilityState={{ disabled: busy, busy: transcribing }}
      disabled={busy}
      onPress={toggle}
      hitSlop={8}
      style={({ pressed }) => [
        styles.button,
        busy && styles.disabled,
        pressed && styles.pressed,
      ]}>
      {transcribing ? (
        <ActivityIndicator size="small" color={theme.cta} />
      ) : (
        <MicIcon size={20} color={recording ? theme.cta : theme.textSecondary} />
      )}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  button: { paddingVertical: Spacing.one, paddingRight: Spacing.two },
  disabled: { opacity: 0.4 },
  pressed: { opacity: 0.6 },
});
