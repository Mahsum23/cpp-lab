<script lang="ts">
  /**
   * The composer's text field, for a chat you paste C++ into.
   *
   * A textarea cannot render coloured text, so this is the usual trick: a highlighted
   * `<pre>` sits underneath, the textarea on top has transparent glyphs and a visible
   * caret, and the two are held in the same box with the same metrics so the letters
   * land on top of each other. The underlay only appears when there is actually code
   * to paint — ordinary prose is drawn by the textarea itself, so the common case
   * can't be knocked out of alignment by anything.
   *
   * It also owns the editor keys (indent, autoclose, the fence action), because those
   * and the highlighting have to agree about where the code in a draft begins and ends.
   */
  import { highlight } from '../lib/markdown';
  import {
    autoCloseAt, closerAt, codeSpans, hasFence, inFence, indentAt, looksLikeCode,
    newlineAt, unpairAt, wrapSelection,
  } from '../lib/compose';

  interface Props {
    value: string;
    codeMode: boolean;
    placeholder?: string;
    ariaLabel?: string;
    /** Cap before the field scrolls internally instead of growing. */
    maxHeight?: number;
    /** The subject's language: what code mode highlights and fences as. */
    lang?: string;
    /** Ctrl/Cmd+Enter. */
    onsubmit?: () => void;
    onescape?: () => void;
  }
  let {
    value = $bindable(),
    codeMode = $bindable(),
    placeholder = 'Ask about this…',
    ariaLabel = 'Message',
    maxHeight = 148,
    lang = 'cpp',
    onsubmit,
    onescape,
  }: Props = $props();

  let box = $state<HTMLTextAreaElement | null>(null);
  let under = $state<HTMLPreElement | null>(null);

  // Painting prose through the highlighter would be work for nothing, and it's the one
  // state where a mismatch would be visible on every keystroke.
  const lit = $derived(codeMode || hasFence(value));

  const esc = (s: string) =>
    s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

  /**
   * The underlay's HTML: the whole draft when the field is in code mode, otherwise the
   * fenced parts highlighted and the prose around them left plain.
   *
   * A trailing newline gets a space after it, because a textarea shows the empty line
   * it implies and a `<pre>` does not — without this the two drift apart by a line the
   * moment you press Enter at the end.
   */
  const painted = $derived.by(() => {
    const text = value.endsWith('\n') ? `${value} ` : value;
    if (codeMode) return highlight(text, lang);
    let out = '';
    let at = 0;
    for (const span of codeSpans(text)) {
      out += esc(text.slice(at, span.from));
      out += highlight(text.slice(span.from, span.to), span.lang);
      at = span.to;
    }
    return out + esc(text.slice(at));
  });

  // Not an attribute Svelte knows about, and smuggling it in with a spread would put
  // the element on the dynamic-attributes path, which fights the direct writes below.
  $effect(() => {
    box?.setAttribute('autocorrect', 'off');
  });

  export function focus() {
    box?.focus();
  }

  export function grow() {
    if (!box) return;
    box.style.height = 'auto';
    box.style.height = `${Math.min(box.scrollHeight, maxHeight)}px`;
  }

  /**
   * Apply an edit the browser wouldn't have made, and put the cursor back.
   *
   * Synchronously, on the element itself, rather than assigning the bound value and
   * fixing the selection a frame later: anyone typing at speed gets their next
   * keystroke in before that frame runs, and it lands wherever the cursor used to be.
   */
  function apply(r: { value: string; start: number; end: number }) {
    if (!box) {
      value = r.value;
      return;
    }
    box.value = r.value;
    box.setSelectionRange(r.start, r.end);
    // Tell the binding the way typing would, rather than assigning the prop: setting
    // the element and the prop separately leaves Svelte's own record of the field
    // disagreeing with the DOM, and it writes the stale text back over the top of
    // this one on the next update.
    box.dispatchEvent(new Event('input', { bubbles: true }));
    box.setSelectionRange(r.start, r.end);
    grow();
    sync();
  }

  /** Keep the underlay under the same part of the text the textarea is showing. */
  function sync() {
    if (!box || !under) return;
    under.scrollTop = box.scrollTop;
    under.scrollLeft = box.scrollLeft;
  }

  /**
   * The `</>` action, contextual — so a mixed message doesn't need hand-typed markdown.
   *
   * With a selection it fences exactly that; with the cursor in a draft it drops an
   * empty block in and lands inside it; with nothing typed the whole message is going
   * to be code, so it flips the field's own mode instead.
   */
  export function codeAction() {
    if (!box) {
      codeMode = !codeMode;
      return;
    }
    const { selectionStart: from, selectionEnd: to, value: text } = box;
    if (from === to && !text.trim()) {
      codeMode = !codeMode;
      box.focus();
      return;
    }
    apply(wrapSelection(text, from, to, lang));
    box.focus();
  }

  // Paste is the moment that matters: a pasted function should not silently arrive as
  // a paragraph with its indentation reflowed away.
  function onPaste(e: ClipboardEvent) {
    const text = e.clipboardData?.getData('text') ?? '';
    if (text && !hasFence(value) && looksLikeCode(text)) codeMode = true;
  }

  /**
   * Editor keys, live wherever the cursor is actually in code — the whole field in
   * code mode, or the code half of a mixed message.
   */
  function onEdit(e: KeyboardEvent) {
    if (!box || e.metaKey || e.ctrlKey || e.altKey || e.isComposing) return;
    const { value: text, selectionStart: from, selectionEnd: to } = box;
    if (!codeMode && !inFence(text, from)) return;

    if (e.key === 'Tab') {
      e.preventDefault();
      return apply(indentAt(text, from, to));
    }
    // Enter is a newline here (Ctrl/Cmd+Enter sends), so it is ours to indent.
    if (e.key === 'Enter') {
      e.preventDefault();
      return apply(newlineAt(text, from, to));
    }
    if (e.key === 'Backspace') {
      const r = unpairAt(text, from, to);
      if (!r) return;
      e.preventDefault();
      return apply(r);
    }
    if (e.key.length !== 1) return;

    // A closer on a line of nothing but indentation pulls that line back a level;
    // otherwise the bracket rules (open a pair, step over one, wrap a selection) apply.
    const r = closerAt(text, from, to, e.key) ?? autoCloseAt(text, from, to, e.key);
    if (!r) return;
    e.preventDefault();
    apply(r);
  }

  function onKey(e: KeyboardEvent) {
    onEdit(e);
    // Ctrl/Cmd+E does what the button does, for anyone typing on a real keyboard.
    if (e.key.toLowerCase() === 'e' && (e.metaKey || e.ctrlKey)) {
      e.preventDefault();
      codeAction();
    }
    // Enter is a newline on a phone keyboard. Desktop gets the shortcut it expects.
    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
      e.preventDefault();
      onsubmit?.();
    }
    if (e.key === 'Escape') onescape?.();
  }
