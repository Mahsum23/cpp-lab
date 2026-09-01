<script lang="ts">
  import { app } from '../lib/app.svelte';
  import Button from '../components/Button.svelte';

  const themes = [
    { id: 'system', label: 'System' },
    { id: 'light', label: 'Light' },
    { id: 'dark', label: 'Dark' },
  ] as const;

  let importText = $state('');
  let message = $state<{ kind: 'ok' | 'bad'; text: string } | null>(null);
  let confirmingReset = $state(false);

  const standalone = matchMedia('(display-mode: standalone)').matches ||
    (navigator as { standalone?: boolean }).standalone === true;

  function flash(kind: 'ok' | 'bad', text: string) {
    message = { kind, text };
    setTimeout(() => (message = null), 3200);
  }

  async function copyExport() {
    const json = app.exportJSON();
    try {
      await navigator.clipboard.writeText(json);
      flash('ok', 'Progress JSON copied to the clipboard.');
    } catch {
      importText = json;
      flash('ok', 'Clipboard blocked — the JSON is in the box below, select and copy it.');
    }
  }

  function downloadExport() {
    const blob = new Blob([app.exportJSON()], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `cpp-lab-progress-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  async function doImport() {
    try {
      await app.importJSON(importText);
      importText = '';
      flash('ok', 'Progress restored.');
    } catch (err) {
      flash('bad', err instanceof Error ? err.message : 'Could not read that.');
    }
  }

  async function onFile(e: Event) {
    const file = (e.currentTarget as HTMLInputElement).files?.[0];
    if (file) importText = await file.text();
  }

  async function reset() {
    await app.resetAll();
    confirmingReset = false;
    flash('ok', 'Wiped. Back to day one.');
  }
</script>

<div class="screen">
  <h1>Settings</h1>

  <section>
    <h2>Theme</h2>
    <div class="segmented" role="radiogroup" aria-label="Theme">
      {#each themes as t}
        <button
          role="radio"
          aria-checked={app.progress.settings.theme === t.id}
          class:on={app.progress.settings.theme === t.id}
          onclick={() => app.setTheme(t.id)}
        >
          {t.label}
        </button>
      {/each}
    </div>
  </section>

  <section>
    <h2>Pace</h2>
    <label class="switch">
      <input
        type="checkbox"
        checked={app.progress.settings.peekAhead}
        onchange={(e) => app.setPeekAhead(e.currentTarget.checked)}
      />
      <span>Unlock days ahead</span>
    </label>
    <p class="hint">One session a day is the design. This just removes the lock if you insist.</p>
  </section>

  <section>
    <h2>Backup</h2>
    <p class="hint">
      Progress lives only on this device, and iOS will evict a web app's storage if you
      leave it alone long enough. Export occasionally — it's the only safety net there is.
    </p>
    <div class="pair">
      <Button variant="secondary" size="sm" onclick={copyExport}>Copy progress JSON</Button>
      <Button variant="secondary" size="sm" onclick={downloadExport}>Download file</Button>
    </div>

    <details>
      <summary>Restore from a backup</summary>
      <input type="file" accept="application/json,.json" onchange={onFile} />
      <textarea rows="4" placeholder="…or paste the JSON here" bind:value={importText}></textarea>
      <Button variant="secondary" size="sm" disabled={!importText.trim()} onclick={doImport}>
        Restore
      </Button>
    </details>
  </section>

  <section>
    <h2>Mentor chat</h2>
    <div class="disabled-row">
      <div>
        <strong>Anthropic API key</strong>
        <p class="hint">
          Ask the mentor a question in context, without leaving the app. Coming in v2 —
          it'll answer "why" freely and still refuse to write your echo server.
        </p>
      </div>
      <span class="soon">v2</span>
    </div>
  </section>

  {#if !standalone}
    <section>
      <h2>Install it</h2>
      <p class="hint">
        In Safari: <strong>Share</strong> → <strong>Add to Home Screen</strong>. You get an
        icon, full screen, no browser chrome, and it keeps working offline. Chrome on iOS
        can't do this — it has to be Safari.
      </p>
    </section>
  {/if}

  <section>
    <h2>Danger</h2>
    {#if confirmingReset}
      <p class="hint">This wipes progress, streak, XP, badges and notes on this device.</p>
      <div class="pair">
        <Button variant="danger" size="sm" onclick={reset}>Yes, wipe it</Button>
        <Button variant="ghost" size="sm" onclick={() => (confirmingReset = false)}>Cancel</Button>
      </div>
    {:else}
      <Button variant="danger" size="sm" onclick={() => (confirmingReset = true)}>
        Reset all progress
      </Button>
    {/if}
  </section>

  <p class="version">
    cpp-lab · content {app.curriculum?.generatedAt?.slice(0, 10) ?? 'not loaded'}
    {#if app.sync.status === 'offline'}· offline{/if}
  </p>

  {#if message}
    <p class="flash {message.kind}">{message.text}</p>
  {/if}
</div>

<style>
  h1 {
    font-size: 27px;
    letter-spacing: -0.025em;
    margin-bottom: 24px;
  }

  h2 {
    font-size: 12px;
    font-weight: 700;
    letter-spacing: 0.08em;
    text-transform: uppercase;
    color: var(--text-faint);
    margin: 0 0 10px;
  }

  section {
    margin-bottom: 30px;
  }

  .hint {
    font-size: 13.5px;
    line-height: 1.5;
    color: var(--text-dim);
    margin: 8px 0 0;
  }

  .segmented {
    display: grid;
    grid-template-columns: repeat(3, 1fr);
    gap: 3px;
    background: var(--surface-2);
    border-radius: 12px;
    padding: 3px;
  }

  .segmented button {
    padding: 9px 0;
    border-radius: 9px;
    font-size: 14.5px;
    font-weight: 600;
    color: var(--text-dim);
    transition: background 0.15s ease;
  }

  .segmented button.on {
    background: var(--surface);
    color: var(--text);
    box-shadow: var(--shadow);
  }

  .switch {
    display: flex;
    align-items: center;
    gap: 11px;
    font-size: 15.5px;
    font-weight: 550;
  }

  .switch input {
    width: 20px;
    height: 20px;
    accent-color: var(--accent);
  }

  .pair {
    display: flex;
    gap: 8px;
    flex-wrap: wrap;
    margin-top: 12px;
  }

  details {
    margin-top: 14px;
  }

  summary {
    font-size: 14px;
    color: var(--accent);
    font-weight: 600;
    cursor: pointer;
  }

  details input[type='file'] {
    display: block;
    margin: 12px 0;
    font-size: 13px;
    color: var(--text-dim);
  }

  textarea {
    width: 100%;
    background: var(--bg-elev);
    border: 1px solid var(--border);
    border-radius: 12px;
    padding: 10px;
    font-family: var(--font-mono);
    font-size: 16px;
    color: var(--text);
    margin-bottom: 10px;
  }

  .disabled-row {
    display: flex;
    gap: 12px;
    align-items: flex-start;
    justify-content: space-between;
    opacity: 0.6;
  }

  .disabled-row .hint {
    margin-top: 4px;
  }

  .soon {
    flex: none;
    font-size: 11px;
    font-weight: 700;
    letter-spacing: 0.06em;
    background: var(--surface-2);
    border-radius: 999px;
    padding: 4px 10px;
    color: var(--text-faint);
  }

  .version {
    text-align: center;
    font-size: 12px;
    color: var(--text-faint);
    margin-top: 34px;
  }

  .flash {
    position: fixed;
    left: 16px;
    right: 16px;
    bottom: calc(var(--tab-h) + var(--safe-b) + 14px);
    max-width: 588px;
    margin: 0 auto;
    text-align: center;
    font-size: 14px;
    padding: 11px 14px;
    border-radius: 12px;
    box-shadow: var(--shadow-lift);
    animation: rise 0.25s ease;
  }

  .flash.ok {
    background: var(--ok-soft);
    color: var(--ok);
  }

  .flash.bad {
    background: var(--bad-soft);
    color: var(--bad);
  }

  @keyframes rise {
    from {
      opacity: 0;
      transform: translateY(8px);
    }
  }
</style>
