<script lang="ts">
  import type { Day, Week } from '../../lib/types';
  import { app } from '../../lib/app.svelte';
  import { exam } from '../../lib/chat.svelte';
  import { parseVerdict, stripVerdict } from '../../lib/mentor';
  import { router } from '../../lib/router.svelte';
  import Button from '../../components/Button.svelte';
  import Markdown from '../../components/Markdown.svelte';

  interface Props {
    day: Day;
    week: Week;
    weekId: string;
    onfinish: () => void;
  }
  let { day, week, weekId, onfinish }: Props = $props();

  let draft = $state('');
  let box = $state<HTMLTextAreaElement | null>(null);

  const dp = $derived(app.dayProgress(day.id, weekId));

  // One thread per day, kept apart from the Mentor tab's thread for the same day.
  $effect(() => {
    exam.context = { week, day };
    void exam.open(`teachback:${day.id}`);
  });

  // The verdict is whatever the examiner last ruled, so a re-examination after a
  // "gaps" can overturn it rather than being stuck behind the first attempt.
  const verdict = $derived(
    parseVerdict(exam.messages.filter((m) => m.role === 'assistant').map((m) => m.content).join('\n')),
  );

  $effect(() => {
    if (verdict === 'solid' && !dp.teachBackDone) void app.setTeachBackDone(day, weekId, true);
  });

  // Follow the stream, the same way the Mentor tab does.
  $effect(() => {
    exam.messages.length;
    exam.messages.at(-1)?.content.length;
    requestAnimationFrame(() => scrollTo({ top: document.body.scrollHeight, behavior: 'smooth' }));
  });

  function grow() {
    if (!box) return;
    box.style.height = 'auto';
    box.style.height = `${Math.min(box.scrollHeight, 180)}px`;
  }

  async function send() {
    const text = draft.trim();
    if (!text) return;
    draft = '';
    if (box) box.style.height = 'auto';
    await exam.send(text);
  }

  function onKey(e: KeyboardEvent) {
    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
      e.preventDefault();
      void send();
    }
  }

  const started = $derived(exam.messages.length > 0);

  /**
   * The escape hatch. The prompt tells the examiner to judge by its third probe, but
   * that's advice a model can talk itself out of — and an examination that never
   * terminates traps him with the segment permanently open. This always ends it.
   */
  async function demandVerdict() {
    if (exam.streaming) return;
    await exam.send("That's my answer. Judge it now — verdict, and what I missed.");
  }
</script>

