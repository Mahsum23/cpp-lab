/**
 * Composer helpers for a chat you paste code into.
 *
 * A phone keyboard is actively hostile to source: it capitalises `int`, "corrects"
 * `->` into an em dash, and offers to complete identifiers. The markup fixes that with
 * attributes; this file handles the parts that need logic — deciding when a paste is
 * code, fencing it so both the model and the renderer treat it as C++, and making Tab
 * indent rather than leave the field.
 *
 * Kept out of the components because there are two composers (the Mentor tab and the
 * in-lesson sheet) and because logic that only exists inside a .svelte file is logic
 * nothing can unit-test.
 */

/** Indent inserted by Tab. Four spaces, matching the code in the lessons. */
export const INDENT = '    ';

const FENCE = /^\s*```/;

/**
 * Does this look like source rather than a sentence?
 *
 * Used to flip the composer into code mode on paste, so pasting a function doesn't
 * silently arrive as a paragraph. Deliberately conservative: a single line is never
 * treated as code, because "why does recv() return 0?" is a question, not a program.
 */
export function looksLikeCode(text: string): boolean {
  const lines = text.split('\n');
  if (lines.length < 2) return false;

  // Two or more lines ending in a statement terminator or a brace is already decisive,
  // and it's the common shape that the softer signals below miss: flush-left C++ with
  // no includes, no keywords and no indentation, e.g. a struct being filled in field
  // by field.
  if (lines.filter((l) => /[;{}]\s*$/.test(l)).length >= 2) return true;

  const signals = [
    /^\s*#\s*include\b/m, // preprocessor
    /^\s*(?:int|void|bool|char|auto|const|struct|class|template|std::)\b/m,
    /[;{}]\s*$/m, // statement or block punctuation ending a line
    /\b(?:if|for|while|return|sizeof)\s*\(/,
    /->|::|<<|>>/, // arrows, scope, streams
  ];
  const hits = signals.filter((re) => re.test(text)).length;

  // Indented continuation lines are themselves weak evidence: prose wraps flush left.
  const indented = lines.filter((l) => /^\s{2,}\S/.test(l)).length;
  return hits >= 2 || (hits >= 1 && indented >= 1);
}

/**
 * Wrap text in a fenced block so it survives the round trip as code.
 *
 * Both ends need this. The model reads the fence and stops guessing whether it was
 * handed prose, and the renderer highlights it instead of reflowing it into a
 * paragraph with the indentation collapsed.
 */
export function asCodeBlock(text: string, lang = 'cpp'): string {
  const body = text.replace(/\s+$/, '');
  if (!body) return '';
  // Already fenced by hand — don't nest fences inside fences.
  if (FENCE.test(body)) return body;
  // A body containing a fence run needs a longer one to stay balanced.
  const longest = Math.max(0, ...[...body.matchAll(/^\s*(`{3,})/gm)].map((m) => m[1].length));
  const fence = '`'.repeat(Math.max(3, longest + 1));
  return `${fence}${lang}\n${body}\n${fence}`;
}

/** True if the text already carries a fenced block, so re-fencing would be wrong. */
export const isFenced = (text: string): boolean => FENCE.test(text.trim());

/**
 * Does a fence appear *anywhere*, not just at the start?
 *
 * The send path needs this rather than isFenced: a mixed message ("here's my code:"
 * followed by a block) doesn't start with a fence, and wrapping the whole thing again
 * would nest one fence inside another and render as garbage.
 */
