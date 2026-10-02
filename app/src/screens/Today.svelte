<script lang="ts">
  import { app } from '../lib/app.svelte';
  import { router, sessionPath } from '../lib/router.svelte';
  import Button from '../components/Button.svelte';
  import ProgressRing from '../components/ProgressRing.svelte';
  import Flame from '../components/Flame.svelte';
  import { TRACKS, type Track } from '../lib/types';

  import MoreLessons from '../components/MoreLessons.svelte';
  import { LAND_AT, practiceStatus, ROUND_SIZE } from '../lib/practice';

  const current = $derived(app.current);
  // One path per track. Track-scoped, so a subject that hasn't loaded yet never shows
  // the other subject's path in its header.
  const week = $derived(app.path);
  const topic = $derived(current ? app.topicTitle(current.day) : null);
  /** Days written so far on this track, and how many are finished. */
  const written = $derived(app.availableDays.length);
  const finished = $derived(written - app.runway);
  const arrived = $derived(app.sync.newDays[app.track] ?? 0);
  /** Two days of runway is the moment to ask: a request takes a day to turn round. */
  const RUNWAY_WARN = 2;
  const segs = $derived(current ? app.segments(current.day, current.week.id) : [false, false, false]);
  const started = $derived(segs.some(Boolean));

  /** Where "Continue" should drop him: the first step he hasn't closed. */
  const resumeStep = $derived(segs.findIndex((s) => !s) === -1 ? 2 : segs.findIndex((s) => !s));

  /** A concept that has not landed yet: today is a practice round, not a new lesson. */
  const practising = $derived(app.practising);
  const pst = $derived(
    practising ? practiceStatus(practising.day, app.progress.days[practising.day.id]?.practice) : null,
  );

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
    <h1>slowpath</h1>
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

  {#if app.ready && app.tracks.length > 1}
    <!-- Only rendered when a second subject actually exists, so a single-track install
         never carries a control with one option in it. -->
    <div class="tracks" role="group" aria-label="Subject">
      {#each app.tracks as t}
        <button class:on={app.track === t} onclick={() => void app.setTrack(t)} aria-pressed={app.track === t}>
          {TRACKS[t as Track].label}
        </button>
      {/each}
    </div>
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
    <p class="context">{topic ? `${week.title} · ${topic}` : week.title}</p>
    <article class="card hero done">
      <div class="check" aria-hidden="true">
        <svg viewBox="0 0 24 24"><path d="m5 13 4 4L19 7" /></svg>
      </div>
      <h2>Done today</h2>
      {#if practising}
        <p class="meta">
          See you tomorrow, for another round on {practising.day.title}. The next lesson opens when it lands.
        </p>
        <div class="soft">
          <Button variant="secondary" size="sm" onclick={() => router.go(`/review/round/${practising.day.id}`)}>One more round now</Button>
        </div>
      {:else if current}
        <p class="meta">See you tomorrow. Day {current.day.day} — {current.day.title} — is next.</p>
        <div class="soft">
          <Button variant="secondary" size="sm" onclick={() => router.go('/map')}>Review a past day</Button>
          <Button variant="ghost" size="sm" onclick={start}>Peek ahead</Button>
        </div>
      {:else}
        <p class="meta">
          And that's every written day of {week.title}. New lessons are written on request,
          so this is the moment to ask for the next ones.
        </p>
        <MoreLessons />
      {/if}
    </article>
    {#if current && app.runway <= RUNWAY_WARN}
      <MoreLessons compact />
    {/if}
  {:else if practising && pst}
    <p class="context">{week.title} · practice</p>
    <article class="card hero">
      <div class="top">
        <div>
          <p class="eyebrow">Practice · Day {practising.day.day}</p>
          <h2>{practising.day.title}</h2>
          <p class="meta">~20 min · {ROUND_SIZE} questions · mostly writing from memory</p>
        </div>
      </div>
      <p class="teaser">
        {#if pst.last === null}
          No new theory today. Fresh questions on the same ground, until it sticks — a round of
          {Math.round(LAND_AT * 100)}% right first time lands it and opens the next lesson.
        {:else}
          Round {pst.rounds + 1}. Last round {Math.round(pst.last * 100)}% right first time; it lands at
          {Math.round(LAND_AT * 100)}%. {pst.fresh ? `${pst.fresh} questions you haven't seen yet.` : `You've seen them all — this round goes back over the ${pst.missed} you missed.`}
        {/if}
      </p>
      <Button full onclick={() => router.go(`/review/round/${practising.day.id}`)}>
        Start the round
        <svg class="arrow" viewBox="0 0 24 24"><path d="M5 12h14m-6-6 6 6-6 6" /></svg>
      </Button>
      {#if current}
        <p class="nextup">
          Next lesson: Day {current.day.day} — {current.day.title}.
          <button class="link" onclick={() => void app.moveOn(practising.day, practising.week.id)}>Move on anyway</button>
        </p>
      {/if}
    </article>
  {:else if current}
    <p class="context">{topic ? `${week.title} · ${topic}` : week.title}</p>

    <article class="card hero">
      <div class="top">
        <div>
          <p class="eyebrow">Day {current.day.day}</p>
          <h2>{current.day.title}</h2>
          <p class="meta">
            ~{current.day.estMinutes} min · theory · quiz · {current.day.drill?.length ? 'drill' : 'task'}
          </p>
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
    {#if app.runway <= RUNWAY_WARN}
      <MoreLessons compact />
    {/if}
  {:else}
    <p class="context">{week.title}</p>
    <article class="card hero done">
      <div class="check" aria-hidden="true">
        <svg viewBox="0 0 24 24"><path d="m5 13 4 4L19 7" /></svg>
      </div>
      <h2>All caught up</h2>
      <p class="meta">
        Every written day of {week.title} is done — {finished} of them. New lessons are
        written on request, so ask for the next ones and they will appear here on their own.
      </p>
      <MoreLessons />
    </article>
  {/if}


  <!-- The counterweight to letting a day's ring close from a phone. Lab work stopped
       gating the day, so it has to be visible somewhere you cannot miss it. -->
  {#if app.ready && app.labQueue.length}
    <button
      class="lab"
      onclick={() => router.go(sessionPath(app.labQueue[0].week.id, app.labQueue[0].day.id, 2))}
    >
      <span class="labcount numeral">{app.labQueue.length}</span>
      <span class="labtext">
        <strong>
          {app.labQueue.length === 1 ? 'One task' : `${app.labQueue.length} tasks`} waiting for a machine
        </strong>
        <em>./lab in the repo opens the oldest — {app.labQueue[0].day.title}</em>
      </span>
    </button>
  {/if}

  {#if app.ready && !app.ambush && app.deck.length}
    <button
      class="strip"
      class:parked={app.dueNow.length > 0}
      onclick={() => router.go(app.dueNow.length ? '/review' : '/review/practice')}
    >
      <span class="lines">
        <!-- This strip used to lead with "Task's waiting on a compiler", from when a
             parked task was the only thing the phone could tell you about. The lab
             queue above says that now, and better, so this one is about review again. -->
        <strong>
          {#if app.dueNow.length === 1}1 card due{:else if app.dueNow.length}{app.dueNow.length} cards due{:else}Nothing due — practise anyway{/if}
        </strong>
        <em>
          {#if app.dueNow.length}From days you finished a while ago{:else}Answering early can't push a card further out{/if}
        </em>
      </span>
      <svg class="chev" viewBox="0 0 24 24"><path d="m9 6 6 6-6 6" /></svg>
    </button>
  {/if}

  {#if week && written}
    <!-- The whole track, not a week of it. One continuous bar rather than a segment per
         day: a path that grows on request would outgrow segments within a month. -->
    <button class="trackbar" onclick={() => router.go('/map')}>
      <div class="labels">
        <span>{week.title}</span>
        <span class="numeral">{finished} of {written} days</span>
      </div>
      <div class="bar" role="img" aria-label="{finished} of {written} written days done">
        <span style="width: {(100 * finished) / written}%"></span>
      </div>
    </button>
  {/if}

  {#if app.sync.status === 'offline'}
    <p class="note">Offline — showing the lessons you already have.</p>
  {:else if arrived}
    <button class="note new" onclick={() => router.go('/map')}>
      ✨ {arrived === 1 ? 'A new day' : `${arrived} new days`} in {week?.title ?? 'this track'} — see the map
    </button>
  {/if}
</div>

<style>
  /* Deliberately quieter than the review strip: a reminder, not a reprimand. */
  .lab {
    display: flex;
    align-items: center;
    gap: 12px;
    width: 100%;
    text-align: left;
    padding: 12px 14px;
    margin-bottom: 12px;
    border-radius: 14px;
    background: var(--surface);
    border: 1px solid var(--border);
  }

  .lab:active {
    background: var(--surface-2);
  }

  .labcount {
    flex: none;
    width: 30px;
    height: 30px;
    display: grid;
    place-items: center;
    border-radius: 9px;
    background: var(--surface-2);
    color: var(--text-dim);
    font-size: 14px;
    font-weight: 700;
  }

  .labtext {
    display: grid;
    gap: 2px;
    min-width: 0;
  }

  .labtext strong {
    font-size: 14px;
    font-weight: 650;
  }

  .labtext em {
    font-style: normal;
    font-size: 12.5px;
    color: var(--text-faint);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  /* Sits above everything: which subject you're on changes what the whole screen means. */
  .tracks {
    display: flex;
    gap: 4px;
    padding: 4px;
    margin-bottom: 16px;
    border-radius: 999px;
    background: var(--surface-2);
    border: 1px solid var(--border);
  }

  .tracks button {
    flex: 1;
    padding: 7px 12px;
    border-radius: 999px;
    font-size: 14px;
    font-weight: 600;
    color: var(--text-faint);
  }

  .tracks button.on {
    background: var(--bg-elev, var(--surface));
    color: var(--text);
    box-shadow: 0 1px 3px rgba(0, 0, 0, 0.12);
  }

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

  .trackbar {
    display: block;
    width: 100%;
    text-align: left;
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
    height: 7px;
    border-radius: 4px;
    background: var(--surface-2);
    border: 1px solid var(--border);
    overflow: hidden;
  }

  .bar span {
    display: block;
    height: 100%;
    background: var(--accent);
    transition: width 0.3s ease;
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
  .nextup {
    margin: 12px 0 0;
    font-size: 13px;
    line-height: 1.5;
    color: var(--text-faint);
  }

  .nextup .link {
    background: none;
    border: 0;
    padding: 0;
    font: inherit;
    font-weight: 600;
    color: var(--accent);
    cursor: pointer;
  }
</style>
