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

const escapeHtml = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/**
 * Only ever produce a link the browser will treat as navigation.
 *
 * `javascript:` in an href is script execution dressed as a link, and this renderer
 * now sees text the model wrote, not just text we wrote. Anything that isn't plainly
 * http(s) or mailto becomes an inert anchor.
 */
function safeHref(href: string): string {
  const trimmed = href.trim();
  return /^(https?:|mailto:|#|\/)/i.test(trimmed) ? escapeHtml(trimmed) : '#';
}

marked.use({
  renderer: {
    /**
     * Raw HTML is escaped rather than emitted — for every source, deliberately.
     *
     * The mentor's replies come down this same pipe, and a model that echoes back an
     * `<img onerror=…>` it read somewhere would be running script in a page whose
     * IndexedDB holds a GitHub token and an Anthropic key. Having one path that is
     * always safe beats a `trusted` flag that is right until the day someone forgets
     * to pass it. Lessons lose the ability to embed HTML; they have never used it.
     */
    html({ text }) {
      return escapeHtml(text);
    },
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
    // Markdown image syntax can't carry an event handler, but it can carry a
    // `javascript:` src, so it goes through the same href filter.
    image({ href, title, text }) {
      const t = title ? ` title="${escapeHtml(title)}"` : '';
      return `<img src="${safeHref(href)}" alt="${escapeHtml(text)}"${t}>`;
    },
    // Everything opens in a new tab; a phone app losing its place is infuriating.
    link({ href, title, tokens }) {
      const t = title ? ` title="${escapeHtml(title)}"` : '';
      return `<a href="${safeHref(href)}"${t} target="_blank" rel="noopener noreferrer">${this.parser.parseInline(tokens)}</a>`;
    },
  },
});

export function render(md: string | null | undefined): string {
  if (!md) return '';
  return marked.parse(md, { async: false }) as string;
}
