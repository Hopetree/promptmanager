import createDOMPurify from 'dompurify';
import hljs from 'highlight.js/lib/common';
import { JSDOM } from 'jsdom';
import { Marked } from 'marked';

/**
 * Markdown 渲染 + XSS 净化 + 代码高亮（FR-9 / AC-12）。
 * 管线：marked（GFM）→ 自定义 `code` 渲染器用 highlight.js 高亮 → DOMPurify 净化。
 * **净化在渲染之后**：`<script>`、`javascript:`、事件属性都会被 DOMPurify 去掉，
 * 而 highlight.js 生成的 `<span class="hljs-*">` 会保留（库负责转义代码内容，见 docs/dependencies.md §4.9）。
 */
const window = new JSDOM('').window;
const DOMPurify = createDOMPurify(window);

/**
 * 超过这个长度就不再"自动识别语言"：highlightAuto 会遍历内置语言，200k 字符实测约 3 秒
 * （显式指定语言或退回 plaintext 都是毫秒级）。
 */
const MAX_AUTO_DETECT_LENGTH = 20_000;

const marked = new Marked({
  gfm: true,
  renderer: {
    code({ text, lang }) {
      const language = String(lang ?? '')
        .trim()
        .split(/\s+/)[0] ?? '';
      const known = language !== '' && hljs.getLanguage(language) !== undefined;

      let highlighted: string;
      let className: string;
      if (known) {
        highlighted = hljs.highlight(text, { language, ignoreIllegals: true }).value;
        className = `hljs language-${language}`;
      } else if (text.length <= MAX_AUTO_DETECT_LENGTH) {
        highlighted = hljs.highlightAuto(text).value;
        className = 'hljs';
      } else {
        // 仍然交给 highlight.js（plaintext 本身就会转义），不自己拼 HTML 转义
        highlighted = hljs.highlight(text, { language: 'plaintext', ignoreIllegals: true }).value;
        className = 'hljs';
      }

      return `<pre><code class="${className}">${highlighted}</code></pre>\n`;
    },
  },
});

/**
 * 净化配置（BRIEF v4 §5「Markdown 净化硬化」）：DOMPurify 默认允许 `style` 属性与
 * `<style>/<form>/<input>/<button>/<math>/<mtext>/<link>/<meta>/<base>` —— 这些不构成脚本执行，
 * 但会带来 UI 伪装 / CSS 注入面（阶段 5 起会有导入进来的非自写内容，阶段 6 会注入 DOM），因此显式收紧。
 */
const SANITIZE_OPTIONS = {
  FORBID_ATTR: ['style'],
  FORBID_TAGS: ['style', 'form', 'input', 'button', 'math', 'mtext', 'link', 'meta', 'base'],
};

/** Markdown → 净化后的 HTML。 */
export function renderMarkdown(markdown: string): string {
  const raw = marked.parse(markdown, { async: false });
  return DOMPurify.sanitize(String(raw), SANITIZE_OPTIONS);
}
