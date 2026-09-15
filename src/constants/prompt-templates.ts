/**
 * 提示词模板。
 *
 * 都是「半成品」：末尾留出粘贴位置，点一下填进输入框，用户补上具体内容再发送。
 * 比空态建议胶囊更偏工程场景，两者互补（空态胶囊在完全空对话时出现，模板随时可用）。
 */
export interface PromptTemplate {
  key: string;
  /** 按钮上显示的短标签 */
  label: string;
  /** 一句话说明这条模板适合什么场景 */
  hint: string;
  /** 填进输入框的正文（末尾通常留一个换行，方便接着粘贴） */
  text: string;
}

export const PROMPT_TEMPLATES: readonly PromptTemplate[] = [
  {
    key: 'summarize',
    label: '结构化总结',
    hint: '长文/会议记录 → 结论 + 要点',
    text: '把下面的内容整理成结构化摘要：先给一句结论，再分点列出关键信息，最后列出仍需确认的问题。\n\n',
  },
  {
    key: 'explain-code',
    label: '逐段解释代码',
    hint: '看懂一段陌生代码',
    text: '逐段解释下面的代码：每段先说明它做什么，再指出可能的边界问题或性能隐患。\n\n',
  },
  {
    key: 'polish',
    label: '改写润色',
    hint: '让表达更简洁专业',
    text: '把下面的内容改写得更简洁、专业，保持原意不变，并在末尾简要说明你改了哪些地方。\n\n',
  },
  {
    key: 'translate',
    label: '中英互译',
    hint: '保留术语，附直译对照',
    text: '把下面的内容翻译成地道的英文，保留专业术语，并附一版直译以便对照：\n\n',
  },
  {
    key: 'tests',
    label: '补单元测试',
    hint: '覆盖正常/边界/异常',
    text: '为下面的代码补齐单元测试：覆盖正常路径、边界值与异常分支，并说明每个用例想验证的行为。\n\n',
  },
  {
    key: 'debug',
    label: '排查报错',
    hint: '先给原因排序再给步骤',
    text: '我遇到下面的报错，请先按可能性从高到低列出原因，再给出可以直接执行的排查步骤：\n\n',
  },
];
