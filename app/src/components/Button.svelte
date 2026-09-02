<script lang="ts">
  import type { Snippet } from 'svelte';

  interface Props {
    variant?: 'primary' | 'secondary' | 'ghost' | 'danger';
    size?: 'md' | 'sm';
    full?: boolean;
    disabled?: boolean;
    href?: string;
    /** Opens in a new tab. Standalone PWAs have no back button, so an in-app
     *  navigation to an external site is a one-way trip. */
    external?: boolean;
    onclick?: (e: MouseEvent) => void;
    children: Snippet;
  }

  let {
    variant = 'primary',
    size = 'md',
    full = false,
    disabled = false,
    href,
    external = false,
    onclick,
    children,
  }: Props = $props();
</script>

{#if href}
  <a
    class="btn {variant} {size}"
    class:full
    {href}
    target={external ? '_blank' : undefined}
    rel={external ? 'noreferrer' : undefined}
    aria-disabled={disabled}>{@render children()}</a>
{:else}
  <button class="btn {variant} {size}" class:full {disabled} {onclick}>{@render children()}</button>
{/if}

<style>
  .btn {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: 8px;
    border-radius: 12px;
    font-weight: 600;
    letter-spacing: -0.01em;
    text-decoration: none;
    /* 48px clears Apple's 44pt target with room for a thumb in a hurry. */
    min-height: 48px;
    padding: 0 20px;
    transition:
      transform 0.12s ease,
      background 0.15s ease,
      opacity 0.15s ease;
  }

  .btn.sm {
    min-height: 38px;
    padding: 0 14px;
    font-size: 14.5px;
    border-radius: 10px;
  }

  .btn.full {
    width: 100%;
  }

  .btn:active:not(:disabled) {
    transform: scale(0.975);
  }

  .btn:disabled,
  .btn[aria-disabled='true'] {
    opacity: 0.45;
    pointer-events: none;
  }

  .primary {
    background: var(--accent);
    color: var(--accent-ink);
  }

  .secondary {
    background: var(--surface-2);
    color: var(--text);
    border: 1px solid var(--border);
  }

  .ghost {
    color: var(--text-dim);
  }

  .ghost:active {
    background: var(--surface-2);
  }

  .danger {
    background: var(--bad-soft);
    color: var(--bad);
    border: 1px solid color-mix(in srgb, var(--bad) 30%, transparent);
  }
</style>
