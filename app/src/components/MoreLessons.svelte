<script lang="ts">
  /**
   * The path has run short: say so, and make asking for more a single tap.
   *
   * Lessons are written on request, so running out is the normal end of a stretch rather
   * than a finish line. The button copies a ready-made request — which track, the last
   * day finished, what the plan says comes next — to paste to whoever writes the lessons.
   */
  import { app } from '../lib/app.svelte';
  import Button from './Button.svelte';

  interface Props {
    /** Short when shown as a heads-up under the day's card. */
    compact?: boolean;
    /** Say what is planned next. Off where the plan is already listed. */
    showNext?: boolean;
  }
  let { compact = false, showNext = true }: Props = $props();
  let copied = $state(false);

  async function copy() {
    const text = app.moreRequest();
    try {
      await navigator.clipboard.writeText(text);
    } catch {
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
    setTimeout(() => (copied = false), 2000);
  }
</script>

{#if compact}
  <div class="runway">
    <p>
      <strong>{app.runway === 1 ? 'This is the last written day' : `${app.runway} written days left`}</strong>
      in {app.path?.title ?? 'this track'}. Ask for the next lessons before you run out.
    </p>
    <button class="link" onclick={copy}>{copied ? 'Request copied ✓' : 'Copy the request'}</button>
  </div>
{:else}
  <Button onclick={copy}>{copied ? 'Copied ✓ — paste it to ask' : 'Copy a request for new lessons'}</Button>
  {#if showNext && app.path?.next?.length}
    <p class="next">Planned next: {app.path.next[0]}</p>
  {/if}
{/if}

<style>
  .runway {
    margin-top: 16px;
    padding: 12px 14px;
    border-radius: 12px;
    border: 1px dashed var(--border);
    font-size: 13.5px;
    line-height: 1.5;
    color: var(--text-dim);
  }

  .runway p {
    margin: 0 0 6px;
  }

  .link {
    font-size: 13.5px;
    font-weight: 600;
    color: var(--accent);
    text-decoration: underline;
  }

  .next {
    margin: 12px 0 0;
    font-size: 13px;
    color: var(--text-faint);
  }
</style>
