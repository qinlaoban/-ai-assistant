import * as Clipboard from 'expo-clipboard';
import * as WebBrowser from 'expo-web-browser';
import { Lexer, type Token, type Tokens } from 'marked';
import { memo, useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { CheckIcon, CopyIcon } from '@/components/icons';
import { BorderRadius, Fonts, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

/**
 * 用 marked 的词法分析结果渲染成 RN 原生组件。
 *
 * 这里刻意不用 WebView：流式回答时每来一个分片都会改写 HTML 源码，
 * WebView 会整篇重新加载文档，几百毫秒一次；且 WebView 里的颜色无法跟随 App 主题。
 * 原生渲染既没有冷启动开销，也能直接把主题 token 传下去。
 */

type Theme = ReturnType<typeof useTheme>;

interface RenderCtx {
  theme: Theme;
  color: string;
}

function openLink(href: string) {
  if (!href) return;
  WebBrowser.openBrowserAsync(href).catch(() => {
    // 打开失败不影响正文渲染
  });
}

/** 复制成功后按钮停留在「已复制」态的时长 */
const COPIED_MS = 1500;

/**
 * 代码块。
 *
 * 做成独立组件而不是在 renderBlocks 里内联：复制反馈需要局部 state，
 * 而 renderBlocks 是一个普通的渲染函数，在里面调 Hook 会破坏 Hooks 规则。
 * 同时它自带 memo，流式期间只有正在改写的那一段会重渲染。
 */
const CodeBlock = memo(function CodeBlock({ code, lang }: { code: string; lang?: string }) {
  const theme = useTheme();
  const [copied, setCopied] = useState(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(
    () => () => {
      if (timerRef.current !== null) clearTimeout(timerRef.current);
    },
    []
  );

  const handleCopy = useCallback(() => {
    Clipboard.setStringAsync(code)
      .then(() => {
        setCopied(true);
        if (timerRef.current !== null) clearTimeout(timerRef.current);
        timerRef.current = setTimeout(() => setCopied(false), COPIED_MS);
      })
      .catch(() => {
        // 复制失败就静默：正文还在，用户仍可长按选中代码
      });
  }, [code]);

  return (
    <View
      style={[
        styles.codeBlock,
        { backgroundColor: theme.codeBackground, borderColor: theme.border },
      ]}>
      <View style={styles.codeHeader}>
        {lang ? (
          <Text style={[styles.codeLang, { color: theme.textTertiary }]}>{lang}</Text>
        ) : (
          <View />
        )}
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="复制代码"
          onPress={handleCopy}
          hitSlop={6}
          style={({ pressed }) => [styles.copyButton, pressed && styles.pressed]}>
          {copied ? (
            <CheckIcon size={14} color={theme.primary} />
          ) : (
            <CopyIcon size={14} color={theme.textTertiary} />
          )}
          <Text style={[styles.copyText, { color: copied ? theme.primary : theme.textTertiary }]}>
            {copied ? '已复制' : '复制'}
          </Text>
        </Pressable>
      </View>
      <Text selectable style={[styles.codeText, { color: theme.codeText }]}>
        {code}
      </Text>
    </View>
  );
});

function renderInline(tokens: Token[] | undefined, ctx: RenderCtx, keyPrefix: string): ReactNode[] {
  if (!tokens || tokens.length === 0) return [];

  const nodes: ReactNode[] = [];
  tokens.forEach((token, index) => {
    const key = `${keyPrefix}-i${index}`;
    switch (token.type) {
      case 'text': {
        const inner = (token as Tokens.Text).tokens;
        nodes.push(
          <Text key={key}>
            {inner && inner.length > 0
              ? renderInline(inner, ctx, key)
              : (token as Tokens.Text).text}
          </Text>
        );
        break;
      }
      case 'escape':
      case 'html':
        nodes.push(<Text key={key}>{(token as Tokens.Text).text}</Text>);
        break;
      case 'strong':
        nodes.push(
          <Text key={key} style={styles.bold}>
            {renderInline((token as Tokens.Strong).tokens, ctx, key)}
          </Text>
        );
        break;
      case 'em':
        nodes.push(
          <Text key={key} style={styles.italic}>
            {renderInline((token as Tokens.Em).tokens, ctx, key)}
          </Text>
        );
        break;
      case 'del':
        nodes.push(
          <Text key={key} style={styles.strike}>
            {renderInline((token as Tokens.Del).tokens, ctx, key)}
          </Text>
        );
        break;
      case 'codespan':
        nodes.push(
          <Text
            key={key}
            style={[
              styles.inlineCode,
              {
                backgroundColor: ctx.theme.codeBackground,
                color: ctx.theme.codeText,
                borderColor: ctx.theme.border,
              },
            ]}>
            {(token as Tokens.Codespan).text}
          </Text>
        );
        break;
      case 'br':
        nodes.push(<Text key={key}>{'\n'}</Text>);
        break;
      case 'link': {
        const link = token as Tokens.Link;
        nodes.push(
          <Text
            key={key}
            style={[styles.link, { color: ctx.theme.link }]}
            onPress={() => openLink(link.href)}>
            {renderInline(link.tokens, ctx, key)}
          </Text>
        );
        break;
      }
      case 'image': {
        // 图片气泡里放不下，降级成可点击的文字链接
        const image = token as Tokens.Image;
        nodes.push(
          <Text
            key={key}
            style={[styles.link, { color: ctx.theme.link }]}
            onPress={() => openLink(image.href)}>
            {`[图片] ${image.text || image.href}`}
          </Text>
        );
        break;
      }
      default:
        break;
    }
  });

  return nodes;
}

function renderBlocks(tokens: Token[] | undefined, ctx: RenderCtx, keyPrefix: string): ReactNode[] {
  if (!tokens || tokens.length === 0) return [];

  const nodes: ReactNode[] = [];
  tokens.forEach((token, index) => {
    const key = `${keyPrefix}-b${index}`;
    switch (token.type) {
      case 'heading': {
        const heading = token as Tokens.Heading;
        const levelStyle =
          heading.depth <= 1 ? styles.h1 : heading.depth === 2 ? styles.h2 : styles.h3;
        nodes.push(
          <Text key={key} style={[styles.blockText, levelStyle, { color: ctx.color }]}>
            {renderInline(heading.tokens, ctx, key)}
          </Text>
        );
        break;
      }
      case 'paragraph':
        // 正文刻意不设 selectable：长按手势要留给消息操作表，native 的文本选择会跟它抢。
        // 需要整条内容时走操作表的「复制」；代码块那边仍保留可选中的能力。
        nodes.push(
          <Text key={key} style={[styles.blockText, styles.paragraph, { color: ctx.color }]}>
            {renderInline((token as Tokens.Paragraph).tokens, ctx, key)}
          </Text>
        );
        break;
      case 'text': {
        // 紧凑列表里 list_item 的内容就是这个带内联 tokens 的 text
        const text = token as Tokens.Text;
        nodes.push(
          <Text key={key} style={[styles.blockText, { color: ctx.color }]}>
            {text.tokens && text.tokens.length > 0
              ? renderInline(text.tokens, ctx, key)
              : text.text}
          </Text>
        );
        break;
      }
      case 'code': {
        const code = token as Tokens.Code;
        nodes.push(<CodeBlock key={key} code={code.text} lang={code.lang} />);
        break;
      }
      case 'blockquote':
        nodes.push(
          <View
            key={key}
            style={[
              styles.quote,
              {
                backgroundColor: ctx.theme.quoteBackground,
                borderLeftColor: ctx.theme.quoteBorder,
              },
            ]}>
            {renderBlocks((token as Tokens.Blockquote).tokens, ctx, key)}
          </View>
        );
        break;
      case 'list': {
        const list = token as Tokens.List;
        const start = typeof list.start === 'number' ? list.start : Number(list.start) || 1;
        nodes.push(
          <View key={key} style={styles.list}>
            {list.items.map((item, itemIndex) => {
              // 任务列表的勾选框以 checkbox token 放在 item.tokens 首位，
              // 必须把它提到 marker 位置，否则「已完成 / 未完成」的区分会整个丢掉
              const checkbox = item.tokens.find((child) => child.type === 'checkbox') as
                | Tokens.Checkbox
                | undefined;
              const marker = checkbox
                ? checkbox.checked
                  ? '☑'
                  : '☐'
                : list.ordered
                  ? `${start + itemIndex}.`
                  : '•';
              return (
                <View key={`${key}-${itemIndex}`} style={styles.listItem}>
                  <Text style={[styles.listMarker, { color: ctx.theme.textSecondary }]}>
                    {marker}
                  </Text>
                  <View style={styles.listItemBody}>
                    {renderBlocks(item.tokens, ctx, `${key}-${itemIndex}`)}
                  </View>
                </View>
              );
            })}
          </View>
        );
        break;
      }
      case 'table': {
        const table = token as Tokens.Table;
        const columns = Math.max(table.header.length, 1);
        nodes.push(
          <View
            key={key}
            style={[
              styles.table,
              { borderColor: ctx.theme.border, backgroundColor: ctx.theme.backgroundElement },
            ]}>
            <View
              style={[
                styles.tableRow,
                styles.tableHeaderRow,
                { borderBottomColor: ctx.theme.borderStrong },
              ]}>
              {table.header.map((cell, cellIndex) => (
                <View
                  key={`${key}-h${cellIndex}`}
                  style={[
                    styles.tableCell,
                    { borderRightColor: ctx.theme.border },
                    cellIndex === columns - 1 && styles.tableCellLast,
                  ]}>
                  <Text style={[styles.tableCellText, styles.bold, { color: ctx.color }]}>
                    {renderInline(cell.tokens, ctx, `${key}-h${cellIndex}`)}
                  </Text>
                </View>
              ))}
            </View>
            {table.rows.map((row, rowIndex) => (
              <View
                key={`${key}-r${rowIndex}`}
                style={[styles.tableRow, { borderBottomColor: ctx.theme.border }]}>
                {row.map((cell, cellIndex) => (
                  <View
                    key={`${key}-r${rowIndex}c${cellIndex}`}
                    style={[
                      styles.tableCell,
                      { borderRightColor: ctx.theme.border },
                      cellIndex === columns - 1 && styles.tableCellLast,
                    ]}>
                    <Text style={[styles.tableCellText, { color: ctx.color }]}>
                      {renderInline(cell.tokens, ctx, `${key}-r${rowIndex}c${cellIndex}`)}
                    </Text>
                  </View>
                ))}
              </View>
            ))}
          </View>
        );
        break;
      }
      case 'hr':
        nodes.push(<View key={key} style={[styles.hr, { backgroundColor: ctx.theme.border }]} />);
        break;
      case 'html':
        nodes.push(
          <Text key={key} style={[styles.blockText, { color: ctx.theme.textSecondary }]}>
            {(token as Tokens.HTML).text}
          </Text>
        );
        break;
      case 'space':
        break;
      case 'checkbox':
        // 已在 list 的 marker 里体现，这里不重复渲染
        break;
      case 'def':
        // 链接/脚注引用定义，本身不是正文内容
        break;
      default:
        break;
    }
  });

  return nodes;
}

interface MarkdownProps {
  text: string;
  /** 正文颜色，默认取主题正文色；放在气泡里时应传入气泡的文字色 */
  color?: string;
}

export const Markdown = memo(function Markdown({ text, color }: MarkdownProps) {
  const theme = useTheme();

  const tokens = useMemo(() => {
    try {
      return Lexer.lex(text ?? '');
    } catch {
      return null; // 畸形输入降级成纯文本，不要白屏
    }
  }, [text]);

  const ctx: RenderCtx = { theme, color: color ?? theme.text };

  if (!tokens) {
    return (
      <Text style={[styles.blockText, { color: ctx.color }]}>
        {text}
      </Text>
    );
  }

  return <View>{renderBlocks(tokens, ctx, 'md')}</View>;
});

const styles = StyleSheet.create({
  blockText: { fontSize: 15, lineHeight: 23 },
  paragraph: { marginBottom: Spacing.two },
  bold: { fontWeight: '700' },
  italic: { fontStyle: 'italic' },
  strike: { textDecorationLine: 'line-through' },
  link: { textDecorationLine: 'underline' },
  inlineCode: {
    fontFamily: Fonts.mono,
    fontSize: 13,
    paddingHorizontal: Spacing.half,
    borderRadius: 4,
    borderWidth: StyleSheet.hairlineWidth,
  },
  h1: { fontSize: 21, lineHeight: 29, fontWeight: '700', marginBottom: Spacing.two },
  h2: { fontSize: 18, lineHeight: 26, fontWeight: '700', marginBottom: Spacing.two },
  h3: { fontSize: 16, lineHeight: 24, fontWeight: '600', marginBottom: Spacing.one },
  codeBlock: {
    borderRadius: BorderRadius.medium,
    borderWidth: StyleSheet.hairlineWidth,
    padding: Spacing.three,
    marginBottom: Spacing.two,
    gap: Spacing.one,
  },
  codeHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    minHeight: 20,
  },
  // 幽灵态图标按钮：常态只留弱色，按下降透明度
  copyButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.half,
    paddingHorizontal: Spacing.one,
    paddingVertical: 2,
    borderRadius: BorderRadius.small,
  },
  copyText: { fontSize: 11, fontWeight: '600' },
  codeLang: { fontSize: 11, fontWeight: '600', letterSpacing: 0.5, textTransform: 'uppercase' },
  codeText: { fontFamily: Fonts.mono, fontSize: 13, lineHeight: 20 },
  pressed: { opacity: 0.6 },
  quote: {
    borderLeftWidth: 3,
    paddingLeft: Spacing.three,
    paddingVertical: Spacing.one,
    borderRadius: BorderRadius.small,
    marginBottom: Spacing.two,
  },
  list: { marginBottom: Spacing.two, gap: Spacing.one },
  listItem: { flexDirection: 'row', gap: Spacing.two },
  listMarker: { fontSize: 15, lineHeight: 23, minWidth: 18, textAlign: 'right' },
  listItemBody: { flex: 1 },
  table: {
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: BorderRadius.small,
    marginBottom: Spacing.two,
    overflow: 'hidden',
  },
  tableRow: { flexDirection: 'row', borderBottomWidth: StyleSheet.hairlineWidth },
  tableHeaderRow: { borderBottomWidth: 1 },
  tableCell: {
    flex: 1,
    paddingHorizontal: Spacing.two,
    paddingVertical: Spacing.one,
    borderRightWidth: StyleSheet.hairlineWidth,
  },
  tableCellLast: { borderRightWidth: 0 },
  tableCellText: { fontSize: 13, lineHeight: 20 },
  hr: { height: StyleSheet.hairlineWidth, marginVertical: Spacing.three },
});
