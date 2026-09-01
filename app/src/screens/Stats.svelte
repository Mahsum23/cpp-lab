<script lang="ts">
  import { app } from '../lib/app.svelte';
  import { router, sessionPath } from '../lib/router.svelte';
  import { BADGES } from '../lib/badges';
  import { levelOf, levelProgress } from '../lib/xp';
  import Flame from '../components/Flame.svelte';
  import { formatDate, localDateOf } from '../lib/date';

  const lp = $derived(levelProgress(app.progress.xp));
  const earned = $derived(app.progress.badges);
</script>

<div class="screen">
  <h1>Progress</h1>

  <div class="tiles">
    <div class="card tile">
      <Flame count={app.streakCount} atRisk={app.streakAtRisk} size={26} />
      <span class="lbl">day streak</span>
      {#if app.progress.streak.freezes > 0}
        <span class="chip">{app.progress.streak.freezes} freeze{app.progress.streak.freezes > 1 ? 's' : ''} banked</span>
      {/if}
    </div>
    <div class="card tile">
      <span class="numeral big">{app.daysDone}</span>
      <span class="lbl">sessions done</span>
    </div>
    <div class="card tile">
      <span class="numeral big">{app.progress.xp}</span>
      <span class="lbl">XP · level {levelOf(app.progress.xp)}</span>
      <div class="xpbar"><span style:width="{lp.pct}%"></span></div>
    </div>
    <div class="card tile">
      <span class="numeral big">{app.progress.streak.longest}</span>
      <span class="lbl">longest streak</span>
    </div>
  </div>

  {#if app.streakAtRisk}
    <p class="risk">One session today keeps the run alive. That's the whole ask.</p>
  {/if}

  <h2>Badges</h2>
  <div class="badges">
    {#each BADGES as badge}
      {@const has = Boolean(earned[badge.id])}
      <div class="card badge" class:locked={!has}>
        <span class="glyph">{has ? badge.glyph : '·'}</span>
        <div>
          <strong>{badge.name}</strong>
          <p>{has ? badge.blurb : 'Not yet.'}</p>
          {#if has}
            <span class="when">{formatDate(localDateOf(earned[badge.id]))}</span>
          {/if}
        </div>
      </div>
    {/each}
  </div>

  <h2>What confused you</h2>
  {#if app.notedDays.length}
    <p class="sub">
      The honest column. Green checkmarks are not the point of this — these are.
    </p>
    <div class="notes">
      {#each app.notedDays as n}
        <button class="card note" onclick={() => router.go(sessionPath(n.week.id, n.day.id, 0))}>
          <span class="day">Day {n.day.day} · {n.day.title}</span>
          <p>{n.notes}</p>
        </button>
      {/each}
    </div>
  {:else}
    <p class="sub">
      Nothing logged yet. Write what tripped you up in the task step — it's worth more
      later than the fact you finished.
    </p>
  {/if}
</div>

<style>
  h1 {
    font-size: 27px;
    letter-spacing: -0.025em;
    margin-bottom: 20px;
  }

  h2 {
    font-size: 16px;
    margin: 30px 0 12px;
  }

  .sub {
    font-size: 14px;
    color: var(--text-faint);
    line-height: 1.5;
    margin: -4px 0 14px;
  }

  .tiles {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 10px;
  }

  .tile {
    padding: 16px;
    display: flex;
    flex-direction: column;
    gap: 3px;
    align-items: flex-start;
  }

  .big {
    font-size: 27px;
    line-height: 1.1;
  }

  .lbl {
    font-size: 11.5px;
    font-weight: 600;
    letter-spacing: 0.06em;
    text-transform: uppercase;
    color: var(--text-faint);
  }

  .chip {
    margin-top: 6px;
    font-size: 11.5px;
    background: var(--surface-2);
    border-radius: 999px;
    padding: 3px 9px;
    color: var(--text-dim);
  }

  .xpbar {
    width: 100%;
    height: 5px;
    background: var(--surface-2);
    border-radius: 3px;
    margin-top: 9px;
    overflow: hidden;
  }

  .xpbar span {
    display: block;
    height: 100%;
    background: var(--accent);
    border-radius: 3px;
    transition: width 0.4s ease;
  }

  .risk {
    margin: 14px 0 0;
    font-size: 14px;
    color: var(--text-dim);
    background: var(--surface-2);
    border-radius: 12px;
    padding: 11px 14px;
  }

  .badges {
    display: grid;
    gap: 8px;
  }

  .badge {
    display: flex;
    gap: 13px;
    align-items: flex-start;
    padding: 13px 15px;
  }

  .badge.locked {
    opacity: 0.5;
    box-shadow: none;
  }

  .glyph {
    font-size: 21px;
    width: 26px;
    text-align: center;
    line-height: 1.3;
  }

  .badge strong {
    font-size: 15px;
  }

  .badge p {
    margin: 2px 0 0;
    font-size: 13.5px;
    line-height: 1.45;
    color: var(--text-dim);
  }

  .when {
    display: inline-block;
    margin-top: 5px;
    font-size: 11.5px;
    color: var(--text-faint);
  }

  .notes {
    display: grid;
    gap: 8px;
  }

  .note {
    text-align: left;
    padding: 13px 15px;
  }

  .note .day {
    font-size: 12px;
    font-weight: 700;
    letter-spacing: 0.04em;
    text-transform: uppercase;
    color: var(--text-faint);
  }

  .note p {
    margin: 5px 0 0;
    font-size: 14.5px;
    line-height: 1.5;
    color: var(--text-dim);
    white-space: pre-wrap;
  }
</style>
