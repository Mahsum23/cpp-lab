/**
 * What a key press means, decided in one place and without touching the DOM, so that it
 * can be tested without a browser.
 *
 * The rules that keep shortcuts from being a nuisance:
 *
 * - They never fire while you are typing. `M` in the middle of a sentence is an "m".
 * - They never fire with Ctrl, Cmd or Alt held. Those belong to the browser and the OS.
 * - They never fire on a held key (`repeat`), or while an IME is composing.
 * - Letters are read from the physical key (`code`), not the character (`key`). On a
 *   Russian layout the key that says M types "ь", and a shortcut that only works on a
 *   Latin layout is a shortcut that does not work for the person who wrote it.
 *
 * The one key that works while typing is Escape, because closing something you opened
 * should never depend on where the cursor is.
 */

export type GoTarget = 'today' | 'map' | 'stats' | 'review' | 'settings';

export type Shortcut =
  | { kind: 'mentor' }
  | { kind: 'close' }
  | { kind: 'help' }
  | { kind: 'chord' }
  | { kind: 'go'; to: GoTarget }
  | { kind: 'choose'; index: number }
  | { kind: 'next' };

/** The parts of a KeyboardEvent this reads, so tests can pass plain objects. */
export interface KeyLike {
  key: string;
  code: string;
  shiftKey: boolean;
  altKey: boolean;
  ctrlKey: boolean;
  metaKey: boolean;
  repeat: boolean;
  isComposing: boolean;
  target?: unknown;
}

interface ElementLike {
  tagName?: string;
  isContentEditable?: boolean;
  disabled?: boolean;
  getAttribute?: (name: string) => string | null;
}

const tag = (t: unknown): string => String((t as ElementLike | null)?.tagName ?? '').toUpperCase();

/** A place where letters are text: a field, a select, anything contenteditable. */
export function isTypingTarget(t: unknown): boolean {
  const el = t as ElementLike | null;
  if (!el) return false;
  return ['INPUT', 'TEXTAREA', 'SELECT'].includes(tag(t)) || el.isContentEditable === true;
}

/**
 * Something Enter already does: a link, a button that can be pressed, a summary. Enter
 * is only "next" when it would otherwise do nothing — focus on the page itself, or on a
 * button that has just been disabled by being answered.
 */
export function isPressable(t: unknown): boolean {
  const el = t as ElementLike | null;
  if (!el) return false;
  if (el.disabled === true) return false;
  return ['A', 'BUTTON', 'SUMMARY'].includes(tag(t)) || el.getAttribute?.('role') === 'button';
}

/** Where the `g` chord goes, by physical key. */
const GO: Record<string, GoTarget> = {
  KeyT: 'today',
  KeyM: 'map',
  KeyS: 'stats',
  KeyR: 'review',
  Comma: 'settings',
};

const DIGITS: Record<string, number> = {
  Digit1: 0, Digit2: 1, Digit3: 2, Digit4: 3,
  Numpad1: 0, Numpad2: 1, Numpad3: 2, Numpad4: 3,
};

/** What this key press means, or null if it means nothing here. */
export function readKey(e: KeyLike, chordPending = false): Shortcut | null {
  if (e.isComposing) return null;

  // Closing works from anywhere, including a text field, and even mid-chord.
  if (e.key === 'Escape') return { kind: 'close' };

  if (e.repeat || e.ctrlKey || e.metaKey || e.altKey) return null;
  if (isTypingTarget(e.target)) return null;

  // The second key of `g` then <something>. Anything else just cancels the chord.
  if (chordPending) {
    const to = e.shiftKey ? undefined : GO[e.code];
    return to ? { kind: 'go', to } : null;
  }

  // "?" is Shift+/ on a US keyboard and something else elsewhere, so accept the
  // character itself as well as the physical key.
  if (e.key === '?' || (e.code === 'Slash' && e.shiftKey)) return { kind: 'help' };

  // Nothing else uses Shift.
  if (e.shiftKey) return null;

  if (e.code === 'KeyG') return { kind: 'chord' };
  if (e.code === 'KeyM') return { kind: 'mentor' };
  if (e.code === 'KeyN') return { kind: 'next' };
  if (e.key === 'Enter') return isPressable(e.target) ? null : { kind: 'next' };
  if (e.code in DIGITS) return { kind: 'choose', index: DIGITS[e.code] };
  return null;
}

/** What a shortcut shows in the help sheet. Kept beside the rules so they cannot drift. */
export const SHORTCUT_HELP: { keys: string[]; does: string }[] = [
  { keys: ['M'], does: 'Ask the mentor — on a lesson page, or on a review card once you have answered it. Anywhere else it opens the Mentor tab.' },
  { keys: ['Esc'], does: 'Close the mentor, or this list' },
  { keys: ['1', '–', '4'], does: 'Pick an answer — quiz, drill and review' },
  { keys: ['N', 'or', 'Enter'], does: 'Next question or card, once you have answered' },
  { keys: ['G', 'then', 'T'], does: 'Go to Today' },
  { keys: ['G', 'then', 'M'], does: 'Go to the Map' },
  { keys: ['G', 'then', 'S'], does: 'Go to Stats' },
  { keys: ['G', 'then', 'R'], does: 'Go to Review' },
  { keys: ['G', 'then', ','], does: 'Go to Settings' },
  { keys: ['?'], does: 'Show this list' },
  { keys: ['Enter'], does: 'Send a message. Shift+Enter is a new line; Ctrl/Cmd+Enter always sends' },
  { keys: ['Ctrl/Cmd', '+', 'E'], does: 'Turn a message into a code block' },
];
