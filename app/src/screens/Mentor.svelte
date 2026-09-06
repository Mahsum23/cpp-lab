<script lang="ts">
  import { app } from '../lib/app.svelte';
  import { chat, GENERAL } from '../lib/chat.svelte';
  import { router } from '../lib/router.svelte';
  import Markdown from '../components/Markdown.svelte';
  import Button from '../components/Button.svelte';
  import { PROVIDERS } from '../lib/mentor';
  import {
    asCodeBlock, closerAt, hasFence, inFence, indentAt, looksLikeCode, newlineAt, shapeOf,
    wrapSelection,
  } from '../lib/compose';

  const provider = $derived(PROVIDERS[app.mentorProvider]);

  let draft = $state('');
  let box = $state<HTMLTextAreaElement | null>(null);
  let confirmClear = $state(false);
  let codeMode = $state(false);

  // Paste is the moment that matters: a pasted function should not silently arrive as
  // a paragraph with its indentation reflowed away.
  function onPaste(e: ClipboardEvent) {
    const text = e.clipboardData?.getData('text') ?? '';
    if (text && looksLikeCode(text)) codeMode = true;
  }

  /**
   * Apply an edit the browser wouldn't have made, and put the cursor back.
   *
   * Synchronously, on the element itself, rather than assigning `draft` and fixing the
   * selection a frame later: anyone typing at speed gets their next keystroke in
   * before that frame runs, and it lands wherever the cursor used to be. The binding
   * is then told the same string, so Svelte has nothing left to write back.
   */
  function apply(r: { value: string; start: number; end: number }) {
    if (box) {
      box.value = r.value;
      box.setSelectionRange(r.start, r.end);
    }
    draft = r.value;
    grow();
  }

  /**
   * Editor keys, live wherever the cursor is actually in code — the whole field in
   * code mode, or the code half of a mixed message.
   */
  function onEdit(e: KeyboardEvent) {
    if (!box || e.metaKey || e.ctrlKey || e.altKey || e.isComposing) return;
    const { value, selectionStart: from, selectionEnd: to } = box;
    if (!codeMode && !inFence(value, from)) return;

    if (e.key === 'Tab') {
      e.preventDefault();
      return apply(indentAt(value, from, to));
    }
    // Enter is a newline here (Ctrl/Cmd+Enter sends), so it is ours to indent.
    if (e.key === 'Enter') {
      e.preventDefault();
      return apply(newlineAt(value, from, to));
    }
    if (e.key === '}' || e.key === ')' || e.key === ']') {
      const r = closerAt(value, from, to, e.key);
      if (!r) return;
      e.preventDefault();
      apply(r);
    }
  }

  /**
   * The `</>` button, contextual — so a mixed message doesn't need hand-typed markdown.
   *
   * With a selection, it fences exactly that, which is the shape most questions
   * actually take: a line of prose, the code, then "why does it fail?". With the
   * cursor in a draft it drops an empty block in and lands inside it, ready to paste.
   * With nothing typed at all the whole message is going to be code, so it flips the
   * field itself into code mode instead.
   */
  function codeAction() {
    if (!box) {
      codeMode = !codeMode;
      return;
    }
    const { selectionStart: from, selectionEnd: to, value } = box;
    if (from === to && !value.trim()) {
      codeMode = !codeMode;
      box.focus();
      return;
    }
    apply(wrapSelection(value, from, to));
    box.focus();
  }

  // The thread follows the lesson he's on, so yesterday's questions don't clutter
  // today's. Falls back to the last authored day once the week is finished.
  const context = $derived(app.current ?? app.availableDays.at(-1) ?? null);
  const threadKey = $derived(context?.day.id ?? GENERAL);

  $effect(() => {
    chat.context = context;
    void chat.open(threadKey);
  });

  // Follow the stream. Keyed on the tail's length so it re-runs per chunk, not just
  // per message — otherwise a long reply grows off the bottom of the screen.
  $effect(() => {
    chat.messages.length;
    chat.messages.at(-1)?.content.length;
    requestAnimationFrame(() => scrollTo({ top: document.body.scrollHeight, behavior: 'smooth' }));
  });

  function grow() {
    if (!box) return;
    box.style.height = 'auto';
    box.style.height = `${Math.min(box.scrollHeight, 148)}px`;
  }

  async function send(text = draft) {
    const raw = text.trim();
    if (!raw) return;
    // Fence it on the way out, so the model is told it's source and the transcript
    // renders it highlighted rather than reflowed.
    const content = codeMode && !hasFence(raw) ? asCodeBlock(raw) : raw;
    draft = '';
    codeMode = false;
    if (box) box.style.height = 'auto';
    await chat.send(content);
  }

  function prefill(text: string) {
    draft = text;
    box?.focus();
    requestAnimationFrame(grow);
  }

  function onKey(e: KeyboardEvent) {
    onEdit(e);
    // Ctrl/Cmd+E does what the button does, for anyone typing on a real keyboard.
    if (e.key.toLowerCase() === 'e' && (e.metaKey || e.ctrlKey)) {
      e.preventDefault();
      codeAction();
    }
    // Enter is a newline on a phone keyboard. Desktop gets the shortcut it expects.
    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
      e.preventDefault();
      void send();
    }
  }

  const suggestions = $derived(
    context
      ? [
          { label: `Explain ${context.day.title.toLowerCase()} in three sentences`, send: true },
          { label: 'What do people most often get wrong here?', send: true },
          { label: "I'm stuck on the task. Here's what I tried:", send: false },
        ]
      : [
          { label: 'What should I understand before starting week one?', send: true },
          { label: 'How is this curriculum structured?', send: true },
        ],
  );