<div class="step">
  <p class="lbl">Explain it</p>
  <h2>{day.teachBack ? 'In your own words' : 'Teach-back'}</h2>

  {#if day.teachBack}
    <div class="question">
      <Markdown source={day.teachBack} />
    </div>
  {/if}

  {#if !app.mentorReady}
    <div class="needs-key">
      <p>
        This step is a conversation, not a checkbox — it needs the mentor's API key to
        run. Add one in Settings and come back; it takes a minute and Gemini's tier is
        free.
      </p>
      <div class="pair">
        <Button size="sm" onclick={() => router.go('/settings')}>Open Settings</Button>
        <Button variant="ghost" size="sm" onclick={onfinish}>Skip for now</Button>
      </div>
    </div>
  {:else}
    {#if !started}
      <p class="hint">
        Write the explanation as if the person reading it has not done the lesson. Then
        it'll push on whatever you left thin — it won't fill the gap for you, so don't
        bother fishing.
      </p>
    {/if}

    <ul class="thread">
      {#each exam.messages as message, i}
        <li class={message.role}>
          {#if message.role === 'user'}
            <div class="bubble">{message.content}</div>
          {:else}
            <Markdown source={stripVerdict(message.content)} />
            {#if exam.streaming && i === exam.messages.length - 1}
              <span class="caret" aria-label="thinking"></span>
            {/if}
          {/if}
        </li>
      {/each}
    </ul>

    {#if exam.error}
      <div class="err">
        <p>{exam.error}</p>
        {#if exam.messages.at(-1)?.role === 'user'}
          <button class="link" onclick={() => void exam.retry()}>Try again</button>
        {/if}
      </div>
    {/if}

    {#if verdict === 'solid'}
      <div class="verdict solid">
        <p class="v-title">✓ That holds up</p>
        <p class="v-note">Marked as explained — this one wasn't a checkbox, you earned it.</p>
      </div>
    {:else if verdict === 'gaps'}
      <div class="verdict gaps">
        <p class="v-title">Not yet — see the gaps above</p>
        <p class="v-note">
          Go back over the thin part and explain that bit again. Overturning this is the
          whole point; it re-judges every time.
        </p>
      </div>
    {/if}

    <div class="composer">
      <textarea
        bind:this={box}
        bind:value={draft}
        oninput={grow}
        onkeydown={onKey}
        rows="4"
        placeholder={started ? 'Answer the follow-up…' : 'Explain it in your own words…'}
        aria-label="Your explanation"
      ></textarea>
      <div class="pair">
        <Button size="sm" onclick={send} disabled={!draft.trim() || exam.streaming}>
          {started ? 'Reply' : 'Submit explanation'}
        </Button>
        {#if exam.streaming}
          <Button variant="ghost" size="sm" onclick={() => exam.stop()}>Stop</Button>
        {:else if started}
          {#if !verdict}
            <Button variant="secondary" size="sm" onclick={demandVerdict}>Judge it now</Button>
          {/if}
          <Button variant="ghost" size="sm" onclick={() => void exam.clear()}>Start over</Button>
        {/if}
      </div>
    </div>
  {/if}

  <div class="finish">
    <Button variant={verdict === 'solid' ? 'primary' : 'secondary'} onclick={onfinish}>
      {verdict === 'solid' ? 'Finish the day' : 'Finish without passing'}
    </Button>
  </div>
</div>

<style>
  .step {
    padding-bottom: 40px;
  }

  .lbl {
    font-size: 11.5px;
    font-weight: 700;
    letter-spacing: 0.09em;
    text-transform: uppercase;
    color: var(--text-faint);
  }

  h2 {
    font-size: 22px;
    letter-spacing: -0.02em;
    margin: 4px 0 14px;
  }

  .question {
    border-left: 3px solid var(--accent);
    padding: 2px 0 2px 14px;
    margin-bottom: 16px;
    font-size: 15.5px;
  }

  .hint,
  .needs-key p {
    font-size: 14px;
    color: var(--text-faint);
    line-height: 1.55;
    margin-bottom: 14px;
  }

  .needs-key {
    background: var(--surface);
    border-radius: 14px;
    padding: 16px;
  }

  .pair {
    display: flex;
    gap: 8px;
    align-items: center;
  }

  .thread {
    list-style: none;
    display: flex;
    flex-direction: column;
    gap: 18px;
    margin: 18px 0;
  }

  .thread li.user {
    display: flex;
    justify-content: flex-end;
  }

  .bubble {
    background: var(--accent-soft, var(--surface));
    border-radius: 16px 16px 4px 16px;
    padding: 10px 13px;
    font-size: 15px;
    max-width: 85%;
    white-space: pre-wrap;
  }

  .caret {
    display: inline-block;
    width: 8px;
    height: 15px;
    background: var(--accent);
    vertical-align: text-bottom;
    animation: blink 1s steps(2, start) infinite;
  }

  @keyframes blink {
    to {
      visibility: hidden;
    }
  }

  .verdict {
    border-radius: 14px;
    padding: 14px 16px;
    margin: 6px 0 16px;
  }

  .verdict.solid {
    background: color-mix(in srgb, var(--good, #2e9e6b) 14%, transparent);
  }

  .verdict.gaps {
    background: color-mix(in srgb, var(--warn, #d08b28) 14%, transparent);
  }

  .v-title {
    font-weight: 700;
    font-size: 15px;
  }

  .v-note {
    font-size: 13.5px;
    color: var(--text-faint);
    margin-top: 4px;
    line-height: 1.5;
  }

  .composer textarea {
    width: 100%;
    resize: none;
    border-radius: 14px;
    padding: 12px 14px;
    font: inherit;
    font-size: 15px;
    background: var(--surface);
    border: 1px solid var(--line);
    color: var(--text);
    margin-bottom: 10px;
  }

  .err {
    background: color-mix(in srgb, var(--bad, #c8452f) 12%, transparent);
    border-radius: 12px;
    padding: 12px 14px;
    font-size: 14px;
    margin-bottom: 12px;
  }

  .link {
    font-size: 13.5px;
    font-weight: 600;
    color: var(--accent);
    margin-top: 6px;
  }

  .finish {
    margin-top: 26px;
  }
</style>
