<script lang="ts">
  /**
   * "Check your work": paste or pick the file you wrote, get it reviewed against the
   * checklist, and get a grade.
   *
   * What this can and cannot do, said plainly because the alternative is a green tick
   * that means less than it looks like it means: the reviewer READS the file. It cannot
   * run it. So each checklist item is judged from what is written (for a task that asks
   * you to record plans or output as comments, from those), and an item it cannot judge
   * comes back "unclear" rather than "met". Running the code is `./lab check`.
   *
   * The grade is computed here from the per-item verdicts (`gradeOf`), never asked of
   * the model, so it can always be explained by pointing at an item.
   */
  import type { Day, TaskReview, Week } from '../lib/types';
  import { app } from '../lib/app.svelte';
  import { router } from '../lib/router.svelte';
  import {
    MAX_SUBMISSION_CHARS, ModelGoneError, parseItems, reviewFocus, streamReply, stripItems,
    taskReviewPrompt, taskSubmission, type MentorFocus,
  } from '../lib/mentor';
  import Markdown from './Markdown.svelte';
  import Button from './Button.svelte';
  import CodeArea from './CodeArea.svelte';

  interface Props {
    day: Day;
    weekId: string;
    week: Week;
    lang: string;
    /** What the mentor should be told if they ask about this review; null before one. */
    focus?: MentorFocus | null;
    /** Open the mentor about the review. */
    ondiscuss?: () => void;
  }
  let { day, weekId, week, lang, focus = $bindable(null), ondiscuss }: Props = $props();

  const dp = $derived(app.dayProgress(day.id, weekId));
  const checklist = $derived(day.task?.checklist ?? []);
  const file = $derived(day.task?.files[0] ?? null);

  let code = $state('');
  let codeMode = $state(true);
  let picked = $state<string | null>(null);
  let text = $state('');
  let checking = $state(false);
  let error = $state<string | null>(null);
  /** What was actually sent, so the review is discussed against that and not a later edit. */
  let sentCode = '';

  const review = $derived<TaskReview | null>(dp.taskReview ?? null);
  /** A review of a checklist that has since changed cannot be lined up with it. */
  const usable = $derived(review !== null && review.items.length === checklist.length);
  const met = $derived(usable ? review!.items.filter((i) => i === 'met').length : 0);

  const LABEL = { solid: 'Solid', almost: 'Almost', notyet: 'Not yet' } as const;
  const RULE = {
    solid: 'Every item is met.',
    almost: 'Nothing is missing, but something is partial or cannot be shown from the file.',
    notyet: 'At least one item has no sign of it in the file.',
  } as const;

  async function choose(e: Event) {
    const input = e.currentTarget as HTMLInputElement;
    const f = input.files?.[0];
    if (!f) return;
    const body = await f.text();
    input.value = '';
    if (body.length > MAX_SUBMISSION_CHARS) {
      error = `${f.name} is longer than can be reviewed in one go (${MAX_SUBMISSION_CHARS.toLocaleString()} characters). Paste the part you want checked.`;
      return;
    }
    error = null;
    code = body;
    picked = f.name;
  }

  async function check() {
    const source = code.trim();
    const key = app.mentorKey;
    if (!source || !key || checking) return;
    if (source.length > MAX_SUBMISSION_CHARS) {
      error = `That is longer than can be reviewed in one go (${MAX_SUBMISSION_CHARS.toLocaleString()} characters). Paste the part you want checked.`;
      return;
    }
    checking = true;
    error = null;
    text = '';
    sentCode = source;
    try {
      for await (const chunk of streamReply({
        provider: app.mentorProvider,
        key,
        model: app.progress.settings.mentorModel,
        alternates: app.fallbackModels,
        system: taskReviewPrompt({ week, day }),
        messages: [{ role: 'user', content: taskSubmission({ file, code: source, lang, notes: dp.notes }) }],
      })) {
        text += chunk;
      }
      const items = parseItems(text, checklist.length);
      if (!items) {
        // A grade nobody gave is worse than none. Say so and let them run it again.
        error = "I couldn't read the reviewer's verdicts from that reply, so nothing was graded and your last grade is unchanged. Try again.";
        return;
      }
      const saved = await app.setTaskReview(day, weekId, items);
      focus = reviewFocus({ file, code: sentCode, lang, checklist, items, grade: saved.grade, review: text });
    } catch (err) {
      if (err instanceof ModelGoneError) await app.retireModel(app.progress.settings.mentorModel);
      error = err instanceof Error ? err.message : 'The mentor is unavailable.';
    } finally {
      checking = false;
    }
  }
