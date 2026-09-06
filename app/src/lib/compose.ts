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
