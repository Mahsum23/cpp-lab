<script lang="ts">
  import type { Day } from '../../lib/types';
  import { app } from '../../lib/app.svelte';
  import Markdown from '../../components/Markdown.svelte';
  import Button from '../../components/Button.svelte';
  import CopyLine from '../../components/CopyLine.svelte';
  import { today } from '../../lib/date';

  interface Props {
    day: Day;
    weekId: string;
    onfinish: () => void;
  }
  let { day, weekId, onfinish }: Props = $props();

  const dp = $derived(app.dayProgress(day.id, weekId));
  const task = $derived(day.task);
  const score = $derived(app.quizScore(day, weekId));

  let notes = $state('');
  let hydrated = $state(false);
  $effect(() => {
    if (!hydrated) {
      notes = dp.notes;
      hydrated = true;
    }
  });

  // Debounced so a long "what confused me" isn't a write to IndexedDB per keypress.
  let timer: ReturnType<typeof setTimeout> | undefined;
  function onNotesInput(e: Event) {
    notes = (e.currentTarget as HTMLTextAreaElement).value;
    clearTimeout(timer);
    timer = setTimeout(() => void app.setNotes(day, weekId, notes), 400);
  }

  function flushNotes() {
    clearTimeout(timer);
    void app.setNotes(day, weekId, notes);
  }

  /** Pre-formatted for the third column of PROGRESS.md — the honest one. */
  const progressSnippet = $derived(
    [
      `**Day ${day.day} — ${day.title} (${today()}):**`,
      `- Quiz: ${score.correct}/${score.total}`,
      `- Task: ${dp.task === 'done' ? 'done' : dp.task === 'attempted' ? 'attempted' : 'not started'}`,
      notes.trim() ? `- What confused me: ${notes.trim()}` : null,
    ]
      .filter(Boolean)
      .join('\n'),
  );

  function attempted() {
    flushNotes();
    void app.setTaskState(day, weekId, 'attempted');
  }

  function done() {
    flushNotes();
    onfinish();
  }
</script>

<p class="eyebrow">Your task</p>
<h1>{day.title}</h1>

{#if task}
  <Markdown source={task.markdown} />

  {#if task.files.length}
    <div class="files">
      {#each task.files as file}
        <span class="file mono">
          <svg viewBox="0 0 24 24" aria-hidden="true"
            ><path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8Z" /><path
              d="M14 3v5h5"
            /></svg
          >
          {file}
        </span>
      {/each}
    </div>
  {/if}

  {#if task.compile}
    <div class="block">
      <p class="lbl">Compile</p>
      <CopyLine text={task.compile} label="Copy compile command" />
    </div>
  {/if}

  {#if task.checklist.length}
    <div class="block">
      <p class="lbl">Before you call it done</p>
      <ul class="checklist">
        {#each task.checklist as item, i}
          <li>
            <button
              class:on={dp.checklist[i]}
              onclick={() => app.toggleChecklist(day, weekId, i)}
              aria-pressed={Boolean(dp.checklist[i])}
            >
              <span class="box" aria-hidden="true">
                <svg viewBox="0 0 24 24"><path d="m5 13 4 4L19 7" /></svg>
              </span>
              <span class="prose-inline">{@html item.replace(/`([^`]+)`/g, '<code>$1</code>')}</span>
            </button>
          </li>
        {/each}
      </ul>
    </div>
  {/if}
{:else}
  <p class="none">No task spec for this day.</p>
{/if}

<div class="block">
  <p class="lbl">What confused me</p>
  <textarea
    rows="3"
    placeholder="Be honest here — this is the column that's worth anything."
    value={notes}
    oninput={onNotesInput}
    onblur={flushNotes}
  ></textarea>
  {#if notes.trim()}
    <div class="snippet">
      <CopyLine text={progressSnippet} label="Copy for PROGRESS.md" />
      <p class="hint">Paste that into <code>PROGRESS.md</code> on the laptop.</p>
    </div>
  {/if}
</div>

<div class="actions">
  <Button variant="secondary" onclick={attempted}>
    {dp.task === 'attempted' ? '✓ Attempted' : 'Mark attempted'}
  </Button>
  <Button onclick={done}>Done ✓</Button>
</div>

<style>
  h1 {
    font-size: 24px;
    letter-spacing: -0.022em;
    margin: 4px 0 18px;
  }

  .lbl {
    font-size: 11.5px;
    font-weight: 700;
    letter-spacing: 0.075em;
    text-transform: uppercase;
    color: var(--text-faint);
    margin: 0 0 8px;
  }

  .files {
    display: flex;
    flex-wrap: wrap;
    gap: 7px;
    margin-bottom: 20px;
  }

  .file {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    font-size: 13px;
    background: var(--surface-2);
    border: 1px solid var(--border);
    border-radius: 999px;
    padding: 5px 12px 5px 10px;
    color: var(--text-dim);
  }

  .file svg {
    width: 14px;
    height: 14px;
    fill: none;
    stroke: currentColor;
    stroke-width: 1.7;
    stroke-linejoin: round;
  }

  .block {
    margin-bottom: 22px;
  }

  .checklist {
    list-style: none;
    margin: 0;
    padding: 0;
    display: grid;
    gap: 2px;
  }

  .checklist button {
    display: flex;
    align-items: flex-start;
    gap: 11px;
    width: 100%;
    text-align: left;
    padding: 9px 6px;
    border-radius: 10px;
    font-size: 15px;
    line-height: 1.45;
    color: var(--text-dim);
    transition: color 0.15s ease;
  }

  .checklist button.on {
    color: var(--text-faint);
    text-decoration: line-through;
    text-decoration-color: var(--border-strong);
  }

  .box {
    flex: none;
    width: 21px;
    height: 21px;
    border-radius: 6px;
    border: 1.5px solid var(--border-strong);
    display: grid;
    place-items: center;
    color: transparent;
    transition:
      background 0.15s ease,
      border-color 0.15s ease,
      color 0.15s ease;
  }

  .checklist button.on .box {
    background: var(--ok);
    border-color: var(--ok);
    color: #fff;
  }

  .box svg {
    width: 13px;
    height: 13px;
    fill: none;
    stroke: currentColor;
    stroke-width: 3;
    stroke-linecap: round;
    stroke-linejoin: round;
  }

  .prose-inline :global(code) {
    font-family: var(--font-mono);
    font-size: 0.87em;
    background: var(--surface-2);
    border-radius: 5px;
    padding: 0.1em 0.34em;
  }

  textarea {
    width: 100%;
    background: var(--bg-elev);
    border: 1px solid var(--border);
    border-radius: 12px;
    padding: 12px;
    font-size: 16px; /* < 16px makes iOS zoom the whole page on focus. */
    line-height: 1.5;
    resize: vertical;
    color: var(--text);
  }

  textarea::placeholder {
    color: var(--text-faint);
  }

  textarea:focus {
    outline: 2px solid var(--accent);
    outline-offset: -1px;
    border-color: transparent;
  }

  .snippet {
    margin-top: 10px;
  }

  .hint {
    font-size: 12.5px;
    color: var(--text-faint);
    margin: 6px 2px 0;
  }

  .hint code {
    font-family: var(--font-mono);
    font-size: 0.92em;
  }


  .actions {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 9px;
    margin-top: 28px;
    padding-top: 20px;
    border-top: 1px solid var(--border);
  }

  .none {
    color: var(--text-dim);
  }
</style>
