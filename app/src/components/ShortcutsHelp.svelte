<script lang="ts">
  /** The cheat sheet. `?` opens and closes it, Esc closes it; nothing else reacts behind it. */
  import { shortcuts } from '../lib/shortcuts.svelte';
  import { SHORTCUT_HELP } from '../lib/shortcuts';

  const joiners = new Set(['then', 'or', '+', '–']);
  const close = () => (shortcuts.helpOpen = false);
</script>

{#if shortcuts.helpOpen}
  <!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions -->
  <div class="scrim" onclick={close}></div>

  <div class="help" role="dialog" aria-modal="true" aria-label="Keyboard shortcuts">
    <header>
      <h2>Keyboard shortcuts</h2>
      <button class="x" onclick={close} aria-label="Close">
        <svg viewBox="0 0 24 24"><path d="M6 6l12 12M18 6L6 18" /></svg>
      </button>
    </header>

    <ul>
      {#each SHORTCUT_HELP as row}
        <li>
          <span class="keys">
            {#each row.keys as k}
              {#if joiners.has(k)}<span class="join">{k}</span>{:else}<kbd>{k}</kbd>{/if}
            {/each}
          </span>
          <span class="does">{row.does}</span>
        </li>
      {/each}
    </ul>

    <p class="fine">
      Shortcuts pause while you are typing, and never use Ctrl, Cmd or Alt, so the browser's
      own keys still work. They read the physical key, so they work on any keyboard layout.
    </p>
  </div>
{/if}

<style>
  .scrim {
    position: fixed;
    inset: 0;
    background: rgba(0, 0, 0, 0.45);
    z-index: 70;
    animation: fade 0.12s ease;
  }

  .help {
    position: fixed;
    z-index: 71;
    left: 50%;
    top: 50%;
    transform: translate(-50%, -50%);
    width: min(520px, calc(100vw - 32px));
    max-height: calc(100vh - 48px);
    overflow-y: auto;
    background: var(--bg, var(--surface));
    border: 1px solid var(--border);
    border-radius: 16px;
    box-shadow: 0 20px 60px rgba(0, 0, 0, 0.35);
    padding: 16px 18px 14px;
    animation: pop 0.14s cubic-bezier(0.2, 0.8, 0.3, 1);
  }

  @keyframes fade {
    from { opacity: 0; }
  }

  @keyframes pop {
    from { opacity: 0; transform: translate(-50%, -48%); }
  }

  header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    margin-bottom: 8px;
  }

  h2 {
    font-size: 17px;
    letter-spacing: -0.01em;
    margin: 0;
  }

  .x {
    padding: 4px;
    color: var(--text-faint);
  }

  .x svg {
    width: 20px;
    height: 20px;
    fill: none;
    stroke: currentColor;
    stroke-width: 2;
    stroke-linecap: round;
  }

  ul {
    list-style: none;
    margin: 0;
    padding: 0;
  }

  li {
    display: grid;
    grid-template-columns: 138px 1fr;
    gap: 12px;
    align-items: baseline;
    padding: 7px 0;
    border-top: 1px solid var(--border);
    font-size: 14px;
    line-height: 1.45;
  }

  li:first-child {
    border-top: none;
  }

  .keys {
    display: flex;
    flex-wrap: wrap;
    gap: 4px;
    align-items: center;
  }

  kbd {
    font-family: inherit;
    font-size: 12.5px;
    font-weight: 600;
    min-width: 22px;
    text-align: center;
    padding: 2px 7px;
    border-radius: 6px;
    background: var(--surface-2);
    border: 1px solid var(--border);
    border-bottom-width: 2px;
    color: var(--text);
  }

  .join {
    font-size: 12px;
    color: var(--text-faint);
  }

  .does {
    color: var(--text-dim);
  }

  .fine {
    font-size: 12.5px;
    line-height: 1.5;
    color: var(--text-faint);
    margin: 10px 0 0;
  }

  @media (max-width: 480px) {
    li {
      grid-template-columns: 1fr;
      gap: 3px;
    }
  }
</style>
