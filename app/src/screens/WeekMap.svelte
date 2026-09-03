<script lang="ts">
  import { app } from '../lib/app.svelte';
  import { router, sessionPath } from '../lib/router.svelte';
  import Button from '../components/Button.svelte';

  let loading = $state<string | null>(null);

  const pending = $derived(
    (app.curriculum?.weeks ?? []).filter((ref) => app.sync.newWeeks.includes(ref.id)),
  );

  async function load(weekId: string) {
    loading = weekId;
    try {
      await app.downloadWeek(weekId);
    } finally {
      loading = null;
    }
  }

  function open(weekId: string, dayId: string) {
    router.go(sessionPath(weekId, dayId, 0));
  }
</script>

<div class="screen">
  <h1>The path</h1>
  <p class="sub">Tap a finished day to re-read it or re-drill the quiz.</p>

  {#each app.weeks as week}
    <section>
      <header>
        <h2>{week.title}</h2>
        <span class="count numeral">
          {app.weekProgress(week).done}/{week.days.length}
        </span>
      </header>
      {#if week.intro}
        <p class="intro">{week.intro}</p>
      {/if}

      <ol class="path">
        {#each week.days as day}
          {@const state = app.stateOf(day)}
          <li class={state}>
            <button
              class="node"
              disabled={state === 'upcoming' || state === 'locked'}
              onclick={() => open(week.id, day.id)}
            >
              <span class="dot" aria-hidden="true">
                {#if state === 'done'}
                  <svg viewBox="0 0 24 24"><path d="m5 13 4 4L19 7" /></svg>
                {:else if state === 'upcoming' || state === 'locked'}
                  <svg viewBox="0 0 24 24"
                    ><rect x="5" y="11" width="14" height="9" rx="2" /><path
                      d="M8 11V8a4 4 0 0 1 8 0v3"
                    /></svg
                  >
                {:else}
                  <em class="numeral">{day.day}</em>
                {/if}
              </span>
              <span class="body">
                <span class="title">Day {day.day} · {day.title}</span>
                {#if state === 'current'}
                  <span class="tag now">Today</span>
                {:else if day.teaser}
                  <span class="teaser">{day.teaser}</span>
                {/if}
              </span>
            </button>
          </li>
        {/each}
      </ol>

      {#if week.days.some((d) => d.status === 'upcoming')}
        <p class="pending">
          The locked ones aren't written yet — they land with the rest of their
          milestone, which is written once the previous one is done.
        </p>
      {/if}
    </section>
  {/each}

  {#each pending as ref}
    <div class="card newweek">
      <p class="spark">✨ {ref.title} available</p>
      <p class="meta">{ref.availableDays} of {ref.days} days written.</p>
      <Button
        size="sm"
        disabled={loading === ref.id}
        onclick={() => load(ref.id)}
      >
        {loading === ref.id ? 'Loading…' : 'Load week'}
      </Button>
    </div>
  {/each}

  {#if !app.weeks.length && app.ready}
    <p class="empty">{app.sync.message ?? 'Nothing loaded yet.'}</p>
  {/if}

  <div class="peek">
    <label>
      <input
        type="checkbox"
        checked={app.progress.settings.peekAhead}
        onchange={(e) => app.setPeekAhead(e.currentTarget.checked)}
      />
      <span>Let me jump ahead</span>
    </label>
    <p>Off by default so the rhythm stays one session a day. It's a nudge, not a rule.</p>
  </div>
</div>

<style>
  h1 {
    font-size: 27px;
    letter-spacing: -0.025em;
    margin-bottom: 4px;
  }

  .sub {
    color: var(--text-faint);
    font-size: 14px;
    margin: 0 0 26px;
  }

  section {
    margin-bottom: 30px;
  }

  section header {
    display: flex;
    align-items: baseline;
    justify-content: space-between;
    margin-bottom: 6px;
  }

  h2 {
    font-size: 17px;
  }

  .count {
    font-size: 13px;
    color: var(--text-faint);
  }

  .intro {
    font-size: 14px;
    line-height: 1.5;
    color: var(--text-dim);
    margin: 0 0 18px;
  }

  .path {
    list-style: none;
    margin: 0;
    padding: 0;
  }

  li {
    position: relative;
  }

  /* The connector between nodes — drawn from each node up to the previous one so
     the last item doesn't trail a line into nothing. */
  li + li::before {
    content: '';
    position: absolute;
    left: 17px;
    top: -14px;
    height: 28px;
    width: 2px;
    background: var(--border);
  }

  li.done + li.done::before,
  li.done + li.current::before {
    background: var(--accent);
  }

  .node {
    display: flex;
    align-items: center;
    gap: 13px;
    width: 100%;
    text-align: left;
    padding: 7px 4px;
    border-radius: 12px;
  }

  .node:disabled {
    cursor: default;
  }

  .dot {
    flex: none;
    width: 36px;
    height: 36px;
    border-radius: 50%;
    display: grid;
    place-items: center;
    border: 2px solid var(--border);
    background: var(--surface);
    color: var(--text-faint);
    font-size: 14px;
  }

  .dot svg {
    width: 16px;
    height: 16px;
    fill: none;
    stroke: currentColor;
    stroke-width: 2.2;
    stroke-linecap: round;
    stroke-linejoin: round;
  }

  li.done .dot {
    background: var(--accent);
    border-color: var(--accent);
    color: var(--accent-ink);
  }

  li.current .dot {
    border-color: var(--accent);
    color: var(--accent);
    animation: halo 2.4s ease-in-out infinite;
  }

  li.upcoming .dot,
  li.locked .dot {
    opacity: 0.55;
  }

  .body {
    display: flex;
    flex-direction: column;
    gap: 2px;
    min-width: 0;
  }

  .title {
    font-size: 15.5px;
    font-weight: 550;
  }

  li.upcoming .title,
  li.locked .title {
    color: var(--text-faint);
    font-weight: 500;
  }

  .teaser,
  .tag {
    font-size: 12.5px;
    color: var(--text-faint);
    line-height: 1.4;
  }

  .tag.now {
    color: var(--accent);
    font-weight: 700;
    letter-spacing: 0.05em;
    text-transform: uppercase;
    font-size: 11px;
  }

  .pending {
    font-size: 12.5px;
    line-height: 1.5;
    color: var(--text-faint);
    margin: 14px 0 0 49px;
  }

  .newweek {
    padding: 18px;
    text-align: center;
    border-style: dashed;
  }

  .spark {
    font-weight: 650;
    margin: 0 0 4px;
  }

  .newweek .meta {
    font-size: 13.5px;
    color: var(--text-faint);
    margin: 0 0 14px;
  }

  .empty {
    color: var(--text-faint);
    text-align: center;
    padding: 40px 0;
  }

  .peek {
    margin-top: 26px;
    padding-top: 18px;
    border-top: 1px solid var(--border);
  }

  .peek label {
    display: flex;
    align-items: center;
    gap: 10px;
    font-size: 15px;
    font-weight: 550;
  }

  .peek input {
    width: 20px;
    height: 20px;
    accent-color: var(--accent);
  }

  .peek p {
    font-size: 12.5px;
    color: var(--text-faint);
    margin: 6px 0 0 30px;
  }

  @keyframes halo {
    0%,
    100% {
      box-shadow: 0 0 0 0 color-mix(in srgb, var(--accent) 45%, transparent);
    }
    50% {
      box-shadow: 0 0 0 6px color-mix(in srgb, var(--accent) 0%, transparent);
    }
  }
</style>
