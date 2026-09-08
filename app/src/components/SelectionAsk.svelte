<script lang="ts">
  /**
   * Highlight a passage, ask the mentor about that passage.
   *
   * Deliberately not built on `contextmenu` alone. Right-click is the desktop gesture
   * and it is handled, but this app is mostly read on a phone, where the equivalent is
   * a long-press that raises the *system* selection menu — which a web page cannot add
   * an item to. So the trigger is the selection itself: whenever a non-empty selection
   * lands inside the watched element, a pill appears above it. That one mechanism
   * covers mouse-drag, double-click, long-press and keyboard selection.
   *
   * The pill sits above the selection on purpose: the native selection menu appears
   * above on some platforms and below on others, and below is also where a thumb is.
   */
  import { tick, type Snippet } from 'svelte';

  interface Props {
    /** Text longer than this is cut before being sent — a whole screen isn't a question. */
    limit?: number;
    onask: (text: string) => void;
    /** The content whose selections are watched. */
    children: Snippet;
  }
  let { limit = 1500, onask, children }: Props = $props();

  let host = $state<HTMLElement | null>(null);
  let text = $state('');
  let at = $state<{ x: number; y: number } | null>(null);

  /** The current selection, but only if it is real and inside the watched element. */
  function selected(): { text: string; rect: DOMRect } | null {
    const sel = document.getSelection();
    if (!sel || sel.isCollapsed || !sel.rangeCount || !host) return null;
    const range = sel.getRangeAt(0);
    if (!host.contains(range.commonAncestorContainer)) return null;
    const value = sel.toString().trim();
    // One or two characters is a stray tap, not a question.
    if (value.length < 3) return null;
    const rect = range.getBoundingClientRect();
    if (!rect.width && !rect.height) return null;
    return { text: value, rect };
  }

  function place() {
    const found = selected();
    if (!found) {
      text = '';
      at = null;
      return;
    }
    text = found.text;
    const { rect } = found;
    // Clamped so the pill can't hang off either edge on a narrow screen.
    at = {
      x: Math.min(Math.max(rect.left + rect.width / 2, 84), window.innerWidth - 84),
      y: Math.max(rect.top - 10, 44),
    };
  }

  /**
   * Right-click, for anyone reading on a laptop.
   *
   * The native menu is only suppressed when there is actually a selection to ask
   * about — right-clicking a link or an image still behaves normally, and on the
   * platforms where a long-press synthesises this event, no selection means the system
   * copy menu is left alone.
   */
  async function onContextMenu(e: MouseEvent) {
    await tick();
    if (!selected()) return;
    e.preventDefault();
    place();
    if (at) at = { x: Math.min(Math.max(e.clientX, 84), window.innerWidth - 84), y: Math.max(e.clientY - 12, 44) };
  }

  function ask() {
    const value = text.length > limit ? `${text.slice(0, limit).trimEnd()}…` : text;
    onask(value);
    // Clearing the selection dismisses the pill and takes the system menu with it.
    document.getSelection()?.removeAllRanges();
    text = '';
    at = null;
  }

  $effect(() => {
    // `selectionchange` is the only event that fires for every way a selection can be
    // made — drag, double-click, long-press, shift-arrow — so it's the one to watch.
    const onChange = () => place();
    document.addEventListener('selectionchange', onChange);
    // A selection survives scrolling, but its position on screen does not.
    window.addEventListener('scroll', onChange, true);
    window.addEventListener('resize', onChange);
    return () => {
      document.removeEventListener('selectionchange', onChange);
      window.removeEventListener('scroll', onChange, true);
      window.removeEventListener('resize', onChange);
    };
  });
</script>

<!-- svelte-ignore a11y_no_static_element_interactions -->
<div bind:this={host} oncontextmenu={onContextMenu}>
  {@render children()}
</div>

{#if at && text}
  <button class="pill" style:left="{at.x}px" style:top="{at.y}px" onclick={ask}>
    <svg viewBox="0 0 24 24"><path d="M21 12a8 8 0 0 1-8 8H7l-4 3 1-5.5A8 8 0 1 1 21 12z" /></svg>
    Explain this
  </button>
{/if}

<style>
  .pill {
    position: fixed;
    transform: translate(-50%, -100%);
    z-index: 45;
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 8px 13px;
    border-radius: 999px;
    background: var(--accent);
    color: var(--accent-ink, #fff);
    font-size: 13.5px;
    font-weight: 600;
    white-space: nowrap;
    box-shadow: 0 6px 20px rgba(0, 0, 0, 0.3);
    animation: pop 0.12s ease;
  }

  .pill svg {
    width: 15px;
    height: 15px;
    fill: none;
    stroke: currentColor;
    stroke-width: 2;
    stroke-linecap: round;
    stroke-linejoin: round;
  }

  @keyframes pop {
    from {
      opacity: 0;
      transform: translate(-50%, -90%);
    }
  }
</style>
