import { Marked } from 'marked';
import hljs from 'highlight.js/lib/core';
import cpp from 'highlight.js/lib/languages/cpp';
import bash from 'highlight.js/lib/languages/bash';
import plaintext from 'highlight.js/lib/languages/plaintext';

// Only the languages this curriculum actually uses. Registering all of
// highlight.js would be ~900KB for the sake of showing off.
hljs.registerLanguage('cpp', cpp);
hljs.registerLanguage('c', cpp);
hljs.registerLanguage('bash', bash);
hljs.registerLanguage('sh', bash);
hljs.registerLanguage('plaintext', plaintext);

const marked = new Marked({ gfm: true, breaks: false });

marked.use({
  renderer: {
    code({ text, lang }) {
      const language = hljs.getLanguage(lang ?? '') ? (lang as string) : 'cpp';
      const html = hljs.highlight(text, { language, ignoreIllegals: true }).value;
      return `<pre class="code"><code class="hljs language-${language}">${html}</code></pre>`;
    },
    // Blockquotes become tinted asides — that's where the trivia and war stories live.
    blockquote({ tokens }) {
      const inner = this.parser.parse(tokens);
      const m = /^<p>\s*\[!(\w+)\]\s*/i.exec(inner);
      if (!m) return `<blockquote class="aside">${inner}</blockquote>`;
      const kind = m[1].toLowerCase();
      return `<blockquote class="aside aside-${kind}">${inner.replace(m[0], '<p>')}</blockquote>`;
    },
    // Everything opens in a new tab; a phone app losing its place is infuriating.
    link({ href, title, tokens }) {
      const t = title ? ` title="${title}"` : '';
      return `<a href="${href}"${t} target="_blank" rel="noopener noreferrer">${this.parser.parseInline(tokens)}</a>`;
    },
  },
});

export function render(md: string | null | undefined): string {
  if (!md) return '';
  return marked.parse(md, { async: false }) as string;
}
