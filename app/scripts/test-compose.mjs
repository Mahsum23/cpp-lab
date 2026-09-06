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
const { looksLikeCode, asCodeBlock, isFenced, hasFence, shapeOf, wrapSelection, indentAt, INDENT } = await import(file);

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

console.log(fails ? `\n  ${fails} FAILING` : '\n  all compose cases pass');
process.exit(fails ? 1 : 0);
