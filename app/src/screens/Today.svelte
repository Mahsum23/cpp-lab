<script lang="ts">
  import { app } from '../lib/app.svelte';
  import { router, sessionPath } from '../lib/router.svelte';
  import Button from '../components/Button.svelte';
  import ProgressRing from '../components/ProgressRing.svelte';
  import Flame from '../components/Flame.svelte';

  const current = $derived(app.current);
  const week = $derived(current?.week ?? app.weeks[0] ?? null);
  const wp = $derived(week ? app.weekProgress(week) : { done: 0, total: 0 });
  const segs = $derived(current ? app.segments(current.day, current.week.id) : [false, false, false]);
  const started = $derived(segs.some(Boolean));

  /** Where "Continue" should drop him: the first step he hasn't closed. */
  const resumeStep = $derived(segs.findIndex((s) => !s) === -1 ? 2 : segs.findIndex((s) => !s));

  function start() {
    if (!current) return;
    router.go(sessionPath(current.week.id, current.day.id, resumeStep));
  }
</script>

<div class="screen">
  <header>
    <button class="streak" onclick={() => router.go('/stats')} aria-label="Streak: {app.streakCount} days">
      <Flame count={app.streakCount} atRisk={app.streakAtRisk} />
    </button>
    <h1>cpp-lab</h1>
    <button class="gear" onclick={() => router.go('/settings')} aria-label="Settings">
      <svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="3.2" /><path
          d="M19.4 15a1.6 1.6 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.6 1.6 0 0 0-2.7 1.1V21a2 2 0 1 1-4 0v-.1A1.6 1.6 0 0 0 7.5 19.4a1.6 1.6 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.6 1.6 0 0 0-1.1-2.7H1.7a2 2 0 1 1 0-4h.1A1.6 1.6 0 0 0 3.3 7.5a1.6 1.6 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.6 1.6 0 0 0 1.8.3 1.6 1.6 0 0 0 1-1.5V1.7a2 2 0 1 1 4 0v.1a1.6 1.6 0 0 0 2.7 1.1l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.6 1.6 0 0 0-.3 1.8v.1a1.6 1.6 0 0 0 1.5 1h.2a2 2 0 1 1 0 4h-.1a1.6 1.6 0 0 0-1.5 1Z"
          transform="translate(1.2 1.2) scale(0.9)"
        /></svg>
    </button>
  </header>


  <!-- Deliberately above the lesson: the deck's whole job is to catch you before you
       move on to new material, not to wait politely underneath it. Spent for the day
       the moment the deck is opened. -->
  {#if app.ready && app.ambush}
    <button class="ambush" onclick={() => router.go('/review')}>
      <span class="glyph" aria-hidden="true">
        <svg viewBox="0 0 24 24"><path d="M3 12a9 9 0 1 0 3-6.7M3 4v5h5" /></svg>
      </span>
      <span class="lines">
        <strong>Before you start — one from before</strong>
        <em>
          {#if app.dueNow.length === 1}1 card is due{:else if app.dueNow.length}{app.dueNow.length} cards are due{:else}A surprise one, nothing's actually due{/if}
        </em>
      </span>
      <svg class="chev" viewBox="0 0 24 24"><path d="m9 6 6 6-6 6" /></svg>
    </button>
  {/if}

  {#if !app.ready}
    <div class="card skeleton" aria-busy="true"></div>
  {:else if !week}
    <div class="card empty">
      <h2>No curriculum loaded</h2>
      <p>{app.sync.message ?? 'Pull down or reopen the app once you have a connection.'}</p>
      <Button variant="secondary" onclick={() => app.refresh()}>Try again</Button>
    </div>
  {:else if app.completedToday}
    <!-- "Done today" outranks everything: whether or not a next day exists, the
         answer to "what am I doing right now" is nothing, and that's the point. -->
    <p class="context">{week.title}</p>
    <article class="card hero done">
      <div class="check" aria-hidden="true">
        <svg viewBox="0 0 24 24"><path d="m5 13 4 4L19 7" /></svg>
      </div>
      <h2>Done today</h2>
      {#if current}
        <p class="meta">See you tomorrow. Day {current.day.day} — {current.day.title} — is next.</p>
        <div class="soft">
          <Button variant="secondary" size="sm" onclick={() => router.go('/map')}>Review a past day</Button>
          <Button variant="ghost" size="sm" onclick={start}>Peek ahead</Button>
        </div>
      {:else}
        <p class="meta">
          And that's every written day in {week.title}. The next one lands when it's
          written — the map will say so.
        </p>
        <div class="soft">
          <Button variant="secondary" size="sm" onclick={() => router.go('/map')}>Review a past day</Button>
        </div>
      {/if}
    </article>
  {:else if current}
    <p class="context">{week.title} · Milestone {week.milestone.split('-')[0]}</p>

    <article class="card hero">
      <div class="top">
        <div>
          <p class="eyebrow">Day {current.day.day}</p>
          <h2>{current.day.title}</h2>
          <p class="meta">~{current.day.estMinutes} min · theory · quiz · task</p>
        </div>
        <ProgressRing segments={segs} />
      </div>

      {#if current.day.teaser && !started}
        <p class="teaser">{current.day.teaser}</p>
      {/if}

      <Button full onclick={start}>
        {started ? 'Continue' : 'Start'}
        <svg class="arrow" viewBox="0 0 24 24"><path d="M5 12h14m-6-6 6 6-6 6" /></svg>
      </Button>
    </article>
  {:else}
    <p class="context">{week.title}</p>
    <article class="card hero done">
      <div class="check" aria-hidden="true">
        <svg viewBox="0 0 24 24"><path d="m5 13 4 4L19 7" /></svg>
      </div>
      <h2>Week clear</h2>
      <p class="meta">
        Every written day in {week.title} is done. The next one lands when it's written —
        the map will say so.
      </p>
      <Button variant="secondary" onclick={() => router.go('/map')}>Open the map</Button>
    </article>
  {/if}


  <!-- The gap this feature exists for: theory and quiz are done, the task needs a
       machine that isn't in your pocket, and the phone would otherwise have nothing
       to offer for the rest of the day. -->
  {#if app.ready && !app.ambush && (app.taskParked || app.deck.length)}
    <button
      class="strip"
      class:parked={app.taskParked || app.dueNow.length > 0}
      onclick={() => router.go(app.dueNow.length ? '/review' : '/review/practice')}
    >
      <span class="lines">
        <strong>
          {#if app.taskParked}Task's waiting on a compiler{:else if app.dueNow.length === 1}1 card due{:else if app.dueNow.length}{app.dueNow.length} cards due{:else}Nothing due — practise anyway{/if}
        </strong>
        <em>
          {#if app.taskParked && app.dueNow.length}Review {app.dueNow.length} from earlier days while you wait{:else if app.taskParked}Review something from an earlier day while you wait{:else if app.dueNow.length}From days you finished a while ago{:else}Answering early can't push a card further out{/if}
        </em>
      </span>
      <svg class="chev" viewBox="0 0 24 24"><path d="m9 6 6 6-6 6" /></svg>
    </button>
  {/if}

  {#if week}
    <section class="weekbar">
      <div class="labels">
        <span>{week.title}</span>
        <span class="numeral">{wp.done}/{wp.total}</span>
      </div>
      <div class="bar" role="img" aria-label="{wp.done} of {wp.total} days done">
        {#each { length: wp.total } as _, i}
          <span class:filled={i < wp.done}></span>
        {/each}
      </div>
    </section>
  {/if}

  {#if app.sync.status === 'offline'}
    <p class="note">Offline — showing the weeks you've already loaded.</p>
  {:else if app.sync.newWeeks.length}
    <button class="note new" onclick={() => router.go('/map')}>
      ✨ Week {app.sync.newWeeks.length > 1 ? 's' : ''} available — open the map to load
    </button>
  {/if}
</div>

<style>
  /* Loud on purpose — it is the one thing on the screen that interrupts. */
  .ambush,
  .strip {
    display: flex;
    align-items: center;
    gap: 12px;
    width: 100%;
    text-align: left;
    padding: 13px 14px;
    border-radius: 15px;
    margin-bottom: 14px;
    border: 1px solid var(--accent);
    background: var(--accent-soft);
    color: var(--text);
  }

  .strip {
    border-color: var(--border);
    background: var(--surface);
    margin: 14px 0 0;
  }

  .strip.parked {
    border-color: var(--accent);
    background: var(--accent-soft);
  }

  .ambush .glyph svg {
    width: 21px;
    height: 21px;
    fill: none;
    stroke: var(--accent);
    stroke-width: 2;
    stroke-linecap: round;
    stroke-linejoin: round;
  }

  .lines {
    flex: 1;
    min-width: 0;
    display: grid;
    gap: 2px;
  }

  .lines strong {
    font-size: 14.5px;
    font-weight: 650;
  }

  .lines em {
    font-style: normal;
    font-size: 13px;
    color: var(--text-faint);
  }

  .chev {
    flex: none;
    width: 18px;
    height: 18px;
    fill: none;
    stroke: var(--text-faint);
    stroke-width: 2;
    stroke-linecap: round;
    stroke-linejoin: round;
  }

  header {
    display: grid;
    grid-template-columns: 1fr auto 1fr;
    align-items: center;
    margin-bottom: 22px;
  }

  h1 {
    font-size: 15px;
    font-weight: 600;
    letter-spacing: 0.02em;
    color: var(--text-dim);
    text-align: center;
  }

  .streak {
    justify-self: start;
  }

  .gear {
    justify-self: end;
    color: var(--text-faint);
  }

  .gear svg {
    width: 21px;
    height: 21px;
    fill: none;
    stroke: currentColor;
    stroke-width: 1.7;
    stroke-linecap: round;
    stroke-linejoin: round;
  }

  .context {
    font-size: 13px;
    font-weight: 600;
    color: var(--text-faint);
    margin: 0 0 10px 2px;
    letter-spacing: 0.01em;
  }

  .hero {
    padding: 20px;
  }

  .top {
    display: flex;
    align-items: flex-start;
    justify-content: space-between;
    gap: 16px;
    margin-bottom: 16px;
  }

  .hero h2 {
    font-size: 24px;
    margin: 3px 0 6px;
    letter-spacing: -0.02em;
  }

  .meta {
    font-size: 13.5px;
    color: var(--text-faint);
    margin: 0;
  }

  .teaser {
    font-size: 15px;
    color: var(--text-dim);
    line-height: 1.5;
    margin: 0 0 18px;
    padding-top: 14px;
    border-top: 1px solid var(--border);
  }

  .arrow {
    width: 18px;
    height: 18px;
    fill: none;
    stroke: currentColor;
    stroke-width: 2;
    stroke-linecap: round;
    stroke-linejoin: round;
  }

  .done {
    text-align: center;
  }

  .done h2 {
    margin-bottom: 8px;
  }

  .done .meta {
    margin-bottom: 18px;
    line-height: 1.5;
  }

  .check {
    width: 46px;
    height: 46px;
    margin: 2px auto 14px;
    display: grid;
    place-items: center;
    border-radius: 50%;
    background: var(--ok-soft);
    color: var(--ok);
  }

  .check svg {
    width: 24px;
    height: 24px;
    fill: none;
    stroke: currentColor;
    stroke-width: 2.4;
    stroke-linecap: round;
    stroke-linejoin: round;
  }

  .soft {
    display: flex;
    gap: 8px;
    justify-content: center;
    flex-wrap: wrap;
  }

  .weekbar {
    margin-top: 24px;
  }

  .labels {
    display: flex;
    justify-content: space-between;
    font-size: 12.5px;
    color: var(--text-faint);
    margin-bottom: 7px;
    font-weight: 600;
  }

  .bar {
    display: flex;
    gap: 4px;
  }

  .bar span {
    flex: 1;
    height: 7px;
    border-radius: 4px;
    background: var(--surface-2);
    border: 1px solid var(--border);
    transition: background 0.3s ease;
  }

  .bar span.filled {
    background: var(--accent);
    border-color: transparent;
  }

  .note {
    display: block;
    width: 100%;
    text-align: center;
    margin-top: 20px;
    font-size: 13.5px;
    color: var(--text-faint);
  }

  .note.new {
    color: var(--accent);
    font-weight: 600;
  }

  .empty {
    padding: 26px 20px;
    text-align: center;
  }

  .empty h2 {
    font-size: 19px;
    margin-bottom: 6px;
  }

  .empty p {
    color: var(--text-dim);
    font-size: 14.5px;
    margin: 0 0 16px;
  }

  .skeleton {
    height: 210px;
    background: linear-gradient(90deg, var(--surface) 25%, var(--surface-2) 50%, var(--surface) 75%);
    background-size: 200% 100%;
    animation: shimmer 1.4s linear infinite;
  }

  @keyframes shimmer {
    to {
      background-position: -200% 0;
    }
  }
</style>
