/**
 * test-shape.mjs — Go and C++ "write it" cards are judged by shape (shapecheck.ts), because
 * neither language can be run faithfully in a browser. This tests the judge itself: what the
 * tokenizer drops, how patterns bind and backtrack, which spellings are treated as the same.
 *
 * (Whether each card's patterns are *right* is a different question, answered against the
 * real compilers by check-shape-cards.mjs.)
 *
 * Run: npm test
 */
import { build } from 'esbuild';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';

const cache = new URL('../node_modules/.cache/slowpath/', import.meta.url).pathname;
mkdirSync(cache, { recursive: true });
const outfile = join(cache, 'shapecheck.mjs');
await build({
  entryPoints: [new URL('../src/lib/shapecheck.ts', import.meta.url).pathname],
  bundle: true, format: 'esm', platform: 'node', outfile,
});
const { tokenize, normalize, unbalanced, judge, shapeKey, compilePattern } = await import(outfile);

let fails = 0;
const ok = (label, cond, extra) => {
  if (!cond) { fails++; console.log(`  FAIL  ${label}${extra ? `\n        ${extra}` : ''}`); }
  else console.log(`  PASS  ${label}`);
};
const texts = (src, lang) => normalize(tokenize(src, lang).toks, lang).map((t) => t.t);
const pass = (code, lang, requires, forbids, defs) => judge(code, lang, { requires, forbids }, defs).ok;

// --- tokenizer ---------------------------------------------------------------

ok('comments and whitespace vanish', texts('a := 1 // note\n/* x */ b', 'go').join(' ') === 'a := 1 b');
ok('a string is one token, comment markers inside it stay', texts('s := "// not a comment"', 'go').length === 3);
ok('go raw string', texts('s := `a "b" c`', 'go')[2] === '`a "b" c`');
ok('go :=, <- and &^ are single tokens', texts('x := <-ch &^ y', 'go').join(' ') === 'x := <- ch &^ y');
ok('cpp ::, -> and << are single tokens', texts('a::b->c << d', 'cpp').join(' ') === 'a :: b -> c << d');
ok('cpp >> is two closers', texts('vector<vector<int>> v;', 'cpp').filter((t) => t === '>').length === 2);
ok('cpp digit separator is not a char literal', tokenize("int x = 1'000;", 'cpp').error === null);
ok("cpp 'a' is one token", texts("char c = 'a';", 'cpp')[3] === "'a'");
ok('cpp raw string', texts('auto s = R"x(a "b" c)x";', 'cpp')[3].startsWith('R"x('));
ok('unclosed string is an error', tokenize('s := "abc', 'go').error !== null);
ok('unclosed comment is an error', tokenize('/* abc', 'cpp').error !== null);
ok('numbers: hex, float, suffix', texts('0x1F 3.14 10u 1e9', 'cpp').join(' ') === '0x1F 3.14 10u 1e9');
ok('go ellipsis', texts('f(xs...)', 'go').includes('...'));

// --- normalization -----------------------------------------------------------

ok('std:: dropped', texts('std::memset(&a, 0, n);', 'cpp').join(' ') === 'memset ( & a , 0 , n ) ;');
ok('leading :: dropped', texts('::socket(AF_INET, 1, 0)', 'cpp')[0] === 'socket');
ok('a::b keeps its ::', texts('Foo::bar', 'cpp').join(' ') === 'Foo :: bar');
ok('vector<int>::size_type keeps its ::', texts('std::vector<int>::size_type n;', 'cpp').join(' ') === 'vector < int > :: size_type n ;');
ok('struct before an identifier dropped', texts('struct sockaddr_in a{};', 'cpp').join(' ') === 'sockaddr_in a { } ;');
ok('go is untouched by cpp normalization', texts('std::x', 'go').length >= 1);
ok('shapeKey ignores layout', shapeKey('a  =  1 ;// x', 'cpp') === shapeKey('a=1;', 'cpp'));

// --- brackets ----------------------------------------------------------------