</script>

<div class="screen">
  <header>
    <div>
      <h1>Mentor</h1>
      {#if context}
        <p class="ctx">Knows you're on Day {context.day.day} — {context.day.title}</p>
      {:else}
        <p class="ctx">No lesson open — ask anything general.</p>
      {/if}
    </div>
    {#if !chat.empty}
      {#if confirmClear}
        <div class="confirm">
          <button class="link danger" onclick={() => { void chat.clear(); confirmClear = false; }}>Clear</button>
          <button class="link" onclick={() => (confirmClear = false)}>Keep</button>
        </div>
      {:else}
        <button class="link" onclick={() => (confirmClear = true)}>Clear thread</button>
      {/if}
    {/if}
  </header>

  {#if !app.mentorReady}
    <div class="setup card">
      <h2>Add an API key to turn this on</h2>
      <p>
        The mentor talks to {provider.label} straight from this device — there's no server
        in between, which is also why the key has to live here. A key from
        <a href={provider.consoleUrl} target="_blank" rel="noreferrer">{provider.consoleLabel}</a>,
        pasted into Settings, is all it needs.
      </p>
      <p class="warn" class:free={provider.free}>
        {#if provider.free}
          Gemini's free tier is genuinely free — rate-limited rather than metered, no card.
          If you'd rather have Claude answer, Settings can switch it, but that side is
          prepaid.
        {:else}
          Heads up: the Anthropic API is <strong>prepaid and separate from a Claude
          subscription</strong>. A key alone won't work until the account has credit.
          Gemini's free tier is one tap away in Settings if you'd rather not.
        {/if}
      </p>
      <Button size="sm" onclick={() => router.go('/settings')}>Open Settings</Button>
    </div>
  {:else if chat.empty}
    <div class="intro">
      <p>
        Ask about anything you're reading. It knows which day you're on and what today's
        task is — and it won't write that task for you, by design. Concepts, syscall
        semantics, why an error means what it means, what's wrong with code you've
        already written: all fair game.
      </p>
      <div class="suggest">
        {#each suggestions as s}
          <button onclick={() => (s.send ? send(s.label) : prefill(s.label))}>
            {s.label}
            {#if !s.send}<span class="pen">✎</span>{/if}
          </button>
        {/each}
      </div>
    </div>
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
</div>

{#if app.mentorReady}
  <div class="composer">
    <div class="inner">
      <textarea
        bind:this={box}
        bind:value={draft}
        oninput={grow}
        onkeydown={onKey}
        onpaste={onPaste}
        rows="1"
        placeholder={codeMode ? 'Paste or type C++…' : 'Ask the mentor…'}
        aria-label="Message"
        class:code={codeMode}
        autocomplete="off"
        autocapitalize="none"
        spellcheck={!codeMode && !hasFence(draft)}
        {...{ autocorrect: 'off' }}
      ></textarea>
      <button
        class="icon toggle"
        class:on={codeMode}
        onclick={codeAction}
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
  </div>
{/if}

<style>
  .screen {
    padding-bottom: calc(var(--tab-h) + var(--safe-b) + 84px);
  }

  header {
    display: flex;
    align-items: flex-start;
    justify-content: space-between;
    gap: 12px;
    margin-bottom: 18px;
  }

  h1 {
    font-size: 27px;
    letter-spacing: -0.025em;
  }

  .ctx {
    font-size: 13px;
    color: var(--text-faint);
    margin-top: 3px;
  }

  .link {
    font-size: 13.5px;
    font-weight: 600;
    color: var(--accent);
    flex: none;
    padding: 4px 0;
  }

  .link.danger {
    color: var(--bad);
  }

  .confirm {
    display: flex;
    gap: 12px;
  }

  .setup {
    padding: 18px;
  }

  .setup h2 {
    font-size: 17px;
    margin-bottom: 8px;
  }

  .setup p {
    font-size: 14.5px;
    line-height: 1.55;
    color: var(--text-dim);
    margin-bottom: 12px;
  }

  .setup a {
    color: var(--accent);
  }

  .warn {
    border-left: 2px solid var(--flame);
    padding-left: 11px;
  }

  .warn.free {
    border-left-color: var(--ok);
  }

  .intro p {
    font-size: 14.5px;
    line-height: 1.6;
    color: var(--text-dim);
  }

  .suggest {
    display: grid;
    gap: 8px;
    margin-top: 16px;
  }

  .suggest button {
    display: flex;
    justify-content: space-between;
    gap: 10px;
    text-align: left;
    padding: 12px 14px;
    border-radius: 13px;
    background: var(--surface);
    border: 1px solid var(--border);
    font-size: 14.5px;
    line-height: 1.4;
    color: var(--text);
  }

  .pen {
    color: var(--text-faint);
    flex: none;
  }

  .thread {
    list-style: none;
    display: grid;
    gap: 20px;
    margin: 0;
    padding: 0;
  }

  .thread li.user {
    justify-self: end;
    max-width: 88%;
  }

  .bubble.has-code {
    max-width: 100%;
    width: 100%;
    background: transparent;
    color: var(--text);
    padding: 0;
  }

  /* Prose with a block inside it: still a message you sent, but the accent fill would
     fight the highlighted code sitting on top of it. */
  .bubble.mixed {
    background: var(--surface);
    border: 1px solid var(--border);
    color: var(--text);
    width: 100%;
  }

  .bubble.mixed :global(.prose > *:last-child) {
    margin-bottom: 0;
  }

  textarea.code {
    font-family: var(--mono, ui-monospace, SFMono-Regular, Menlo, monospace);
    font-size: 13.5px;
    line-height: 1.5;
    white-space: pre;
    overflow-x: auto;
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

  .bubble {
    background: var(--accent);
    color: var(--accent-ink);
    padding: 10px 14px;
    border-radius: 17px 17px 5px 17px;
    font-size: 15.5px;
    line-height: 1.45;
    white-space: pre-wrap;
    overflow-wrap: anywhere;
  }

  /* The blinking block is doing real work: a reply that pauses mid-sentence between
     tokens otherwise reads as a hang. */
  .caret {
    display: inline-block;
    width: 8px;
    height: 15px;
    vertical-align: -2px;
    margin-left: 2px;
    background: var(--accent);
    border-radius: 2px;
    animation: blink 1s steps(2, start) infinite;
  }

  @keyframes blink {
    50% {
      opacity: 0;
    }
  }

  .err {
    margin-top: 16px;
    padding: 12px 14px;
    border-radius: 13px;
    background: var(--bad-soft);
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
  }

  .err p {
    font-size: 14px;
    color: var(--bad);
  }

  .composer {
    position: fixed;
    inset: auto 0 0 0;
    z-index: 15;
    padding: 8px 16px calc(var(--tab-h) + var(--safe-b) + 8px);
    background: color-mix(in srgb, var(--bg) 92%, transparent);
    backdrop-filter: saturate(180%) blur(20px);
    -webkit-backdrop-filter: saturate(180%) blur(20px);
    border-top: 1px solid var(--border);
  }

  .inner {
    display: flex;
    align-items: flex-end;
    gap: 8px;
    max-width: 620px;
    margin: 0 auto;
  }

  textarea {
    flex: 1;
    resize: none;
    padding: 10px 14px;
    border-radius: 19px;
    background: var(--bg-elev);
    border: 1px solid var(--border);
    color: var(--text);
    /* 16px exactly: anything smaller and iOS zooms the viewport on focus. */
    font-size: 16px;
    line-height: 1.4;
    font-family: inherit;
    max-height: 148px;
  }

  textarea:focus {
    outline: none;
    border-color: var(--accent);
  }

  .icon {
    flex: none;
    width: 38px;
    height: 38px;
    border-radius: 50%;
    background: var(--accent);
    color: var(--accent-ink);
    display: grid;
    place-items: center;
    transition: opacity 0.15s ease;
  }

  .icon:disabled {
    opacity: 0.35;
  }

  .icon.stop {
    background: var(--surface-2);
    color: var(--text);
  }

  .icon svg {
    width: 19px;
    height: 19px;
    fill: none;
    stroke: currentColor;
    stroke-width: 2.1;
    stroke-linecap: round;
    stroke-linejoin: round;
  }

  .icon.stop svg {
    fill: currentColor;
    stroke: none;
  }
</style>
