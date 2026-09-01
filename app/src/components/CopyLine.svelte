<script lang="ts">
  interface Props {
    text: string;
    label?: string;
  }
  let { text, label = 'Copy' }: Props = $props();
  let copied = $state(false);

  async function copy() {
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      // Safari refuses the async clipboard outside a few contexts; fall back to
      // the old execCommand path rather than silently doing nothing.
      const ta = document.createElement('textarea');
      ta.value = text;
      ta.style.position = 'fixed';
      ta.style.opacity = '0';
      document.body.append(ta);
      ta.select();
      document.execCommand('copy');
      ta.remove();
    }
    copied = true;
    setTimeout(() => (copied = false), 1600);
  }
</script>

<button class="copy" onclick={copy} aria-label="{label}: {text}">
  <code>{text}</code>
  <span class="icon" class:done={copied} aria-hidden="true">
    {#if copied}
      <svg viewBox="0 0 24 24"><path d="m5 13 4 4L19 7" /></svg>
    {:else}
      <svg viewBox="0 0 24 24"
        ><rect x="9" y="9" width="11" height="11" rx="2" /><path
          d="M5 15V5a2 2 0 0 1 2-2h8"
        /></svg
      >
    {/if}
  </span>
</button>

<style>
  .copy {
    display: flex;
    align-items: center;
    gap: 10px;
    width: 100%;
    text-align: left;
    background: var(--bg-elev);
    border: 1px solid var(--border);
    border-radius: 12px;
    padding: 11px 12px;
  }

  code {
    flex: 1;
    font-family: var(--font-mono);
    font-size: 12.5px;
    line-height: 1.5;
    color: var(--text-dim);
    overflow-x: auto;
    white-space: pre;
    -webkit-overflow-scrolling: touch;
  }

  .icon {
    flex: none;
    color: var(--text-faint);
  }

  .icon.done {
    color: var(--ok);
  }

  svg {
    width: 17px;
    height: 17px;
    fill: none;
    stroke: currentColor;
    stroke-width: 1.8;
    stroke-linecap: round;
    stroke-linejoin: round;
  }
</style>
