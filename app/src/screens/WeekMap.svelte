<script lang="ts">
  import { app } from '../lib/app.svelte';
  import { router, sessionPath } from '../lib/router.svelte';
  import type { Day } from '../lib/types';

  /**
   * One path per track. Topics are dividers on it, never a unit that ends: there is no
   * "week" to clear and nothing to load, because new days arrive on their own.
   */
  const path = $derived(app.path);

  /** True for the first day of each topic, where its divider goes. */
  const startsTopic = (days: Day[], i: number) => i === 0 || days[i].topic !== days[i - 1].topic;
  const topicOf = (id?: string) => path?.topics?.find((t) => t.id === id) ?? null;

  function open(weekId: string, dayId: string) {
    router.go(sessionPath(weekId, dayId, 0));
  }

  // A path that grows on request gets long; land on today rather than on Day 1.
  $effect(() => {
    if (!path) return;
    queueMicrotask(() => document.querySelector('.path li.current')?.scrollIntoView({ block: 'center' }));
  });
</script>

<div class="screen">
  <h1>{path?.title ?? 'The path'}</h1>
  <p class="sub">Tap a finished day to re-read it or re-drill the quiz.</p>

  {#if path}
    {#if path.intro}
      <p class="intro">{path.intro}</p>
    {/if}

    <ol class="path">
      {#each path.days as day, i}
        {@const state = app.stateOf(day)}
        {#if startsTopic(path.days, i) && topicOf(day.topic)}
          {@const topic = topicOf(day.topic)!}
          <li class="topic">
            <h2>{topic.title}</h2>
            {#if topic.intro}<p>{topic.intro}</p>{/if}
          </li>
        {/if}
        <li class={state}>
          <button
            class="node"
            disabled={state === 'upcoming' || state === 'locked'}
            onclick={() => open(path.id, day.id)}
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

    {#if path.days.some((d) => d.status === 'upcoming')}
      <p class="pending">The locked ones are planned but not written yet.</p>
    {/if}

    <!-- What comes next on this track, in plain words, when a plan exists. -->
    {#if path.next?.length}
      <section class="ahead">
        <h2>Coming up</h2>
        <ul>
          {#each path.next as item}<li>{item}</li>{/each}
        </ul>
      </section>
    {/if}
  {/if}

  {#if !app.trackWeeks.length && app.ready}
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

  .path li {
    position: relative;
  }

  /* The connector between nodes — drawn from each node up to the previous one so
     the last item doesn't trail a line into nothing. */
  .path li + li::before {
    content: '';
    position: absolute;
    left: 17px;
    top: -14px;
    height: 28px;
    width: 2px;
    background: var(--border);
  }

  .path li.done + li.done::before,
  .path li.done + li.current::before {
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

  .path li.done .dot {
    background: var(--accent);
    border-color: var(--accent);
    color: var(--accent-ink);
  }

  .path li.current .dot {
    border-color: var(--accent);
    color: var(--accent);
    animation: halo 2.4s ease-in-out infinite;
  }

  .path li.upcoming .dot,
  .path li.locked .dot {
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

  .path li.upcoming .title,
  .path li.locked .title {
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

  /* A divider is not a step: no connector into it, and none from it to the next day. */
  .path li.topic::before,
  .path li.topic + li::before {
    display: none;
  }

  .path li.topic {
    padding: 22px 0 6px;
  }

  .path li.topic h2 {
    font-size: 12px;
    font-weight: 700;
    letter-spacing: 0.075em;
    text-transform: uppercase;
    color: var(--text-faint);
    margin: 0 0 6px;
  }

  .path li.topic p {
    font-size: 13.5px;
    line-height: 1.5;
    color: var(--text-dim);
    margin: 0;
  }

  .ahead {
    margin-top: 26px;
    padding: 16px;
    border: 1px dashed var(--border);
    border-radius: 14px;
  }

  .ahead h2 {
    font-size: 16px;
    margin: 0 0 8px;
  }

  .ahead ul {
    margin: 0;
    padding-left: 18px;
    font-size: 14px;
    line-height: 1.55;
    color: var(--text-dim);
  }


  .pending {
    font-size: 12.5px;
    line-height: 1.5;
    color: var(--text-faint);
    margin: 14px 0 0 49px;
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
