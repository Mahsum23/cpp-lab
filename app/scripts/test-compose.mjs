/**
 * test-compose.mjs — the composer's code handling.
 *
 * All of this is the kind of logic that looks obviously right and then mangles
 * somebody's pasted function: fences nested inside fences, a Tab that indents the
 * wrong line, a question misread as source. Cheap to test, so test it.
 *
 * Run: npm test
 */
import { build } from 'esbuild';
import { writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const out = await build({
  entryPoints: [new URL('../src/lib/compose.ts', import.meta.url).pathname],
  bundle: true, format: 'esm', write: false,
});
const file = join(tmpdir(), 'cpp-lab-compose.mjs');
writeFileSync(file, out.outputFiles[0].text);
const { looksLikeCode, asCodeBlock, isFenced, hasFence, shapeOf, wrapSelection, indentAt,
        inFence, newlineAt, closerAt, autoCloseAt, unpairAt, codeSpans, INDENT } = await import(file);

let fails = 0;
const ok = (label, cond, extra = '') => {
  if (!cond) { fails++; console.log(`  FAIL  ${label}${extra ? `  << ${extra}` : ''}`); }
  else console.log(`  PASS  ${label}`);
};

console.log('\n— is this code? —');
// A question is not code, however many parentheses it has.
ok('a one-line question is not code', !looksLikeCode('why does recv() return 0?'));
ok('a multi-line question is not code', !looksLikeCode('why does recv() return 0?\nis it an error?'));
ok('a prose paragraph is not code', !looksLikeCode('I tried the task today and the server\nkept refusing connections for some reason'));

ok('an include plus a body is code', looksLikeCode('#include <sys/socket.h>\nint main() { return 0; }'));
ok('an indented function body is code', looksLikeCode('int main() {\n    int fd = socket(AF_INET, SOCK_STREAM, 0);\n    return 0;\n}'));
ok('a struct fill is code', looksLikeCode('sockaddr_in addr{};\naddr.sin_port = htons(9000);'));

console.log('\n— fencing —');
ok('plain code gets a cpp fence', asCodeBlock('int x = 1;') === '```cpp\nint x = 1;\n```');
ok('already-fenced text is left alone', asCodeBlock('```cpp\nint x = 1;\n```') === '```cpp\nint x = 1;\n```');
ok('isFenced spots a fence', isFenced('```cpp\nint x;\n```'));
ok('isFenced ignores plain text', !isFenced('int x;'));
// A body that itself contains a fence would otherwise terminate the block early.
const nested = asCodeBlock('before\n```\ninner\n```\nafter');
ok('a body containing a fence gets a longer one', nested.startsWith('````cpp\n') && nested.endsWith('\n````'), nested);
ok('trailing blank lines are trimmed', asCodeBlock('int x = 1;\n\n\n') === '```cpp\nint x = 1;\n```');
ok('empty input stays empty', asCodeBlock('   ') === '');
ok('the language is settable', asCodeBlock('ss -ltn', 'bash') === '```bash\nss -ltn\n```');

console.log('\n— tab indents, rather than leaving the field —');
let r = indentAt('int x;', 0, 0);
ok('tab at the start inserts an indent', r.value === `${INDENT}int x;`, r.value);
ok('the cursor moves past the indent', r.start === INDENT.length && r.end === INDENT.length);

r = indentAt('ab', 1, 1);
ok('tab mid-line inserts at the cursor', r.value === `a${INDENT}b`, r.value);

// A selection spanning lines should indent every line it touches, including the
// first, whose start is behind the selection anchor.
r = indentAt('one\ntwo\nthree', 0, 7);
ok('a multi-line selection indents every line', r.value === `${INDENT}one\n${INDENT}two\nthree`, JSON.stringify(r.value));

r = indentAt('one\ntwo', 1, 5);
ok('a selection starting mid-line still indents from the line start', r.value === `${INDENT}one\n${INDENT}two`, JSON.stringify(r.value));

r = indentAt('sel', 0, 3);
ok('a single-line selection is replaced, editor-style', r.value === INDENT, JSON.stringify(r.value));

console.log('\n— mixed messages: fence without typing markdown —');
// The send path must not re-wrap a message that already contains a block, or the
// fences nest and the whole thing renders as garbage.
ok('hasFence sees a fence mid-message', hasFence("here's my code:\n```cpp\nint x;\n```"));
ok('hasFence is false for plain prose', !hasFence('why does recv() return 0?'));
ok('isFenced alone would miss it', !isFenced("here's my code:\n```cpp\nint x;\n```"));

// Wrapping a selection is the whole point: prose stays prose, code gets a block.
let w = wrapSelection('int x = 1;', 0, 10);
ok('a selection becomes a fenced block', w.value === '```cpp\nint x = 1;\n```', JSON.stringify(w.value));

w = wrapSelection('look:\nint x = 1;', 6, 16);
ok('a mid-message selection is fenced in place', w.value === 'look:\n```cpp\nint x = 1;\n```', JSON.stringify(w.value));
ok('prose before the block is untouched', w.value.startsWith('look:\n'));

// A fence has to start its own line, so one is inserted when the cursor is mid-line.
w = wrapSelection('look: int x;', 6, 12);
ok('a newline is inserted so the fence starts a line', w.value === 'look: \n```cpp\nint x;\n```', JSON.stringify(w.value));

// Empty selection: drop in a block and land inside it, ready to paste.
w = wrapSelection('', 0, 0);
ok('an empty selection inserts an empty block', w.value === '```cpp\n\n```', JSON.stringify(w.value));
ok('the cursor lands inside the empty block', w.value.slice(0, w.start) === '```cpp\n', JSON.stringify(w.value.slice(0, w.start)));

w = wrapSelection('question?', 9, 9);
ok('inserting after prose adds a leading newline', w.value === 'question?\n```cpp\n\n```', JSON.stringify(w.value));

// The transcript renders each of these differently; getting the mixed case wrong is
// how a question ends up as an unreadable wall inside an accent-coloured bubble.
ok('plain text is text', shapeOf('why does recv() return 0?') === 'text');
ok('a bare block is code', shapeOf('```cpp\nint x;\n```') === 'code');
ok('prose plus a block is mixed', shapeOf("look:\n```cpp\nint x;\n```") === 'mixed');
ok('a block with a trailing question is still code', shapeOf('```cpp\nint x;\n```\nwhy?') === 'code');

console.log('\n— autoindent —');
// Inside a mixed message the code half still wants editor behaviour, so the cursor's
// position relative to the fences decides, not just the whole-message toggle.
ok('the cursor after an opening fence is inside it', inFence('a:\n```cpp\nint x;', 12));
ok('the cursor before any fence is outside', !inFence('a:\n```cpp\nint x;', 2));
ok('the cursor after a closed block is outside', inFence('```cpp\nx;\n```\nwhy?', 18) === false);

let n = newlineAt('    int x = 1;', 14, 14);
ok('enter carries the indentation down', n.value === '    int x = 1;\n    ', JSON.stringify(n.value));
ok('the cursor lands after the new indent', n.start === n.value.length);

n = newlineAt('int main() {', 12, 12);
ok('a line ending in a brace earns a level', n.value === 'int main() {\n    ', JSON.stringify(n.value));

n = newlineAt('    if (n) {', 12, 12);
ok('the extra level is relative, not absolute', n.value === '    if (n) {\n        ', JSON.stringify(n.value));

// The `{`-Enter that leaves you in an empty body with the closer already below.
n = newlineAt('int main() {}', 12, 12);
ok('a closer ahead gets its own line', n.value === 'int main() {\n    \n}', JSON.stringify(n.value));
ok('the cursor stays in the empty body', n.start === 17, String(n.start));

n = newlineAt('why does this fail?', 19, 19);
ok('unindented prose stays unindented', n.value === 'why does this fail?\n', JSON.stringify(n.value));

let c = closerAt('int main() {\n    \n', 17, 17, '}');
ok('a closer on a blank line pulls back a level', c && c.value === 'int main() {\n}\n', JSON.stringify(c?.value));
ok('the cursor follows the closer', c && c.start === 14, String(c?.start));

ok('a closer after code is left to the browser', closerAt('int x = f(a);', 13, 13, '}') === null);
ok('a closer at column zero has nothing to pull', closerAt('x;\n', 3, 3, '}') === null);
ok('a closer inside a selection is left alone', closerAt('        ', 4, 8, '}') === null);
// Every key is offered to this rule, so it has to recognise the ones that aren't
// closers: an ordinary letter at the start of an indented line must keep its indent.
ok('an ordinary letter does not dedent', closerAt('int main() {\n    ', 17, 17, 'i') === null);
ok('a space does not dedent', closerAt('int main() {\n    ', 17, 17, ' ') === null);
ok('a real closer still dedents', closerAt('int main() {\n    ', 17, 17, '}')?.value === 'int main() {\n}');

console.log('\n— brackets —');
let a = autoCloseAt('', 0, 0, '(');
ok('an opener brings its closer', a && a.value === '()' && a.start === 1, JSON.stringify(a));

a = autoCloseAt('socket', 6, 6, '(');
ok('a pair opens after a word', a && a.value === 'socket()', JSON.stringify(a?.value));

// Typing the closer that is already there should step over it, not stack a second one.
a = autoCloseAt('socket()', 7, 7, ')');
ok('the closer under the cursor is stepped over', a && a.value === 'socket()' && a.start === 8, JSON.stringify(a));

ok('a pair does not open in front of a word', autoCloseAt('fd', 0, 0, '(') === null);
ok('an apostrophe after a word is not a pair', autoCloseAt("don", 3, 3, "'") === null);
a = autoCloseAt('', 0, 0, '"');
ok('a quote with nothing behind it does pair', a && a.value === '""', JSON.stringify(a?.value));

// Wrapping a selection is the one case where even a quote is unambiguous.
a = autoCloseAt('int x', 0, 5, '(');
ok('a selection is wrapped', a && a.value === '(int x)', JSON.stringify(a?.value));
ok('the selection survives the wrap', a && a.start === 1 && a.end === 6, JSON.stringify(a));

ok('an ordinary key is left to the browser', autoCloseAt('x', 1, 1, ';') === null);

let u = unpairAt('()', 1, 1);
ok('backspace inside an empty pair takes both', u && u.value === '' && u.start === 0, JSON.stringify(u));
ok('backspace elsewhere is the browser\'s job', unpairAt('(x)', 2, 2) === null);
ok('backspace between mismatched halves is left alone', unpairAt('(]', 1, 1) === null);

console.log('\n— which parts of a draft are code —');
let sp = codeSpans('why?\n```cpp\nint x;\n```\nthanks');
ok('one block is found', sp.length === 1, JSON.stringify(sp));
ok('the span covers the body only', sp[0] && 'why?\n```cpp\nint x;\n```\nthanks'.slice(sp[0].from, sp[0].to) === 'int x;\n', JSON.stringify(sp[0]));
ok('the language is picked up', sp[0]?.lang === 'cpp');

sp = codeSpans('```bash\nss -ltn\n```');
ok('a bash block keeps its language', sp[0]?.lang === 'bash', JSON.stringify(sp));

// The block you are in the middle of typing has no closing fence yet.
sp = codeSpans('look:\n```cpp\nint x;');
ok('an unterminated block runs to the end', sp.length === 1 && 'look:\n```cpp\nint x;'.slice(sp[0].from, sp[0].to) === 'int x;', JSON.stringify(sp));

ok('prose alone has no spans', codeSpans('why does recv() return 0?').length === 0);
ok('two blocks are both found', codeSpans('```\na\n```\nand\n```\nb\n```').length === 2);

console.log(fails ? `\n  ${fails} FAILING` : '\n  all compose cases pass');
process.exit(fails ? 1 : 0);
