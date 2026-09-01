<script lang="ts">
  import { router } from '../lib/router.svelte';

  const tabs = [
    { name: 'today', label: 'Today', path: '/today', d: 'M4 5h16v15H4z M4 9h16 M8 3v4 M16 3v4' },
    { name: 'map', label: 'Map', path: '/map', d: 'M10 6h10 M10 12h10 M10 18h10 M5 6h.01 M5 12h.01 M5 18h.01' },
    { name: 'stats', label: 'Stats', path: '/stats', d: 'M5 20V11 M12 20V4 M19 20v-6' },
    { name: 'settings', label: 'Settings', path: '/settings', d: 'M4 7h16 M4 12h16 M4 17h16 M9 5v4 M15 10v4 M7 15v4' },
  ];

  const active = $derived(router.route.name);
</script>

<nav aria-label="Sections">
  {#each tabs as tab}
    <button
      class:active={active === tab.name}
      onclick={() => router.go(tab.path)}
      aria-current={active === tab.name ? 'page' : undefined}
    >
      <svg viewBox="0 0 24 24" aria-hidden="true"><path d={tab.d} /></svg>
      <span>{tab.label}</span>
    </button>
  {/each}
</nav>

<style>
  nav {
    position: fixed;
    inset: auto 0 0 0;
    z-index: 20;
    display: grid;
    grid-template-columns: repeat(4, 1fr);
    padding-bottom: var(--safe-b);
    background: color-mix(in srgb, var(--bg) 92%, transparent);
    /* Content scrolling under a translucent bar is the native-feeling detail. */
    backdrop-filter: saturate(180%) blur(20px);
    -webkit-backdrop-filter: saturate(180%) blur(20px);
    border-top: 1px solid var(--border);
  }

  button {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 3px;
    height: var(--tab-h);
    color: var(--text-faint);
    font-size: 10.5px;
    font-weight: 600;
    letter-spacing: 0.01em;
    transition: color 0.15s ease;
  }

  button.active {
    color: var(--accent);
  }

  svg {
    width: 21px;
    height: 21px;
    fill: none;
    stroke: currentColor;
    stroke-width: 1.7;
    stroke-linecap: round;
    stroke-linejoin: round;
  }
</style>
