<script lang="ts">
  import { app } from '../lib/app.svelte';
  import Button from '../components/Button.svelte';
  import { relativeTime } from '../lib/date';
  import { PROVIDERS } from '../lib/mentor';
  import type { MentorProvider } from '../lib/types';

  const providers = Object.entries(PROVIDERS) as [MentorProvider, (typeof PROVIDERS)[MentorProvider]][];
  const provider = $derived(PROVIDERS[app.mentorProvider]);
  const selectedModel = $derived(app.mentorModels.find((m) => m.id === app.progress.settings.mentorModel));

  // Ask the provider what it can run when this screen opens, not on every app launch:
  // it's a round trip that only matters while the picker is on screen. The signature
  // guard is deliberate — an effect that re-fires on its own writes is a request loop,
  // and saving a key already refreshes the list on its own.
  let fetchedFor = '';
  $effect(() => {
    const signature = `${app.mentorProvider}:${app.mentorKey ?? ''}`;
    if (!app.mentorKey || signature === fetchedFor) return;
    fetchedFor = signature;
    void app.refreshMentorModels();
  });

  const themes = [
    { id: 'system', label: 'System' },
    { id: 'light', label: 'Light' },
    { id: 'dark', label: 'Dark' },
  ] as const;

  let importText = $state('');
  let tokenInput = $state('');
  let keyInput = $state('');
  let connecting = $state(false);
  let savingKey = $state(false);
  let confirmDisconnect = $state(false);
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

  async function connect() {
    const token = tokenInput.trim();
    if (!token) return;
    connecting = true;
    try {
      const how = await app.connectCloud(token);
      tokenInput = '';
      flash(
        'ok',
        how === 'adopted'
          ? 'Connected — found your existing backup and merged it in.'
          : 'Connected. A new secret gist is now holding your progress.',
      );
    } catch (err) {
      flash('bad', err instanceof Error ? err.message : 'Could not connect.');
    } finally {
      connecting = false;
    }
  }

  async function disconnect() {
    await app.disconnectCloud();
    confirmDisconnect = false;
    flash('ok', 'Disconnected. The gist is still on GitHub, untouched.');
  }

  async function syncNow() {
    await app.syncNow();
    if (app.cloud.status === 'error') flash('bad', app.cloud.error ?? 'Sync failed.');
    else flash('ok', 'Synced.');
  }

  async function saveKey() {
    savingKey = true;
    try {
      await app.setMentorKey(app.mentorProvider, keyInput);
      keyInput = '';
      // setMentorKey fetches the model list, which is also the cheapest possible check
      // that the key works — better to find out here than on his first question.
      if (app.mentorModelsError) flash('bad', app.mentorModelsError);
      else flash('ok', `${provider.label} key saved. The Mentor tab is live.`);
    } finally {
      savingKey = false;
    }
  }

  async function removeKey() {
    await app.setMentorKey(app.mentorProvider, null);
    fetchedFor = '';
    flash('ok', `${provider.label} key removed from this device.`);
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
    <h2>Sync</h2>
    {#if app.cloudConnected}
      <div class="status">
        <span class="dot {app.cloud.status}"></span>
        <div>
          <strong>
            {#if app.cloud.status === 'syncing'}Syncing…
            {:else if app.cloud.status === 'error'}Sync problem
            {:else if app.cloud.lastSyncAt}Synced {relativeTime(app.cloud.lastSyncAt)}
            {:else}Connected{/if}
          </strong>
          <p class="hint">
            {#if app.cloud.error}
              {app.cloud.error}
            {:else}
              Progress rides in a secret gist on your GitHub account. It syncs on
              launch, when you switch back to the app, and a few seconds after
              anything changes.
            {/if}
          </p>
        </div>
      </div>
      <div class="pair">
        <Button variant="secondary" size="sm" onclick={syncNow}>Sync now</Button>
        {#if app.gistUrl}
          <Button variant="ghost" size="sm" href={app.gistUrl} external>View the gist</Button>
        {/if}
      </div>
      {#if confirmDisconnect}
        <p class="hint">
          This forgets the token on this device. The gist and everything in it stays on
          GitHub — reconnecting later pulls it all back.
        </p>
        <div class="pair">
          <Button variant="danger" size="sm" onclick={disconnect}>Disconnect</Button>
          <Button variant="ghost" size="sm" onclick={() => (confirmDisconnect = false)}>Cancel</Button>
        </div>
      {:else}
        <p class="hint">
          <button class="inline-link" onclick={() => (confirmDisconnect = true)}>Disconnect this device</button>
        </p>
      {/if}
    {:else}
      <p class="hint">
        Copying JSON between devices gets old fast. Give the app a GitHub token and it
        keeps your progress in a secret gist instead — free, no account beyond the one
        you have, and nothing to run.
      </p>
      <ol class="steps">
        <li>
          Open
          <a href="https://github.com/settings/personal-access-tokens/new" target="_blank" rel="noreferrer">
            github.com/settings/personal-access-tokens/new</a>.
        </li>
        <li>Under <strong>Account permissions</strong>, set <strong>Gists</strong> to <strong>Read and write</strong>. Leave everything else alone.</li>
        <li>Generate it, copy it, paste it here.</li>
      </ol>
      <p class="hint fine">
        That token can read and write your gists and nothing else — it can't touch a
        repo or push code, and you can revoke it from that same page. It's stored on
        this device only, and never inside the synced data.
      </p>
      <input
        class="secret"
        type="password"
        autocomplete="off"
        autocapitalize="off"
        spellcheck="false"
        placeholder="github_pat_…"
        bind:value={tokenInput}
      />
      <Button size="sm" disabled={connecting || !tokenInput.trim()} onclick={connect}>
        {connecting ? 'Connecting…' : 'Connect'}
      </Button>
    {/if}
  </section>

  <section>
    <h2>Backup</h2>
    <p class="hint">
      A file you can hold. Sync above covers the day-to-day; this is for moving to a
      device that isn't signed in, or keeping a copy that doesn't depend on GitHub.
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
    <p class="hint">
      Ask a question in context without leaving the app. It knows which day you're on,
      and it won't write your task for you.
    </p>

    <div class="segmented two" role="radiogroup" aria-label="Provider">
      {#each providers as [id, info]}
        <button
          role="radio"
          aria-checked={app.mentorProvider === id}
          class:on={app.mentorProvider === id}
          onclick={() => app.setMentorProvider(id)}
        >
          {info.label}
          {#if info.free}<span class="tag">free</span>{/if}
        </button>
      {/each}
    </div>
    <p class="hint fine">{provider.cost}</p>

    {#if app.mentorKey}
      <div class="status">
        <span class="dot ok"></span>
        <div>
          <strong>{provider.label} key saved on this device</strong>
          <p class="hint">Never leaves it, and never rides along in the synced progress.</p>
        </div>
      </div>
      <div class="pair">
        <Button variant="ghost" size="sm" onclick={removeKey}>Remove key</Button>
      </div>
    {:else}
      <ol class="steps">
        <li>
          Open
          <a href={provider.consoleUrl} target="_blank" rel="noreferrer">{provider.consoleLabel}</a>
          {#if app.mentorProvider === 'gemini'}and sign in with a Google account{/if}.
        </li>
        {#if app.mentorProvider === 'gemini'}
          <li><strong>Create API key</strong> → pick any project it offers, or let it make one.</li>
        {:else}
          <li>Create a key, then add credits — the API is prepaid and a Claude subscription doesn't cover it.</li>
        {/if}
        <li>Copy it, paste it here.</li>
      </ol>
      <input
        class="secret"
        type="password"
        autocomplete="off"
        autocapitalize="off"
        spellcheck="false"
        placeholder={provider.placeholder}
        bind:value={keyInput}
      />
      <Button size="sm" disabled={savingKey || !keyInput.trim()} onclick={saveKey}>
        {savingKey ? 'Checking…' : 'Save key'}
      </Button>
    {/if}

    <div class="models">
      <h3>
        Model
        {#if app.loadingModels}<span class="loading">loading…</span>{/if}
      </h3>
      <select
        aria-label="Model"
        value={app.progress.settings.mentorModel}
        onchange={(e) => app.setMentorModel(e.currentTarget.value)}
      >
        {#each app.mentorModels as m}
          <option value={m.id}>{m.label}</option>
        {/each}
        {#if !app.mentorModels.some((m) => m.id === app.progress.settings.mentorModel)}
          <option value={app.progress.settings.mentorModel}>{app.progress.settings.mentorModel}</option>
        {/if}
      </select>
      {#if selectedModel?.note}
        <p class="hint">{selectedModel.note}</p>
      {/if}
      {#if app.mentorModelsError}
        <p class="hint bad-hint">Couldn't fetch the model list: {app.mentorModelsError}</p>
      {:else if app.mentorProvider === 'gemini' && app.mentorKey}
        <p class="hint">
          Fetched from Google, so it's whatever your key can actually run. Flash models
          are listed first — their free-tier limits are the most generous.
        </p>
      {/if}
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
      <p class="hint">
        This wipes progress, streak, XP, badges and notes on this device, and switches
        sync off so the empty record doesn't overwrite your backup. Your API keys stay.
        {#if app.cloudConnected}Reconnecting afterwards pulls the cloud copy back.{/if}
      </p>
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


  .status {
    display: flex;
    gap: 10px;
    align-items: flex-start;
  }

  .status strong {
    font-size: 15.5px;
    font-weight: 600;
  }

  .status .hint {
    margin-top: 3px;
  }

  .dot {
    flex: none;
    width: 9px;
    height: 9px;
    margin-top: 6px;
    border-radius: 50%;
    background: var(--ok);
  }

  .dot.error {
    background: var(--bad);
  }

  .dot.syncing,
  .dot.idle {
    background: var(--text-faint);
  }

  .steps {
    margin: 12px 0 0;
    padding-left: 20px;
    font-size: 13.5px;
    line-height: 1.6;
    color: var(--text-dim);
  }

  .steps li {
    margin-bottom: 5px;
  }

  .steps a {
    color: var(--accent);
  }

  .fine {
    border-left: 2px solid var(--border-strong);
    padding-left: 11px;
  }

  .secret {
    display: block;
    width: 100%;
    margin: 14px 0 10px;
    padding: 11px 13px;
    background: var(--bg-elev);
    border: 1px solid var(--border);
    border-radius: 12px;
    color: var(--text);
    font-family: var(--font-mono);
    /* 16px or iOS zooms the page when it gets focus. */
    font-size: 16px;
  }

  .secret:focus {
    outline: none;
    border-color: var(--accent);
  }

  .inline-link {
    color: var(--accent);
    font-size: 13.5px;
    font-weight: 600;
  }

  .segmented.two {
    grid-template-columns: repeat(2, 1fr);
    margin-top: 12px;
  }

  .tag {
    font-size: 9.5px;
    font-weight: 700;
    letter-spacing: 0.06em;
    text-transform: uppercase;
    vertical-align: 2px;
    margin-left: 5px;
    padding: 1px 5px;
    border-radius: 999px;
    background: var(--ok-soft);
    color: var(--ok);
  }

  .models {
    margin-top: 22px;
  }

  .models h3 {
    font-size: 12px;
    font-weight: 700;
    letter-spacing: 0.08em;
    text-transform: uppercase;
    color: var(--text-faint);
    margin-bottom: 10px;
  }

  .loading {
    text-transform: none;
    letter-spacing: 0;
    font-weight: 500;
    margin-left: 6px;
  }

  /* A select rather than radio cards: Gemini's list comes from the API and can run to
     dozens of entries, which iOS renders as a native wheel picker. */
  select {
    width: 100%;
    padding: 11px 13px;
    background: var(--bg-elev);
    border: 1px solid var(--border);
    border-radius: 12px;
    color: var(--text);
    /* 16px or iOS zooms the page when it gets focus. */
    font-size: 16px;
    font-family: inherit;
  }

  .bad-hint {
    color: var(--bad);
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
