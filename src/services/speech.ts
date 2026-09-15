/**
 * 朗读（TTS）。
 *
 * `toSpeechText` 是纯函数（可单测）：朗读器会把 Markdown 记号逐字念出来，
 * 不先洗干净正文，用户就会听到「星号星号」「反引号」这类噪音。
 */
import * as Speech from 'expo-speech';

/** 朗读语言。回答以中文为主，暂不跟随单条消息判断语种 */
const SPEECH_LANGUAGE = 'zh-CN';

/**
 * 把 Markdown 还原成适合朗读的纯文本：
 * - 代码块整体替换为占位词（逐字念代码既没意义又极长）；
 * - 去掉行内代码、标题、引用、列表、分隔线的记号；
 * - 链接只留文字、图片替换为占位词、表格竖线换成空格。
 */
export function toSpeechText(markdown: string): string {
  return markdown
    .replace(/```[\s\S]*?```/g, '（代码块）')
    .replace(/`([^`\n]*)`/g, '$1')
    .replace(/!\[[^\]]*\]\([^)]*\)/g, '（图片）')
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/^\s{0,3}#{1,6}\s+/gm, '')
    .replace(/^\s{0,3}>\s?/gm, '')
    .replace(/^\s{0,3}[-*+]\s+/gm, '')
    .replace(/^\s{0,3}\d+\.\s+/gm, '')
    .replace(/^\s{0,3}([-*_])(\s*\1){2,}\s*$/gm, '')
    .replace(/(\*\*|__)(.*?)\1/g, '$2')
    .replace(/(\*|_)(.*?)\1/g, '$2')
    .replace(/~~(.*?)~~/g, '$1')
    .replace(/\|/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/**
 * 朗读一段文本。
 * 用 onEnd 统一收口：正常播完、被停止、出错都算「这条不用再念了」，
 * 让调用方只维护一个「正在朗读第几条」的状态。
 */
export function speakText(text: string, onEnd?: () => void): void {
  const plain = toSpeechText(text);
  if (plain.length === 0) {
    onEnd?.();
    return;
  }
  Speech.speak(plain, {
    language: SPEECH_LANGUAGE,
    onDone: () => onEnd?.(),
    onStopped: () => onEnd?.(),
    onError: () => onEnd?.(),
  });
}

/** 中断当前朗读并清空队列 */
export async function haltSpeech(): Promise<void> {
  await Speech.stop();
}
