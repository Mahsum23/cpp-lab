/**
 * Keyboard shortcuts: the decisions are in shortcuts.ts, this is what they do.
 *
 * Screens do not listen for keys themselves. A screen that can open the mentor, or has
 * answers to pick, says so by registering a handle (`mentorKey`, `answerKeys`), and the
 * one listener in App.svelte routes a key to whichever is registered. That keeps the
 * rules — never while typing, never with Ctrl/Cmd/Alt — in a single place, and means a
 * new screen gets them for free instead of writing its own `keydown`.
 */
import { router } from './router.svelte';
import { readKey, type GoTarget } from './shortcuts';

/** A screen's way of opening the mentor, mirroring its visible Ask button. */
export interface MentorHandle {
  /** Whether `M` may open it right now. Default yes. */
  canOpen?: () => boolean;
  open: () => void;
  close: () => void;
  isOpen: () => boolean;
  /** Put the cursor in the message box. */
  focus?: () => void;
}

/** Put the cursor in the open mentor sheet's message box. */
export function focusComposer(): void {
  document.querySelector<HTMLTextAreaElement>('.sheet .composer textarea')?.focus();
}

/** A screen's answer buttons and its "next". */
export interface AnswerHandle {
  count: () => number;
  canChoose: () => boolean;
  choose: (index: number) => void;
  canAdvance: () => boolean;
  advance: () => void;
}

const PATHS: Record<GoTarget, string> = {
  today: '/today',
  map: '/map',
  stats: '/stats',
  review: '/review',
  settings: '/settings',
};

/** How long after `g` the next key still counts as the second half of the chord. */
const CHORD_MS = 1500;

class Shortcuts {
  /** The cheat sheet. */
  helpOpen = $state(false);

  private mentors = new Set<MentorHandle>();
  private answers: AnswerHandle | null = null;
  private chord = false;
  private chordTimer: ReturnType<typeof setTimeout> | undefined;

  registerMentor(handle: MentorHandle): () => void {
    this.mentors.add(handle);
    return () => this.mentors.delete(handle);
  }

  registerAnswers(handle: AnswerHandle): () => void {
    this.answers = handle;
    return () => {
      if (this.answers === handle) this.answers = null;
    };
  }

  /** Whether any mentor sheet is open. Answer keys stand down while one is. */
  get mentorOpen(): boolean {
    return [...this.mentors].some((h) => h.isOpen());
  }

  handle(e: KeyboardEvent): void {
    const pending = this.chord;
    this.chord = false;
    clearTimeout(this.chordTimer);

    const act = readKey(e, pending);
    if (!act) return;

    if (act.kind === 'close') return this.close(e);
    if (act.kind === 'help') {
      e.preventDefault();
      this.helpOpen = !this.helpOpen;
      return;
    }
    // The cheat sheet is modal: nothing else happens behind it.
    if (this.helpOpen) return;

    switch (act.kind) {
      case 'chord':
        this.chord = true;
        this.chordTimer = setTimeout(() => (this.chord = false), CHORD_MS);
        return;
      case 'go':
        e.preventDefault();
        router.go(PATHS[act.to]);
        return;
      case 'mentor':
        return this.mentor(e);
      case 'choose': {
        const a = this.answers;
        if (this.mentorOpen || !a || !a.canChoose() || act.index >= a.count()) return;
        e.preventDefault();
        a.choose(act.index);
        return;
      }
      case 'next': {
        const a = this.answers;
        if (this.mentorOpen || !a || !a.canAdvance()) return;
        e.preventDefault();
        a.advance();
        return;
      }
    }
  }

  private close(e: KeyboardEvent) {
    if (this.helpOpen) {
      this.helpOpen = false;
      e.preventDefault();
      return;
    }
    for (const h of this.mentors) {
      if (h.isOpen()) {
        h.close();
        e.preventDefault();
        return;
      }
    }
  }

  private mentor(e: KeyboardEvent) {
    // Already open: M puts the cursor in the box rather than doing nothing.
    const open = [...this.mentors].find((h) => h.isOpen());
    if (open) {
      open.focus?.();
      e.preventDefault();
      return;
    }
    const h = [...this.mentors].at(-1);
    if (h) {
      // This screen has a mentor, and it says whether it may be opened right now — a
      // review card only once it is answered, because before that the mentor would be
      // the answer key.
      if (h.canOpen?.() ?? true) {
        e.preventDefault();
        h.open();
      }
      return;
    }
    // A lesson's quiz, drill and explain steps have no mentor on purpose. A shortcut must
    // not open one the Ask button is deliberately absent from.
    if (router.route.name === 'session') return;
    e.preventDefault();
    router.go('/mentor');
  }
}

export const shortcuts = new Shortcuts();

/**
 * Declare how this screen opens the mentor. Call it during component setup; it
 * registers while the screen is mounted and lets go when it is not.
 */
export function mentorKey(make: () => MentorHandle): void {
  $effect(() => shortcuts.registerMentor(make()));
}

/** Declare this screen's answer buttons, for the number keys and `N`. */
export function answerKeys(make: () => AnswerHandle): void {
  $effect(() => shortcuts.registerAnswers(make()));
}