ok('balanced', unbalanced(tokenize('f(a[1]){ x }', 'go').toks) === null);
ok('extra closer', unbalanced(tokenize('f(a))', 'go').toks) !== null);
ok('never closed', unbalanced(tokenize('func f() {', 'go').toks) !== null);
ok('crossed', unbalanced(tokenize('f(a[1)]', 'go').toks) !== null);
ok('brackets inside strings do not count', unbalanced(tokenize('s := "(("', 'go').toks) === null);

// --- patterns ----------------------------------------------------------------

const req = (match, say = 'x') => [{ say, match }];
ok('literal pattern', pass('x := 5', 'go', req('x := 5')));
ok('literal miss', !pass('x := 6', 'go', req('x := 5')));
ok('pattern is found anywhere', pass('package main\nfunc f() { x := 5 }', 'go', req('x := 5')));
ok('$name binds an identifier', pass('count := 1; _ = count', 'go', req('$v := $num ; _ = $v')));
ok('$name must repeat as the same identifier', pass('a := 1\n_ = a', 'go', req('$v := $num _ = $v')));
ok('$name different identifier fails', !pass('a := 1\n_ = b', 'go', req('$v := $num _ = $v')));
ok('$num rejects an identifier', !pass('a := b', 'go', req('a := $num')));
ok('$str matches a string', pass('a := "hi"', 'go', req('a := $str')));
ok('$str=text checks the content', pass('Println("hello")', 'go', req('Println ( $str=hello )')) && !pass('Println("bye")', 'go', req('Println ( $str=hello )')));
ok('$any is exactly one token', pass('f(a)', 'go', req('f ( $any )')) && !pass('f(a, b)', 'go', req('f ( $any )')));
ok('$* is a balanced run', pass('f(a, g(b, c), d)', 'go', req('f ( $* )')));
ok('$* can be empty', pass('f()', 'go', req('f ( $* )')));
ok('$+ cannot be empty', !pass('f()', 'go', req('f ( $+ )')) && pass('f(1)', 'go', req('f ( $+ )')));
ok('$* stays inside its brackets', !pass('f(a) + g(b)', 'go', req('f ( $* b')));
ok('alternation', pass('a := 1', 'go', req('a \\( := \\| = \\) 1')) && pass('a = 1', 'go', req('a \\( := \\| = \\) 1')));
ok('optional via empty branch', pass('go f()', 'go', req('\\( go \\| \\) f ( )')) && pass('f()', 'go', req('\\( go \\| \\) f ( )')));
ok('a bare | in a def is a literal token, not a choice', !pass('x := 1', 'go', req('x @assign 1'), undefined, { assign: ':= | =' }));
ok('defs with explicit alternation', pass('x = 1', 'go', req('x @assign 1'), undefined, { assign: ':= \\| =' }));
ok('unknown def throws', (() => { try { compilePattern('@nope', 'go', {}); return false; } catch { return true; } })());
ok('std::memset matches pattern memset', pass('std::memset(&a, 0, sizeof a);', 'cpp', req('memset ( & a , 0 , sizeof a )')));
ok('::socket matches pattern socket', pass('int fd = ::socket(AF_INET, SOCK_STREAM, 0);', 'cpp', req('socket ( AF_INET , SOCK_STREAM , 0 )')));
ok('a pattern may itself say std::', pass('memset(&a, 0, n);', 'cpp', req('std :: memset ( $* )')));

// A pattern that starts with a name is that name, not the tail of a qualified one.
ok('printf does not match ns::printf', !pass('ns::printf("x");', 'cpp', req('printf (')));
ok('printf matches std::printf', pass('std::printf("x");', 'cpp', req('printf (')));
ok('printf matches ::printf', pass('::printf("x");', 'cpp', req('printf (')));
ok('Println does not match x.Println', !pass('x.Println(1)', 'go', req('Println (')));
ok('a pattern that spells the qualifier still matches', pass('fmt.Println(1)', 'go', req('fmt . Println (')));
ok('a pattern may start with an operator after a name', pass('a.b = 1', 'go', req('. b = 1')));

// --- ordering and bindings across requirements -------------------------------

