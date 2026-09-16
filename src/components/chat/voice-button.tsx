import {
  AudioModule,
  RecordingPresets,
  setAudioModeAsync,
  useAudioRecorder,
  useAudioRecorderState,
} from 'expo-audio';
import { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet } from 'react-native';

import { MicIcon } from '@/components/icons';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { transcribeAudio } from '@/services/transcription';
import { useChat } from '@/store/chat-store';

export type VoiceStatus = 'idle' | 'recording' | 'transcribing';

/** 录音期间占用的音频模式；用完必须还回去，否则之后的朗读/播放可能没声音 */
const RECORDING_MODE = { playsInSilentMode: true, allowsRecording: true } as const;
const IDLE_MODE = { playsInSilentMode: true, allowsRecording: false } as const;

/**
 * 语音输入按钮。
 *
 * 录音用 expo-audio，转写走服务商的 `/audio/transcriptions` —— 复用用户已配好的
 * 接口地址与 Key，不额外引入原生语音识别模块（那类模块还需要自定义开发版构建）。
 *
 * 三件容易漏、但必须做的事：
 * - 异常一律转成 onError，绝不静默吞（吞掉的后果是 UI 卡在「录音中」且音频会话不还）
 * - 卸载时强制停止录音并归还音频会话
 * - 流式期间禁止「开始」录音，但必须允许「结束」正在进行的录音，否则录音会被卡死
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
  /** 权限被拒 / 录音或转写失败等，由父级统一呈现 */
  onError: (message: string) => void;
  onStatusChange?: (status: VoiceStatus) => void;
}) {
  const theme = useTheme();
  const { apiKey, generationSettings } = useChat();
  const recorder = useAudioRecorder(RecordingPresets.HIGH_QUALITY);
  const recorderState = useAudioRecorderState(recorder);
  const [transcribing, setTranscribing] = useState(false);
  /**
   * recorderState 是轮询更新的（默认 500ms），点下开始后它不会立刻变成 true。
   * 没有这个闸门，快速点两下会重复 prepare/record。
   */
  const startingRef = useRef(false);

  const recording = recorderState.isRecording;

  // 状态同步给父级，由它决定提示文案
  useEffect(() => {
    onStatusChange?.(transcribing ? 'transcribing' : recording ? 'recording' : 'idle');
  }, [recording, transcribing, onStatusChange]);

  // 卸载收口：录音是设备能力，不主动停止会一直录下去，音频会话也会留在录音态
  useEffect(
    () => () => {
      void (async () => {
        try {
          if (recorder.isRecording) await recorder.stop();
          await setAudioModeAsync(IDLE_MODE);
        } catch {
          // 卸载阶段已经没有 UI 可以反馈了，只能静默
        }
      })();
    },
    [recorder]
  );

  const start = useCallback(async () => {
    if (startingRef.current) return;
    startingRef.current = true;
    try {
      const permission = await AudioModule.requestRecordingPermissionsAsync();
      if (!permission.granted) {
        onError('没有麦克风权限，请在系统设置里允许后重试');
        return;
      }
      // iOS 静音开关下也必须能录到声音
      await setAudioModeAsync(RECORDING_MODE);
      await recorder.prepareToRecordAsync();
      recorder.record();
    } catch (err) {
      onError(err instanceof Error ? err.message : '录音启动失败');
      // 启动失败也要把音频会话还回去，否则后续 TTS 会没声音
      await setAudioModeAsync(IDLE_MODE).catch(() => undefined);
    } finally {
      startingRef.current = false;
    }
  }, [recorder, onError]);

  const stop = useCallback(async () => {
    setTranscribing(true);
    try {
      await recorder.stop();
      // uri 只有 stop 之后才拿得到
      const uri = recorder.uri;
      if (!uri) throw new Error('录音失败：没有拿到音频文件');
      const text = await transcribeAudio(uri, {
        apiKey,
        baseUrl: generationSettings.apiBaseUrl,
        model: generationSettings.transcriptionModel,
      });
      onTranscript(text);
    } catch (err) {
      onError(err instanceof Error ? err.message : '语音识别失败');
    } finally {
      setTranscribing(false);
      await setAudioModeAsync(IDLE_MODE).catch(() => undefined);
    }
  }, [recorder, apiKey, generationSettings, onTranscript, onError]);

  const toggle = useCallback(() => {
    if (transcribing) return;
    // 结束录音永远优先：哪怕此刻已经在流式输出，也不能把录音卡在半路
    if (recording) {
      void stop();
      return;
    }
    if (disabled) return;
    void start();
  }, [recording, transcribing, disabled, start, stop]);

  const pressDisabled = transcribing || (disabled && !recording);

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={recording ? '结束录音并转写' : '语音输入'}
      accessibilityState={{ disabled: pressDisabled, busy: transcribing }}
      disabled={pressDisabled}
      onPress={toggle}
      hitSlop={8}
      style={({ pressed }) => [
        styles.button,
        pressDisabled && styles.disabled,
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
