<script lang="ts">
  import { router } from './lib/router.svelte';
  import { app } from './lib/app.svelte';
  import TabBar from './components/TabBar.svelte';
  import Today from './screens/Today.svelte';
  import WeekMap from './screens/WeekMap.svelte';
  import Stats from './screens/Stats.svelte';
  import Settings from './screens/Settings.svelte';
  import Mentor from './screens/Mentor.svelte';
  import Review from './screens/Review.svelte';
  import Session from './screens/Session.svelte';
  import { update } from './lib/update.svelte';

  const route = $derived(router.route);

  // A deploy that lands while the app is open leaves this page running the old build.
  $effect(() => update.start());

  // Re-check the manifest when the app comes back to the foreground — that's the
  // moment a pushed week should appear, without needing a pull-to-refresh gesture
  // that standalone iOS doesn't reliably give us anyway.
  $effect(() => {
    const onVisible = () => {
      if (!app.ready) return;
      if (document.visibilityState === 'visible') {
        void app.refresh();
        // Pick up anything done on the other device while this one was away.
        void app.syncNow();
      } else {
        // Backgrounding is the last moment iOS reliably lets us run, so a pending
        // debounced push gets sent now rather than being lost with the process.
        void app.flushCloud();
      }
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => document.removeEventListener('visibilitychange', onVisible);
  });
</script>

{#if update.ready}
  <!-- Deliberately an offer, not an automatic reload: at this point there may be a
       half-written message in the composer, and taking it away to install an update
       nobody asked for is worse than waiting. -->
  <div class="update" role="status">
    <span>A newer version is ready.</span>
    <button onclick={() => update.reload()}>Reload</button>
  </div>
{/if}

<main>
  {#if route.name === 'session'}
    <Session weekId={route.weekId} dayId={route.dayId} step={route.step} />
  {:else if route.name === 'map'}
    <WeekMap />
  {:else if route.name === 'stats'}
    <Stats />
  {:else if route.name === 'mentor'}
    <Mentor />
  {:else if route.name === 'review'}
    <Review />
  {:else if route.name === 'settings'}
    <Settings />
  {:else}
    <Today />
  {/if}
</main>

{#if route.name !== 'session'}
  <TabBar />
{/if}

<style>
  /* Sits above the tab bar rather than over whatever is being read. */
  .update {
    position: fixed;
    left: 50%;
    transform: translateX(-50%);
    bottom: calc(var(--tab-h) + var(--safe-b) + 12px);
    z-index: 60;
    display: flex;
    align-items: center;
    gap: 12px;
    padding: 9px 10px 9px 15px;
    border-radius: 999px;
    background: var(--surface);
    border: 1px solid var(--border);
    box-shadow: 0 8px 28px rgba(0, 0, 0, 0.22);
    font-size: 13.5px;
    max-width: calc(100vw - 32px);
  }

  .update button {
    flex: none;
    padding: 5px 13px;
    border-radius: 999px;
    background: var(--accent);
    color: var(--accent-ink);
    font-size: 13.5px;
    font-weight: 600;
  }
</style>