export const hasFence = (text: string): boolean => /^\s*```/m.test(text);

/**
 * How a sent message should be rendered in the transcript.
 *
 * `code` is a message that is nothing but a block, and looks best without a bubble
 * around it at all. `mixed` is the common case this composer exists to make easy —
 * a question with the source quoted inside it — which still wants a bubble, just a
 * quieter one that a code block can sit in.
 */
export const shapeOf = (text: string): 'text' | 'code' | 'mixed' =>
  isFenced(text) ? 'code' : hasFence(text) ? 'mixed' : 'text';

/**
 * Insert a fenced block at the cursor, or wrap whatever is selected.
 *
 * This is what stops a mixed message from requiring hand-typed markdown: write the
 * prose, hit the button, and the code lands in a block. Returns where the cursor
 * should end up — inside the empty block when there was nothing selected, since that
 * is where the next keystroke or paste belongs.
 */
export function wrapSelection(
  value: string,
  start: number,
  end: number,
  lang = 'cpp',
): { value: string; start: number; end: number } {
  const selected = value.slice(start, end);
  // Fences only work at the start of a line, so make sure one precedes them.
  const before = value.slice(0, start);
  const after = value.slice(end);
  const lead = before && !before.endsWith('\n') ? '\n' : '';
  const tail = after && !after.startsWith('\n') ? '\n' : '';

  if (selected.trim()) {
    const block = `${lead}\`\`\`${lang}\n${selected.replace(/\s+$/, '')}\n\`\`\`${tail}`;
    const at = start + block.length - tail.length;
    return { value: before + block + after, start: at, end: at };
  }

  const block = `${lead}\`\`\`${lang}\n\n\`\`\`${tail}`;
  // Land on the blank line between the fences.
  const at = start + lead.length + lang.length + 4;
  return { value: before + block + after, start: at, end: at };
}

/**
 * Tab inside a textarea, as an editor would do it rather than as a browser does.
 *
 * Returns the new value and where the cursor should land. With a selection spanning
 * lines this indents every line in it, which is the behaviour that makes pasted code
 * fixable in place.
 */
export function indentAt(
  value: string,
  start: number,
  end: number,
): { value: string; start: number; end: number } {
  const selection = value.slice(start, end);

  if (selection.includes('\n')) {
    const from = value.lastIndexOf('\n', start - 1) + 1;
    const block = value.slice(from, end);
    const shifted = block.replace(/^/gm, INDENT);
    return {
      value: value.slice(0, from) + shifted + value.slice(end),
      start: start + INDENT.length,
      end: end + (shifted.length - block.length),
    };
  }

  const next = value.slice(0, start) + INDENT + value.slice(end);
  const cursor = start + INDENT.length;
  return { value: next, start: cursor, end: cursor };
}

/**
 * Is the cursor inside a fenced block?
 *
 * Autoindent and Tab are wanted while writing the code half of a mixed message, not
 * just when the whole field is in code mode. Fences alternate, so an odd number of
 * them before the cursor means it sits inside one.
 */