</script>

{#if checklist.length}
  <div class="block">
    <p class="lbl">Check your work</p>

    {#if !app.mentorReady}
      <p class="hint">
        A review needs the mentor, which needs an API key on this device.
        <button class="link" onclick={() => router.go('/settings')}>Open Settings</button>
      </p>
    {:else}
      <p class="hint">
        Paste {#if file}<code>{file}</code>{:else}your file{/if} below, or pick it. The mentor
        reads it against the checklist and grades it. It <strong>reads</strong> your code but
        cannot run it, so anything you observed has to be written into the file — for this
        kind of task, as comments. It won't write the solution for you.
      </p>

      <div class="field">
        <CodeArea
          bind:value={code}
          bind:codeMode
          {lang}
          maxHeight={280}
          placeholder={file ? `Paste ${file} here…` : 'Paste your file here…'}
          ariaLabel="The file to check"
          onsubmit={() => void check()}
        />
      </div>

      <div class="row">
        <Button onclick={() => void check()} disabled={!code.trim() || checking}>
          {checking ? 'Reading…' : review ? 'Check again' : 'Check my work'}
        </Button>
        <label class="pick">
          {picked ?? 'Pick the file…'}
          <input type="file" onchange={choose} hidden />
        </label>
      </div>

      {#if error}
        <div class="err"><p>{error}</p></div>
      {/if}

      {#if text}
        <div class="card review">
          <Markdown source={stripItems(text)} />
          {#if checking}<span class="caret"></span>{/if}
        </div>
      {/if}

      {#if usable && review}
        <div class="result {review.grade}" aria-live="polite">
          <p class="grade"><strong>{LABEL[review.grade]}</strong> · {met} of {review.items.length} items met</p>
          <p class="rule">{RULE[review.grade]}</p>
          <p class="meta">
            Checked {review.checks === 1 ? 'once' : `${review.checks} times`}.
            {#if review.grade === 'solid'}Solid counts as done: the Practice step is complete.{/if}
            {#if focus && ondiscuss}
              <button class="link" onclick={ondiscuss}>Talk it through with the mentor</button>
            {/if}
          </p>
        </div>
      {/if}
    {/if}
  </div>
{/if}

<style>
  .block {
    margin-bottom: 22px;
  }

  .lbl {
    font-size: 11.5px;
    font-weight: 700;
    letter-spacing: 0.075em;
    text-transform: uppercase;
    color: var(--text-faint);
    margin: 0 0 8px;
  }

  .hint {
    font-size: 13.5px;
    line-height: 1.5;
    color: var(--text-faint);
    margin: 0 0 12px;
  }

  .hint code {
    font-size: 12.5px;
  }

  .field {
    display: flex;
    margin-bottom: 12px;
  }

  .row {
    display: flex;
    align-items: center;
    gap: 14px;
    flex-wrap: wrap;
    margin-bottom: 14px;
  }

  .pick {
    font-size: 13.5px;
    font-weight: 600;
    color: var(--text-dim);
    text-decoration: underline;
    cursor: pointer;
    max-width: 55%;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .link {
    font-size: inherit;
    font-weight: 600;
    color: var(--accent);
    text-decoration: underline;
  }

  .err {
    background: var(--bad-soft, color-mix(in srgb, var(--bad) 12%, transparent));
    border-radius: 12px;
    padding: 11px 13px;
    font-size: 13.5px;
    margin-bottom: 14px;
  }

  .review {
    margin-bottom: 14px;
  }

  .caret {
    display: inline-block;
    width: 8px;
    height: 14px;
    border-radius: 2px;
    background: var(--accent);
    vertical-align: -2px;
    animation: pulse 1s ease-in-out infinite;
  }

  @keyframes pulse {
    50% { opacity: 0.25; }
  }

  .result {
    border: 1px solid var(--border);
    border-left-width: 4px;
    border-radius: 12px;
    padding: 12px 14px;
    background: var(--surface);
  }

  .result.solid { border-left-color: var(--ok); }
  .result.almost { border-left-color: var(--accent); }
  .result.notyet { border-left-color: var(--flame, var(--bad)); }

  .grade {
    font-size: 16px;
    margin: 0 0 3px;
  }

  .rule {
    font-size: 13.5px;
    color: var(--text-dim);
    margin: 0 0 6px;
  }

  .meta {
    font-size: 13px;
    color: var(--text-faint);
    margin: 0;
  }
</style>
