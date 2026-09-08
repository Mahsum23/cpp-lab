<script lang="ts">
  /**
   * The mentor, reachable without leaving the lesson.
   *
   * It drives the *same* `chat` store and the same per-day thread key the Mentor tab
   * uses, deliberately: a question asked halfway through the theory is the same
   * conversation you find later under Mentor, rather than a second transcript that
   * quietly disagrees with the first.
   */
  import { untrack } from 'svelte';
  import type { Day, Week } from '../lib/types';
  import { app } from '../lib/app.svelte';
  import { chat } from '../lib/chat.svelte';
  import { router } from '../lib/router.svelte';
  import Markdown from './Markdown.svelte';
  import Button from './Button.svelte';
  import CodeArea from './CodeArea.svelte';
  import { asCodeBlock, hasFence, shapeOf } from '../lib/compose';
  import { TRACKS, type Track } from '../lib/types';

  /**
   * A tappable opener. `send: false` drops the text into the composer instead of
   * sending it, which is the only sane behaviour for one that needs finishing —
   * "I'm stuck, here's what I tried:" is worthless sent on its own.
   */
  export type Starter = { text: string; send?: boolean };

  interface Props {
    week: Week;
    day: Day;
    open: boolean;
    onclose: () => void;
    /** Shown as tappable starters when the thread is empty. */
    suggestions?: (string | Starter)[];
    /**
     * A question to send the moment the sheet opens, rather than offer.
     *
     * Starters can't do this job: they only render on an empty thread, and the point
     * of asking about a highlighted passage is that it works on the tenth question as
     * readily as the first.
     */
    ask?: string | null;
  }
  let { week, day, open, onclose, suggestions = [], ask = null }: Props = $props();

  /** So re-renders while the reply streams don't send the same question again. */
  let asked = $state<string | null>(null);

  const starters = $derived(
    suggestions.map((s) => (typeof s === 'string' ? { text: s, send: true } : { send: true, ...s })),
  );

  let draft = $state('');
  let area = $state<ReturnType<typeof CodeArea> | null>(null);
  let scroller = $state<HTMLElement | null>(null);
  let codeMode = $state(false);
  const lang = $derived(TRACKS[(week.track ?? 'cpp') as Track].lang);

  $effect(() => {
    if (!open) {
      asked = null;
      return;
    }
    chat.context = { week, day };
    void chat.open(day.id);
  });

  // Awaits the open, so the question lands in this day's thread rather than racing
  // whichever one was last loaded into the store.
  $effect(() => {
    if (!open || !ask || ask === untrack(() => asked)) return;
    const question = ask;
    asked = question;
    void chat.open(day.id).then(() => send(question));
  });

  // Follow the stream, but inside the sheet rather than the page.
  $effect(() => {
    if (!open || !scroller) return;
    chat.messages.length;
    chat.messages.at(-1)?.content.length;
    const el = scroller;
    requestAnimationFrame(() => el.scrollTo({ top: el.scrollHeight, behavior: 'smooth' }));
  });

  async function send(text = draft) {
    const raw = text.trim();
    if (!raw || chat.streaming) return;
    // Fence it on the way out, so the model is told it's source and the transcript
    // renders it highlighted rather than reflowed.
    const content = codeMode && !hasFence(raw) ? asCodeBlock(raw, lang) : raw;
    draft = '';
    codeMode = false;
    area?.grow();
    await chat.send(content);
  }

  function prefill(text: string) {
    draft = text.endsWith(':') ? `${text} ` : text;
    area?.focus();
    area?.grow();
  }

</script>

