import { app } from './app.svelte';
import * as store from './storage';
import { streamReply, systemPrompt, type ChatMessage } from './mentor';

/** One thread per day, plus a general one for questions that aren't about a lesson. */
export const GENERAL = 'general';

interface StoredThread {
  messages: ChatMessage[];
  updatedAt: string;
}

class ChatStore {
  messages = $state<ChatMessage[]>([]);
  streaming = $state(false);
  error = $state<string | null>(null);

  /**
   * Which thread is loaded, and a counter for discarding stale loads.
   *
   * Deliberately NOT `$state`. `open()` is called from an effect, and an effect that
   * reads the same state it writes re-runs itself forever — which it did: several
   * hundred loads a second, and a load that landed mid-send wiping the message the
   * user had just typed. Effects may write reactive state; they must not read what
   * they write. This is the loader's own bookkeeping, so it stays outside the graph.
   */
  private key = GENERAL;
  private generation = 0;

  private controller: AbortController | null = null;

  get empty(): boolean {
    return this.messages.length === 0;
  }

  get threadKey(): string {
    return this.key;
  }

  /** Switch threads. Cancels an in-flight reply — the answer belongs to the thread
   *  that asked for it, and there's nowhere to put it once you've left. */
  async open(key: string): Promise<void> {
    if (key === this.key) return;
    this.stop();
    this.key = key;
    this.error = null;

    const mine = ++this.generation;
    const thread = await store.loadChat<StoredThread>(key);
    // Someone else owns the array now — a newer open(), or a message sent while
    // this read was in flight.
    if (mine !== this.generation) return;
    this.messages = thread?.messages ?? [];
  }

  private async persist() {
    await store.saveChat(this.key, {
      messages: $state.snapshot(this.messages),
      updatedAt: new Date().toISOString(),
    } satisfies StoredThread);
  }

  stop() {
    this.controller?.abort();
    this.controller = null;
    this.streaming = false;
  }

  async clear() {
    this.stop();
    this.generation += 1;
    this.messages = [];
    this.error = null;
    await store.deleteChat(this.key);
  }

  /** Re-send after a failure, without making him retype the question. */
  async retry(): Promise<void> {
    if (this.streaming || this.messages.at(-1)?.role !== 'user') return;
    await this.run();
  }

  async send(text: string): Promise<void> {
    const content = text.trim();
    if (!content || this.streaming) return;
    // Claim the array before the first await, so a load still in flight can't
    // replace it with what was on disk a moment ago.
    this.generation += 1;
    this.messages.push({ role: 'user', content });
    await this.persist();
    await this.run();
  }

  private async run(): Promise<void> {
    const key = app.mentorKey;
    if (!key) {
      this.error = 'No API key set — add one in Settings.';
      return;
    }

    this.error = null;
    this.streaming = true;
    this.controller = new AbortController();

    // The placeholder goes in before the first token so the bubble is already on
    // screen, streaming into itself, rather than appearing 800ms later.
    const index = this.messages.length;
    const history = $state.snapshot(this.messages);
    this.messages.push({ role: 'assistant', content: '' });

    try {
      const context = app.current ?? app.availableDays.at(-1) ?? null;
      for await (const chunk of streamReply({
        provider: app.mentorProvider,
        key,
        model: app.progress.settings.mentorModel,
        system: systemPrompt(context),
        messages: history,
        signal: this.controller.signal,
      })) {
        // A thread switch or a clear during the stream retires this reply.
        if (this.messages[index]?.role !== 'assistant') return;
        this.messages[index].content += chunk;
      }
      // An aborted stream just stops yielding; whatever arrived is worth keeping,
      // but an empty bubble is not.
      if (this.messages[index] && !this.messages[index].content) this.messages.splice(index, 1);
    } catch (err) {
      this.error = err instanceof Error ? err.message : 'The mentor is unavailable.';
      if (this.messages[index]?.role === 'assistant') this.messages.splice(index, 1);
    } finally {
      this.streaming = false;
      this.controller = null;
      await this.persist();
    }
  }
}

export const chat = new ChatStore();