ok('then: in order', pass('a(); b();', 'go', [{ say: 'o', then: ['a ( )', 'b ( )'] }]));
ok('then: wrong order fails', !pass('b(); a();', 'go', [{ say: 'o', then: ['a ( )', 'b ( )'] }]));
ok('then: backtracks to a later first match', pass('a(1); b(); a(); b();', 'go', [{ say: 'o', then: ['a ( )', 'b ( )'] }]));
ok('bindings carry from one requirement to the next', pass('fd := f(); close(fd)', 'go', [{ say: 'a', match: '$fd := f ( )' }, { say: 'b', match: 'close ( $fd )' }]));
ok('...and a mismatch fails', !pass('fd := f(); close(other)', 'go', [{ say: 'a', match: '$fd := f ( )' }, { say: 'b', match: 'close ( $fd )' }]));
{
  const r2 = judge('x := 1', 'go', { requires: [{ say: 'a', match: '$v := 2' }, { say: 'b', match: '$w := 1' }] });
  ok('a failed requirement does not stop the next one being judged', !r2.items[0].ok && r2.items[1].ok);
}

// --- the report --------------------------------------------------------------

const r = judge('x := 1', 'go', { requires: [{ say: 'declares x', match: 'x := 1' }, { say: 'prints it', match: 'Println ( x )' }] });
ok('report lists every requirement, in order', r.items.length === 2 && r.items[0].ok && !r.items[1].ok && r.items[1].say === 'prints it');
ok('report is not ok if any item is not', !r.ok);

const f = judge('x := 1; f(x)', 'go', { requires: [{ say: 'a', match: 'x := 1' }], forbids: [{ say: 'no f', match: 'f ( $* )' }] });
ok('a forbidden pattern fails the answer and says why', !f.ok && f.items.at(-1).kind === 'forbid' && f.items.at(-1).say === 'no f');
ok('a forbid that does not hit adds nothing', judge('x := 1', 'go', { requires: [{ say: 'a', match: 'x := 1' }], forbids: [{ say: 'no f', match: 'f ( $* )' }] }).items.length === 1);

const syn = judge('func f( {', 'go', { requires: [{ say: 'a', match: 'func' }] });
ok('unbalanced code reports a syntax problem first and is not ok', !syn.ok && syn.items[0].kind === 'syntax');
ok('empty answer fails', !judge('', 'go', { requires: [{ say: 'a', match: 'x' }] }).ok);

// Patterns that could loop: a run followed by a run, on a long input.
const long = 'f(' + 'a, '.repeat(200) + 'a)';
const t0 = Date.now();
judge(long, 'go', { requires: [{ say: 'a', match: 'f ( $* , $* , $* , zzz )' }] });
ok('nested runs on a long input finish quickly', Date.now() - t0 < 2000, `${Date.now() - t0} ms`);

// --- every shipped card, as the app will see it ------------------------------

import { readdirSync, readFileSync } from 'node:fs';
const dir = new URL('../public/content/weeks/', import.meta.url).pathname;
let shipped = 0;
for (const f of readdirSync(dir)) {
  const track = JSON.parse(readFileSync(join(dir, f), 'utf8'));
  for (const day of track.days ?? (track.weeks ?? []).flatMap((w) => w.days)) {
    const set = day.write;
    if (!set || set.lang === 'sql') continue;
    for (const c of set.challenges) {
      shipped++;
      let rep;
      try { rep = judge(c.solution, set.lang, { requires: c.requires, forbids: c.forbids }, set.defs); } catch (e) { rep = { ok: false, items: [{ say: String(e) }] }; }
      ok(`${day.id}/${c.id}: its own reference answer passes`, rep.ok, rep.items.filter((i) => !i.ok).map((i) => i.say).join(' / '));
      ok(`${day.id}/${c.id}: nothing authoring-only was shipped`, !('harness' in c) && !('good' in c) && !('bad' in c) && !('expect' in c));
      ok(`${day.id}/${c.id}: an empty answer fails`, !judge('', set.lang, { requires: c.requires, forbids: c.forbids }, set.defs).ok);
    }
  }
}
ok(`found the shipped Go and C++ cards (${shipped})`, shipped >= 50);

console.log(fails ? `\n${fails} failed` : '\nall passed');
process.exit(fails ? 1 : 0);
