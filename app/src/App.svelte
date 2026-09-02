<script lang="ts">
  import { router } from './lib/router.svelte';
  import { app } from './lib/app.svelte';
  import TabBar from './components/TabBar.svelte';
  import Today from './screens/Today.svelte';
  import WeekMap from './screens/WeekMap.svelte';
  import Stats from './screens/Stats.svelte';
  import Settings from './screens/Settings.svelte';
  import Mentor from './screens/Mentor.svelte';
  import Session from './screens/Session.svelte';

  const route = $derived(router.route);

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

<main>
  {#if route.name === 'session'}
    <Session weekId={route.weekId} dayId={route.dayId} step={route.step} />
  {:else if route.name === 'map'}
    <WeekMap />
  {:else if route.name === 'stats'}
    <Stats />
  {:else if route.name === 'mentor'}
    <Mentor />
  {:else if route.name === 'settings'}
    <Settings />
  {:else}
    <Today />
  {/if}
</main>

{#if route.name !== 'session'}
  <TabBar />
{/if}