export function inFence(value: string, pos: number): boolean {
  const opens = value.slice(0, pos).match(/^\s*```/gm);
  return (opens?.length ?? 0) % 2 === 1;
}

/**
 * Enter, as an editor does it: carry the current line's indentation onto the next one.
 *
 * A line ending in an opener earns a further level, and if the closer is sitting right
 * after the cursor it gets a line of its own at the outer level — the `{`-Enter that
 * lands you in an empty body with the `}` already below you. Without this, code typed
 * on a phone comes out flush left, which is the exact thing code mode was for.
 */
export function newlineAt(
  value: string,
  start: number,
  end: number,
): { value: string; start: number; end: number } {
  const lineStart = value.lastIndexOf('\n', start - 1) + 1;
  const line = value.slice(lineStart, start);
  const indent = /^[ \t]*/.exec(line)?.[0] ?? '';
  // Don't indent past a closing fence: the line after it is prose again.
  const opens = /[{([]\s*$/.test(line);
  const inner = opens ? indent + INDENT : indent;
  const closerAhead = opens && /^[ \t]*[})\]]/.test(value.slice(end));

  const insert = closerAhead ? `\n${inner}\n${indent}` : `\n${inner}`;
  const at = start + 1 + inner.length;
  return { value: value.slice(0, start) + insert + value.slice(end), start: at, end: at };
}

/**
 * Typing `}` on a line that is nothing but indentation pulls it back one level.
 *
 * The counterpart to the rule above: without it, every block you close ends up one
 * step too deep and has to be un-indented by hand. Returns null when the keystroke is
 * an ordinary one the browser should handle itself.
 */
export function closerAt(
  value: string,
  start: number,
  end: number,
  ch: string,
): { value: string; start: number; end: number } | null {
  // Only a closer dedents. Without this the rule fires on every key typed at the start
  // of an indented line, which quietly eats the indentation you just earned.
  if (!'})]'.includes(ch) || start !== end) return null;
  const lineStart = value.lastIndexOf('\n', start - 1) + 1;
  const line = value.slice(lineStart, start);
  if (!/^[ \t]+$/.test(line) || !line.endsWith(INDENT)) return null;
  const pulled = line.slice(0, -INDENT.length);
  const at = lineStart + pulled.length + 1;
  return { value: value.slice(0, lineStart) + pulled + ch + value.slice(end), start: at, end: at };
}

/**
 * The pairs the composer closes for you. Quotes are in here too: they open and close
 * with the same character, which is what makes the type-over rule below matter.
 */
const PAIRS: Record<string, string> = { '{': '}', '(': ')', '[': ']', '"': '"', "'": "'" };
const CLOSERS = new Set(Object.values(PAIRS));

/** A character an auto-inserted quote would land in the middle of. */
const WORDY = /[\w)\]}]/;

/**
 * Autoclose, type-over, and wrap-the-selection — the three things one bracket key does.
 *
 * Returns null for the keystrokes the browser should handle itself, which is most of
 * them. The deliberate omissions: a pair is not inserted directly before a word, so
 * typing `(` in front of `fd` doesn't produce `()fd`, and a quote after a word is an
 * apostrophe or a closing quote rather than the start of a new pair.
 */
export function autoCloseAt(
  value: string,
  start: number,
  end: number,
  ch: string,
): { value: string; start: number; end: number } | null {
  const close = PAIRS[ch];
  const selected = value.slice(start, end);

  // Wrapping a selection is never ambiguous, so it happens for quotes too.
  if (close && selected) {
    return {
      value: value.slice(0, start) + ch + selected + close + value.slice(end),
      start: start + 1,
      end: end + 1,
    };
  }
  if (start !== end) return null;

  // Typing the closer that is already sitting under the cursor steps over it instead
  // of stacking a second one — the half of autoclose people notice when it's missing.
  if (CLOSERS.has(ch) && value[start] === ch) return { value, start: start + 1, end: start + 1 };
  if (!close) return null;

  const prev = value[start - 1] ?? '';
  const next = value[start] ?? '';
  if ((ch === '"' || ch === "'") && WORDY.test(prev)) return null;
  if (/\w/.test(next)) return null;

  return {
    value: value.slice(0, start) + ch + close + value.slice(end),
    start: start + 1,
    end: start + 1,
  };
}

/**
 * Backspace between an empty pair takes both halves.
 *
 * Without it, autoclose is a net loss: every `(` you change your mind about leaves a
 * `)` behind for you to hunt down.
 */
export function unpairAt(
  value: string,
  start: number,
  end: number,
): { value: string; start: number; end: number } | null {
  if (start !== end || start === 0) return null;
  if (PAIRS[value[start - 1]] !== value[start]) return null;
  return { value: value.slice(0, start - 1) + value.slice(start + 1), start: start - 1, end: start - 1 };
}

/**
 * The body ranges of the fenced blocks in a draft.
 *
 * The composer highlights these and leaves the prose around them alone, so a mixed
 * message looks the way it will read once it's sent. An unterminated block runs to the
 * end of the text, because that's the one you're in the middle of typing.
 */
export function codeSpans(text: string): { from: number; to: number; lang: string }[] {
  const spans: { from: number; to: number; lang: string }[] = [];
  let open: { at: number; lang: string } | null = null;
  let pos = 0;
  for (const line of text.split('\n')) {
    const m = /^\s*```(\w*)/.exec(line);
    if (m) {
      if (open) {
        spans.push({ from: open.at, to: pos, lang: open.lang });
        open = null;
      } else {
        open = { at: pos + line.length + 1, lang: m[1] || 'cpp' };
      }
    }
    pos += line.length + 1;
  }
  if (open && open.at <= text.length) spans.push({ from: open.at, to: text.length, lang: open.lang });
  return spans;
}
