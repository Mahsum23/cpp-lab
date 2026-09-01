<script lang="ts">
  import { render } from '../lib/markdown';

  let { source }: { source: string | null | undefined } = $props();
  const html = $derived(render(source));
</script>

<!-- Content is authored in this repo and compiled by our own build script, so it
     is trusted input; there is no user-supplied markdown anywhere in the app. -->
<div class="prose">{@html html}</div>
