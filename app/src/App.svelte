<script lang="ts">
  import { router } from './lib/router.svelte';
  import { app } from './lib/app.svelte';
  import TabBar from './components/TabBar.svelte';
  import Today from './screens/Today.svelte';
  import WeekMap from './screens/WeekMap.svelte';
  import Stats from './screens/Stats.svelte';
  import Settings from './screens/Settings.svelte';
  import Session from './screens/Session.svelte';

  const route = $derived(router.route);

  // Re-check the manifest when the app comes back to the foreground — that's the
  // moment a pushed week should appear, without needing a pull-to-refresh gesture
  // that standalone iOS doesn't reliably give us anyway.
  $effect(() => {
    const onVisible = () => {
      if (document.visibilityState === 'visible' && app.ready) void app.refresh();
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
  {:else if route.name === 'settings'}
    <Settings />
  {:else}
    <Today />
  {/if}
</main>

{#if route.name !== 'session'}
  <TabBar />
{/if}
