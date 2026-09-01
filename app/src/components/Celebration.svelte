<script lang="ts">
  import { app } from '../lib/app.svelte';
  import { byId } from '../lib/badges';
  import Button from './Button.svelte';
  import Flame from './Flame.svelte';

  interface Props {
    open: boolean;
    dayTitle: string;
    onclose: () => void;
  }
  let { open, dayTitle, onclose }: Props = $props();

  const badges = $derived(app.justEarned.map(byId).filter(Boolean));
  // Deterministic-ish spread so the burst doesn't re-randomise on every re-render.
  const bits = Array.from({ length: 14 }, (_, i) => ({
    x: (i % 7) * 16 - 48 + (i > 6 ? 8 : 0),
    d: (i * 47) % 260,
    r: (i * 73) % 360,
  }));
</script>

{#if open}
  <div class="scrim" role="dialog" aria-modal="true" aria-label="Session complete">
    <div class="sheet">
      <div class="burst" aria-hidden="true">
        {#each bits as b, i}
          <i style:--x="{b.x}px" style:--d="{b.d}ms" style:--r="{b.r}deg" class="c{i % 4}"></i>
        {/each}
      </div>

      <p class="eyebrow">Session complete</p>
      <h2>{dayTitle}</h2>

      <div class="row">
        <div class="stat">
          <span class="value"><span class="numeral big">+{app.lastXpGain}</span></span>
          <span class="lbl">XP</span>
        </div>
        <div class="stat">
          <span class="value"><Flame count={app.streakCount} size={26} /></span>
          <span class="lbl">day streak</span>
        </div>
      </div>

      {#if badges.length}
        <div class="badges">
          {#each badges as badge}
            <div class="badge">
              <span class="glyph">{badge!.glyph}</span>
              <div>
                <strong>{badge!.name}</strong>
                <p>{badge!.blurb}</p>
              </div>
            </div>
          {/each}
        </div>
      {/if}

      <p class="sign">That's today's. Go write the code on the laptop.</p>
      <Button full onclick={onclose}>Done</Button>
    </div>
  </div>
{/if}

<style>
  .scrim {
    position: fixed;
    inset: 0;
    z-index: 60;
    display: grid;
    place-items: end center;
    background: rgb(0 0 0 / 45%);
    backdrop-filter: blur(3px);
    animation: fade 0.2s ease;
  }

  .sheet {
    position: relative;
    width: 100%;
    max-width: 620px;
    background: var(--surface);
    border-radius: 24px 24px 0 0;
    box-shadow: var(--shadow-lift);
    padding: 26px 20px calc(20px + var(--safe-b));
    text-align: center;
    animation: rise 0.32s cubic-bezier(0.2, 0.9, 0.25, 1);
  }

  h2 {
    font-size: 21px;
    margin: 4px 0 18px;
  }

  .row {
    display: flex;
    justify-content: center;
    gap: 34px;
    margin-bottom: 18px;
  }

  .stat {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 2px;
  }

  /* Fixed slot so a 30px numeral and a 26px flame put their labels on one line. */
  .value {
    display: grid;
    place-items: center;
    height: 36px;
  }

  .big {
    font-size: 30px;
    color: var(--accent);
  }

  .lbl {
    font-size: 11.5px;
    color: var(--text-faint);
    text-transform: uppercase;
    letter-spacing: 0.07em;
    font-weight: 600;
  }

  .badges {
    display: grid;
    gap: 8px;
    margin-bottom: 18px;
  }

  .badge {
    display: flex;
    align-items: flex-start;
    gap: 12px;
    text-align: left;
    background: var(--surface-2);
    border-radius: 14px;
    padding: 12px 14px;
  }

  .glyph {
    font-size: 22px;
    line-height: 1.2;
  }

  .badge strong {
    font-size: 15px;
  }

  .badge p {
    margin: 2px 0 0;
    font-size: 13.5px;
    color: var(--text-dim);
    line-height: 1.45;
  }

  .sign {
    font-size: 14px;
    color: var(--text-dim);
    margin: 0 0 16px;
  }

  /* Confetti-lite: a short burst, no looping, nothing bounces afterwards. */
  .burst {
    position: absolute;
    inset: -10px 0 auto 0;
    height: 0;
    display: flex;
    justify-content: center;
  }

  .burst i {
    position: absolute;
    width: 7px;
    height: 7px;
    border-radius: 2px;
    animation: pop 0.9s ease-out var(--d) both;
  }

  .c0 { background: var(--accent); }
  .c1 { background: var(--flame); }
  .c2 { background: var(--ok); }
  .c3 { background: var(--border-strong); }

  @keyframes pop {
    0% {
      transform: translate(0, 0) rotate(0deg);
      opacity: 0;
    }
    20% {
      opacity: 1;
    }
    100% {
      transform: translate(var(--x), -76px) rotate(var(--r));
      opacity: 0;
    }
  }

  @keyframes rise {
    from {
      transform: translateY(100%);
    }
  }

  @keyframes fade {
    from {
      opacity: 0;
    }
  }
</style>
