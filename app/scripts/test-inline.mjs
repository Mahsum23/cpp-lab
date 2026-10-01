/**
 * test-inline.mjs — quiz, drill and checklist text carries light inline markdown, and it
 * goes into the page as HTML. Two things are load-bearing: everything is escaped (a
 * `<cstdio>` or an `a < b` must stay text), and nothing inside a code span is read as
 * emphasis (the asterisk in `count(*)` is SQL, not markup).
 *
 * The second half renders every such string the app actually ships and fails on any
 * leftover backtick or `**`, which would mean a question shows its markup to the reader.
 *
 * Run: npm test
 */
import { build } from 'esbuild';
import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const out = await build({
  entryPoints: [new URL('../src/lib/inline.ts', import.meta.url).pathname],
  bundle: true, format: 'esm', write: false,
});
const file = join(tmpdir(), 'cpp-lab-inline.mjs');
writeFileSync(file, out.outputFiles[0].text);
const { inlineHtml } = await import(file);

let fails = 0;
const eq = (label, got, want) => {
  if (got !== want) { fails++; console.log(`  FAIL  ${label}\n        got:  ${got}\n        want: ${want}`); }
  else console.log(`  PASS  ${label}`);
};

console.log('\n— rendering —');
eq('code span', inlineHtml('use `NOT EXISTS` here'), 'use <code>NOT EXISTS</code> here');
eq('asterisk inside code is SQL', inlineHtml('why does `count(*)` say 1'), 'why does <code>count(*)</code> say 1');
eq('two code spans with asterisks', inlineHtml('`count(*)` against `count(o.id)`'), '<code>count(*)</code> against <code>count(o.id)</code>');
eq('bold', inlineHtml('their **paid** orders'), 'their <strong>paid</strong> orders');
eq('emphasis', inlineHtml('the *session* zone'), 'the <em>session</em> zone');
eq('multiplication is not emphasis', inlineHtml('3 * 4 * 5'), '3 * 4 * 5');
eq('escaped outside code', inlineHtml('a < b && c'), 'a &lt; b &amp;&amp; c');
eq('escaped inside code', inlineHtml('`#include <cstdio>`'), '<code>#include &lt;cstdio&gt;</code>');
eq('no markup injection', inlineHtml('<img src=x onerror=alert(1)>'), '&lt;img src=x onerror=alert(1)&gt;');
eq('an unmatched backtick stays text', inlineHtml('a ` alone'), 'a ` alone');
eq('quotes escaped', inlineHtml(`it's "fine"`), 'it&#39;s &quot;fine&quot;');

console.log('\n— everything the app ships —');
const weeksDir = new URL('../public/content/weeks/', import.meta.url).pathname;
let checked = 0;
const leftovers = [];
for (const f of readdirSync(weeksDir)) {
  const week = JSON.parse(readFileSync(join(weeksDir, f), 'utf8'));
  for (const day of week.days) {
    const texts = [];
    for (const q of [...(day.quiz ?? []), ...(day.drill ?? [])]) {
      texts.push(q.prompt, ...q.options.flatMap((o) => [o.text, o.why]));
    }
    texts.push(...(day.task?.checklist ?? []));
    for (const t of texts) {
      checked++;
      // Strip what was rendered; what remains must not still contain markup.
      const text = inlineHtml(t).replace(/<code>[\s\S]*?<\/code>/g, '');
      if (/`|\*\*/.test(text)) leftovers.push(`${day.id}: ${t.slice(0, 90)}`);
    }
  }
}
if (leftovers.length) { fails++; console.log(`  FAIL  ${leftovers.length} strings still show markup:\n        ${leftovers.slice(0, 8).join('\n        ')}`); }
else console.log(`  PASS  ${checked} quiz, drill and checklist strings render without leftover markup`);

console.log(fails ? `\n  ${fails} FAILING` : '\n  all inline cases pass');
process.exit(fails ? 1 : 0);
