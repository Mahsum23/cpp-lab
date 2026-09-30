/**
 * test-shortcuts.mjs — a shortcut that fires while you are typing, or steals a browser
 * shortcut, or only works on a Latin keyboard, is worse than no shortcut. Every one of
 * those is a decision in readKey, so they are pinned here without a browser.
 *
 * Run: npm test
 */
import { build } from 'esbuild';
import { writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const out = await build({
  entryPoints: [new URL('../src/lib/shortcuts.ts', import.meta.url).pathname],
  bundle: true, format: 'esm', write: false,
});
const file = join(tmpdir(), 'cpp-lab-shortcuts.mjs');
writeFileSync(file, out.outputFiles[0].text);
const { readKey, isTypingTarget, isPressable, SHORTCUT_HELP } = await import(file);

let fails = 0;
const ok = (label, cond, extra = '') => {
  if (!cond) { fails++; console.log(`  FAIL  ${label}${extra ? `  << ${extra}` : ''}`); }
  else console.log(`  PASS  ${label}`);
};

const ev = (over = {}) => ({ key: '', code: '', shiftKey: false, altKey: false, ctrlKey: false, metaKey: false, repeat: false, isComposing: false, target: { tagName: 'BODY' }, ...over });
const press = (code, key = code, over = {}) => ev({ code, key, ...over });
const kind = (e, chord = false) => readKey(e, chord)?.kind ?? null;

console.log('\n— the keys —');
ok('M opens the mentor', kind(press('KeyM', 'm')) === 'mentor');
ok('Esc closes', kind(press('Escape', 'Escape')) === 'close');
ok('? shows the help (as the character)', kind(ev({ key: '?', code: 'Slash', shiftKey: true })) === 'help');
ok('? shows the help on a layout where it is another key', kind(ev({ key: '?', code: 'Digit7', shiftKey: true })) === 'help');
ok('1 to 4 pick answers 0 to 3', [1, 2, 3, 4].every((n, i) => readKey(press(`Digit${n}`, String(n)))?.index === i));
ok('the numpad picks too', readKey(press('Numpad3', '3'))?.index === 2);
ok('5 picks nothing', readKey(press('Digit5', '5')) === null);
ok('N is next', kind(press('KeyN', 'n')) === 'next');
ok('Enter on the bare page is next', kind(press('Enter', 'Enter')) === 'next');
ok('G starts a chord', kind(press('KeyG', 'g')) === 'chord');
ok('an unrelated key means nothing', readKey(press('KeyX', 'x')) === null);

console.log('\n— layouts —');
ok('on a Russian layout the M key (types ь) still opens the mentor', kind(press('KeyM', 'ь')) === 'mentor');
ok('and G (types п) still starts a chord', kind(press('KeyG', 'п')) === 'chord');
ok('and N (types т) is still next', kind(press('KeyN', 'т')) === 'next');
ok('a character that is M but on a different key is not M', readKey(press('KeyK', 'm')) === null);

console.log('\n— never while typing —');
for (const tagName of ['INPUT', 'TEXTAREA', 'SELECT']) ok(`not in a ${tagName.toLowerCase()}`, readKey(press('KeyM', 'm', { target: { tagName } })) === null);
ok('not in a contenteditable', readKey(press('KeyM', 'm', { target: { tagName: 'DIV', isContentEditable: true } })) === null);
ok('digits are text in a field too', readKey(press('Digit1', '1', { target: { tagName: 'TEXTAREA' } })) === null);
ok('Esc still closes from inside a field', kind(press('Escape', 'Escape', { target: { tagName: 'TEXTAREA' } })) === 'close');
ok('a button or link is not a typing target', !isTypingTarget({ tagName: 'BUTTON' }) && !isTypingTarget({ tagName: 'A' }));
ok('M works with a button focused', kind(press('KeyM', 'm', { target: { tagName: 'BUTTON' } })) === 'mentor');

console.log('\n— never the browser’s —');
for (const m of ['ctrlKey', 'metaKey', 'altKey']) {
  ok(`${m}+M is left alone`, readKey(press('KeyM', 'm', { [m]: true })) === null);
  ok(`${m}+1 is left alone`, readKey(press('Digit1', '1', { [m]: true })) === null);
}
ok('Ctrl+Esc still reports a close (closing is always safe)', kind(press('Escape', 'Escape', { ctrlKey: true })) === 'close');
ok('Shift+M is not M', readKey(press('KeyM', 'M', { shiftKey: true })) === null);
ok('a held key does not repeat', readKey(press('KeyM', 'm', { repeat: true })) === null);
ok('nothing fires mid-composition', readKey(press('KeyM', 'm', { isComposing: true })) === null && readKey(press('Escape', 'Escape', { isComposing: true })) === null);

console.log('\n— Enter only when it would do nothing —');
ok('not on a link', readKey(press('Enter', 'Enter', { target: { tagName: 'A' } })) === null);
ok('not on a live button', readKey(press('Enter', 'Enter', { target: { tagName: 'BUTTON', disabled: false } })) === null);
ok('yes on a button that has just been disabled by being answered', kind(press('Enter', 'Enter', { target: { tagName: 'BUTTON', disabled: true } })) === 'next');
ok('not on role=button', readKey(press('Enter', 'Enter', { target: { tagName: 'DIV', getAttribute: (n) => (n === 'role' ? 'button' : null) } })) === null);
ok('Shift+Enter is not next', readKey(press('Enter', 'Enter', { shiftKey: true })) === null);
ok('isPressable agrees', isPressable({ tagName: 'SUMMARY' }) && !isPressable({ tagName: 'BODY' }) && !isPressable(null));

console.log('\n— the g chord —');
const go = (code, over = {}) => readKey(press(code, code, over), true);
ok('g then t is Today', go('KeyT')?.to === 'today');
ok('g then m is the Map (not the mentor)', go('KeyM')?.to === 'map' && go('KeyM')?.kind === 'go');
ok('g then s is Stats', go('KeyS')?.to === 'stats');
ok('g then r is Review', go('KeyR')?.to === 'review');
ok('g then , is Settings', go('Comma')?.to === 'settings');
ok('g then anything else goes nowhere', go('KeyX') === null && go('Digit1') === null);
ok('g then Shift+t goes nowhere', go('KeyT', { shiftKey: true }) === null);
ok('g then typing in a field goes nowhere', go('KeyT', { target: { tagName: 'INPUT' } }) === null);
ok('Esc in a chord still closes (and so cancels it)', readKey(press('Escape', 'Escape'), true)?.kind === 'close');
ok('chord keys work on a Russian layout', readKey(ev({ code: 'KeyT', key: 'е' }), true)?.to === 'today');

console.log('\n— the help list —');
ok('every shortcut the rules define is listed', ['M', 'Esc', '?'].every((k) => SHORTCUT_HELP.some((h) => h.keys[0] === k)) && SHORTCUT_HELP.some((h) => h.keys.includes('T')) && SHORTCUT_HELP.some((h) => h.keys.includes('N')));

console.log(fails ? `\n  ${fails} FAILING` : '\n  all shortcut cases pass');
process.exit(fails ? 1 : 0);