{#if open}
  <!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions -->
  <div class="scrim" onclick={onclose}></div>

  <section class="sheet" aria-label="Mentor">
    <header>
      <div>
        <p class="lbl">Mentor</p>
        <p class="ctx">Day {day.day} — {day.title}</p>
      </div>
      <button class="close" onclick={onclose} aria-label="Close">
        <svg viewBox="0 0 24 24"><path d="M6 6l12 12M18 6L6 18" /></svg>
      </button>
    </header>

    <div class="body" bind:this={scroller}>
      {#if !app.mentorReady}
        <div class="setup">
          <p>
            The mentor needs an API key, which lives on this device. Gemini's free tier
            covers it — no card, no credits.
          </p>
          <Button size="sm" onclick={() => router.go('/settings')}>Open Settings</Button>
        </div>
      {:else}
        {#if chat.empty}
          <p class="hint">
            Ask anything about today's material. It knows which day you're on, what the
            theory said and what the task is — and it won't write that task for you, by
            design.
          </p>
          {#if suggestions.length}
            <div class="starters">
              {#each starters as s}
                <button onclick={() => (s.send ? void send(s.text) : prefill(s.text))}>
                  {s.text}{#if !s.send}<span class="pen">✎</span>{/if}
                </button>
              {/each}
            </div>
          {/if}
        {/if}

        <ul class="thread">
          {#each chat.messages as message, i}
            <li class={message.role}>
              {#if message.role === 'user'}
                {@const shape = shapeOf(message.content)}
                <div class="bubble" class:has-code={shape === 'code'} class:mixed={shape === 'mixed'}>
                  {#if shape === 'text'}
                    {message.content}
                  {:else}
                    <Markdown source={message.content} />
                  {/if}
                </div>
              {:else}
                <Markdown source={message.content} />
                {#if chat.streaming && i === chat.messages.length - 1}
                  <span class="caret" aria-label="thinking"></span>
                {/if}
              {/if}
            </li>
          {/each}
        </ul>

        {#if chat.error}
          <div class="err">
            <p>{chat.error}</p>
            {#if chat.messages.at(-1)?.role === 'user'}
              <button class="link" onclick={() => void chat.retry()}>Try again</button>
            {/if}
          </div>
        {/if}
      {/if}
    </div>

    {#if app.mentorReady}
      <div class="composer">
        <CodeArea
          bind:this={area}
          bind:value={draft}
          bind:codeMode
          {lang}
          maxHeight={120}
          placeholder={codeMode ? `Paste or type ${TRACKS[(week.track ?? 'cpp') as Track].label}…` : 'Ask about this…'}
          onsubmit={() => void send()}
          onescape={onclose}
        />
        <button
          class="icon toggle"
          class:on={codeMode}
          onclick={() => area?.codeAction()}
          aria-pressed={codeMode}
          aria-label="Code block"
          title="Code block — wraps the selection, or switches the whole message to C++ (Ctrl/Cmd+E)"
        >
          <svg viewBox="0 0 24 24"><path d="m9 8-4 4 4 4m6-8 4 4-4 4" /></svg>
        </button>
        {#if chat.streaming}
          <button class="icon stop" onclick={() => chat.stop()} aria-label="Stop">
            <svg viewBox="0 0 24 24"><rect x="7" y="7" width="10" height="10" rx="2" /></svg>
          </button>
        {:else}
          <button class="icon" onclick={() => void send()} disabled={!draft.trim()} aria-label="Send">
            <svg viewBox="0 0 24 24"><path d="M5 12h13m-6-6 6 6-6 6" /></svg>
          </button>
        {/if}
      </div>
    {/if}
  </section>
{/if}

<style>
  .scrim {
    position: fixed;
    inset: 0;
    background: rgba(0, 0, 0, 0.32);
    z-index: 40;
    animation: fade 0.15s ease;
  }

  .sheet {
    position: fixed;
    left: 0;
    right: 0;
    bottom: 0;
    z-index: 41;
    display: flex;
    flex-direction: column;
    /* Not taller: the question is usually about the paragraph you were just
       reading, so leave enough of it on screen to refer back to. */
    max-height: 70vh;
    background: var(--bg, var(--surface));
    border-radius: 18px 18px 0 0;
    border-top: 1px solid var(--border);
    box-shadow: 0 -12px 40px rgba(0, 0, 0, 0.25);
    animation: rise 0.2s cubic-bezier(0.2, 0.8, 0.3, 1);
    padding-bottom: var(--safe-b);
  }

  @keyframes fade {
    from { opacity: 0; }
  }

  @keyframes rise {
    from { transform: translateY(100%); }
  }

  header {
    display: flex;
    align-items: flex-start;
    justify-content: space-between;
    gap: 12px;
    padding: 14px 16px 10px;
    border-bottom: 1px solid var(--border);
    flex: none;
  }

  .lbl {
    font-size: 11.5px;
    font-weight: 700;
    letter-spacing: 0.09em;
    text-transform: uppercase;
    color: var(--text-faint);
  }

  .ctx {
    font-size: 14.5px;
    font-weight: 600;
    margin-top: 2px;
  }

  .close {
    flex: none;
    padding: 4px;
    color: var(--text-faint);
  }

  .close svg {
    width: 20px;
    height: 20px;
    fill: none;
    stroke: currentColor;
    stroke-width: 2;
    stroke-linecap: round;
  }

  .body {
    overflow-y: auto;
    padding: 14px 16px;
    flex: 1;
    -webkit-overflow-scrolling: touch;
  }

  .hint,
  .setup p {
    font-size: 14px;
    color: var(--text-faint);
    line-height: 1.55;
    margin-bottom: 12px;
  }

  .starters {
    display: flex;
    flex-direction: column;
    gap: 8px;
    align-items: flex-start;
  }

  .starters button {
    text-align: left;
    font-size: 14px;
    background: var(--surface-2);
    border: 1px solid var(--border);
    border-radius: 12px;
    padding: 9px 12px;
    color: var(--text);
    line-height: 1.4;
  }

  .pen {
    color: var(--text-faint);
    margin-left: 6px;
  }

  .thread {
    list-style: none;
    display: flex;
    flex-direction: column;
    gap: 16px;
  }

  .thread li.user {
    display: flex;
    justify-content: flex-end;
  }

  .bubble {
    background: var(--accent-soft);
    border-radius: 15px 15px 4px 15px;
    padding: 9px 12px;
    font-size: 15px;
    max-width: 85%;
    white-space: pre-wrap;
  }

  .caret {
    display: inline-block;
    width: 7px;
    height: 14px;
    background: var(--accent);
    vertical-align: text-bottom;
    animation: blink 1s steps(2, start) infinite;
  }

  @keyframes blink {
    to { visibility: hidden; }
  }

  .err {
    background: color-mix(in srgb, var(--bad, #c8452f) 12%, transparent);
    border-radius: 12px;
    padding: 10px 12px;
    font-size: 13.5px;
    margin-top: 12px;
  }

  .link {
    font-size: 13px;
    font-weight: 600;
    color: var(--accent);
    margin-top: 4px;
  }

  .composer {
    flex: none;
    display: flex;
    align-items: flex-end;
    gap: 8px;
    padding: 10px 12px 12px;
    border-top: 1px solid var(--border);
  }


  .icon.toggle {
    background: var(--surface-2);
    color: var(--text-faint);
    border: 1px solid var(--border);
  }

  .icon.toggle.on {
    background: var(--accent-soft);
    color: var(--accent);
    border-color: var(--accent);
  }

  .bubble.has-code {
    max-width: 100%;
    width: 100%;
    background: transparent;
    padding: 0;
  }

  /* Prose with a block inside it: still a message you sent, but the accent fill would
     fight the highlighted code sitting on top of it. */
  .bubble.mixed {
    background: var(--surface);
    border: 1px solid var(--border);
    max-width: 100%;
    width: 100%;
  }

  .bubble.mixed :global(.prose > *:last-child) {
    margin-bottom: 0;
  }


  .icon {
    flex: none;
    width: 38px;
    height: 38px;
    border-radius: 50%;
    background: var(--accent);
    color: #fff;
    display: grid;
    place-items: center;
  }

  .icon:disabled {
    opacity: 0.35;
  }

  .icon svg {
    width: 19px;
    height: 19px;
    fill: none;
    stroke: currentColor;
    stroke-width: 2;
    stroke-linecap: round;
    stroke-linejoin: round;
  }

  .icon.stop svg {
    fill: currentColor;
    stroke: none;
  }
</style>
