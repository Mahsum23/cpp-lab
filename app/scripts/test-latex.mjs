/**
 * test-latex.mjs — models reach for LaTeX in prose that has no maths in it, and the app
 * ships no maths renderer, so `SYN $\rightarrow$ SYN-ACK` reaches the reader as source.
 *
 * The interesting half of this file is the negative cases. `$` is a real character in a
 * systems curriculum — `$PATH`, `$1`, a shell prompt — so a fix that is too eager is
 * worse than the bug it replaces. Those cases are tested through the full renderer,
 * because what protects them is structural (code spans are not text tokens), not a
 * property of deLatex itself.
 *
 * Run: npm test
 */
import { build } from 'esbuild';
import { writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

async function load(entry, name) {
  const out = await build({
    entryPoints: [new URL(entry, import.meta.url).pathname],
    bundle: true, format: 'esm', write: false,
  });
  const file = join(tmpdir(), name);
  writeFileSync(file, out.outputFiles[0].text);
  return import(file);
}

const { deLatex } = await load('../src/lib/latex.ts', 'cpp-lab-latex.mjs');
const { render } = await load('../src/lib/markdown.ts', 'cpp-lab-markdown-latex.mjs');

let fails = 0;
const ok = (label, cond, extra) => {
  if (!cond) { fails++; console.log(`  FAIL  ${label}${extra ? `\n        ${extra}` : ''}`); }
  else console.log(`  PASS  ${label}`);
};
const eq = (label, got, want) => ok(label, got === want, `got:  ${JSON.stringify(got)}\n        want: ${JSON.stringify(want)}`);

console.log('\n— the reported bug —');
eq('the handshake arrow renders as an arrow',
  deLatex('SYN $\\rightarrow$ SYN-ACK $\\rightarrow$ ACK'),
  'SYN → SYN-ACK → ACK');
ok('and survives the whole renderer',
  render('SYN $\\rightarrow$ SYN-ACK $\\rightarrow$ ACK').includes('SYN → SYN-ACK → ACK'));

console.log('\n— delimiters —');
eq('inline \\( \\)', deLatex('cost is \\(O(n)\\) here'), 'cost is O(n) here');
eq('display $$ $$', deLatex('$$x \\times y$$'), 'x × y');
eq('display \\[ \\]', deLatex('\\[a \\leq b\\]'), 'a ≤ b');
eq('a bare command with no delimiters at all', deLatex('A \\rightarrow B'), 'A → B');

console.log('\n— conversions —');
eq('comparisons', deLatex('$a \\leq b$ and $c \\neq d$'), 'a ≤ b and c ≠ d');
eq('font wrappers unwrap', deLatex('$\\text{page} \\to \\texttt{ctid}$'), 'page → ctid');
eq('fractions read as division', deLatex('$\\frac{n}{2}$'), 'n/2');
eq('superscript keeps its marker, loses its braces', deLatex('$O(n^{2})$'), 'O(n^2)');
eq('subscript likewise', deLatex('$x_{i}$'), 'x_i');
eq('an unknown command keeps its name', deLatex('$\\weirdop x$'), 'weirdop x');
eq('escaped literals lose the backslash', deLatex('$50\\% \\text{done}$'), '50% done');

console.log('\n— what must NOT be touched —');
eq('money with a space before the next dollar', deLatex('it costs $5 and $10 total'), 'it costs $5 and $10 total');
eq('a bare price range has no letters, so it is not maths', deLatex('$100-$200'), '$100-$200');
eq('prose with no dollars and no backslashes is returned unchanged',
  deLatex('recv() returns 0 at end of stream'), 'recv() returns 0 at end of stream');
eq('a lone dollar is left alone', deLatex('the $ sign'), 'the $ sign');

const codeSpan = render('Run `echo $PATH` and `$ ss -tan | grep 9000`.');
ok('$PATH inside a code span is untouched', codeSpan.includes('echo $PATH'), codeSpan);
ok('a shell prompt inside a code span is untouched', codeSpan.includes('$ ss -tan'), codeSpan);

const fenced = render('```bash\n$ ss -tan\necho "$1 $HOME"\n```');
ok('a fenced block keeps every dollar', fenced.includes('$1') && fenced.includes('$HOME'), fenced);

const mixed = render('The arrow $\\to$ here, but `$HOME` stays.');
ok('one line, both behaviours', mixed.includes('→') && mixed.includes('$HOME'), mixed);

console.log('\n— the lessons still render as written —');
ok('a dollar-heavy shell line survives',
  render('```console\n$ ls -l /proc/$$/fd\n```').includes('/proc/$$/fd'));

console.log(fails ? `\n${fails} failing` : '\nall latex cases pass');
process.exit(fails ? 1 : 0);
