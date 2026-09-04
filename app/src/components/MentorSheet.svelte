<script lang="ts">
  /**
   * The mentor, reachable without leaving the lesson.
   *
   * It drives the *same* `chat` store and the same per-day thread key the Mentor tab
   * uses, deliberately: a question asked halfway through the theory is the same
   * conversation you find later under Mentor, rather than a second transcript that
   * quietly disagrees with the first.
   */
  import type { Day, Week } from '../lib/types';
  import { app } from '../lib/app.svelte';
  import { chat } from '../lib/chat.svelte';
  import { router } from '../lib/router.svelte';
  import Markdown from './Markdown.svelte';
  import Button from './Button.svelte';

  interface Props {
    week: Week;
    day: Day;
    open: boolean;
    onclose: () => void;
    /** Shown as tappable starters when the thread is empty. */
    suggestions?: string[];
  }
  let { week, day, open, onclose, suggestions = [] }: Props = $props();

  let draft = $state('');
  let box = $state<HTMLTextAreaElement | null>(null);
  let scroller = $state<HTMLElement | null>(null);

  $effect(() => {
    if (!open) return;
    chat.context = { week, day };
    void chat.open(day.id);
  });

  // Follow the stream, but inside the sheet rather than the page.
  $effect(() => {
    if (!open || !scroller) return;
    chat.messages.length;
    chat.messages.at(-1)?.content.length;
    const el = scroller;
    requestAnimationFrame(() => el.scrollTo({ top: el.scrollHeight, behavior: 'smooth' }));
  });

  function grow() {
    if (!box) return;
    box.style.height = 'auto';
    box.style.height = `${Math.min(box.scrollHeight, 120)}px`;
  }

  async function send(text = draft) {
    const content = text.trim();
    if (!content || chat.streaming) return;
    draft = '';
    if (box) box.style.height = 'auto';
    await chat.send(content);
  }

  function onKey(e: KeyboardEvent) {
    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
      e.preventDefault();
      void send();
    }
    if (e.key === 'Escape') onclose();
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
            Ask anything about what you're reading. It knows which day you're on and what
            today's theory said — and it won't write the task for you, by design.
          </p>
          {#if suggestions.length}
            <div class="starters">
              {#each suggestions as s}
                <button onclick={() => void send(s)}>{s}</button>
              {/each}
            </div>
          {/if}
        {/if}

        <ul class="thread">
          {#each chat.messages as message, i}
            <li class={message.role}>
              {#if message.role === 'user'}
                <div class="bubble">{message.content}</div>
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
        <textarea
          bind:this={box}
          bind:value={draft}
          oninput={grow}
          onkeydown={onKey}
          rows="1"
          placeholder="Ask about this…"
          aria-label="Message"
        ></textarea>
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

  .composer textarea {
    flex: 1;
    resize: none;
    border-radius: 14px;
    padding: 10px 13px;
    font: inherit;
    font-size: 15px;
    background: var(--surface-2);
    border: 1px solid var(--border);
    color: var(--text);
    max-height: 120px;
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
