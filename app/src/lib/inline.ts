/**
 * The light inline markdown that quiz, drill and checklist text is written in: `code`,
 * **bold** and *emphasis*, nothing else.
 *
 * These strings are short, live inside buttons and headings, and are not worth a full
 * markdown pass — but shown raw, every `count(*)` in a question arrives wrapped in
 * literal backticks. Everything is escaped first, so `a < b` stays text, and the inside
 * of a code span is never read for emphasis, so the asterisk in `count(*)` stays an
 * asterisk.
 */
const ESC: Record<string, string> = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ESC[c]);

export function inlineHtml(text: string): string {
  return text
    .split(/(`[^`]+`)/g)
    .map((part) =>
      part.length > 2 && part.startsWith('`') && part.endsWith('`')
        ? `<code>${esc(part.slice(1, -1))}</code>`
        : esc(part)
            .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
            .replace(/(^|[\s(])\*([^*\s][^*]*?)\*(?=$|[\s.,;:!?)])/g, '$1<em>$2</em>'),
    )
    .join('');
}