</script>

<div class="field" class:code={codeMode} class:lit>
  {#if lit}
    <pre bind:this={under} class="under" aria-hidden="true">{@html painted}</pre>
  {/if}
  <textarea
    bind:this={box}
    bind:value
    oninput={() => { grow(); sync(); }}
    onscroll={sync}
    onkeydown={onKey}
    onpaste={onPaste}
    rows="1"
    {placeholder}
    aria-label={ariaLabel}
    style:max-height={`${maxHeight}px`}
    autocomplete="off"
    autocapitalize="none"
    spellcheck={!lit}
  ></textarea>
</div>

<style>
  /* The border and background live on the wrapper, so the two layers inside it need
     only agree about padding and font to line up. */
  .field {
    position: relative;
    flex: 1;
    min-width: 0;
    background: var(--bg-elev, var(--surface-2));
    border: 1px solid var(--border);
    border-radius: 19px;
  }

  .field:focus-within {
    border-color: var(--accent);
  }

  .under,
  .field textarea {
    margin: 0;
    padding: 10px 14px;
    border: 0;
    font-family: inherit;
    /* 16px exactly: anything smaller and iOS zooms the viewport on focus. */
    font-size: 16px;
    line-height: 1.45;
    letter-spacing: normal;
    white-space: pre-wrap;
    overflow-wrap: anywhere;
    tab-size: 4;
  }

  .field.code .under,
  .field.code textarea {
    font-family: var(--font-mono, ui-monospace, SFMono-Regular, Menlo, monospace);
    font-size: 13.5px;
    line-height: 1.55;
    white-space: pre;
  }

  .under {
    position: absolute;
    inset: 0;
    overflow: hidden;
    pointer-events: none;
    color: var(--text);
    border-radius: inherit;
  }

  .field textarea {
    position: relative;
    display: block;
    width: 100%;
    resize: none;
    background: transparent;
    color: var(--text);
    overflow-y: auto;
  }

  .field.code textarea {
    overflow-x: auto;
  }

  /* Transparent glyphs, visible caret: the colour comes from the layer underneath.
     -webkit-text-fill-color is the one Safari actually honours, which is also why the
     placeholder has to opt back out of it below. */
  .field.lit textarea {
    color: transparent;
    -webkit-text-fill-color: transparent;
    caret-color: var(--text);
  }

  .field textarea::placeholder {
    color: var(--text-faint);
    -webkit-text-fill-color: var(--text-faint);
  }

  .field textarea:focus {
    outline: none;
  }
</style>
