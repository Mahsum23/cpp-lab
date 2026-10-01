/**
 * The Postgres that runs your answer, in a worker.
 *
 * PGlite is the real PostgreSQL compiled to WebAssembly: same parser, same planner, same
 * error messages, running on the phone with no server. It lives in a worker for one
 * reason above all — it cannot be interrupted. `statement_timeout` does nothing in it
 * (there is no timer to deliver the cancel) and an endless `WITH RECURSIVE` never
 * returns, so the only way to stop a query that has run away is to throw the whole worker
 * away. That is only possible if it is not the page. What it does is in sqlcore.ts.
 */
import { PGlite } from '@electric-sql/pglite';
import { createCore, type Job, type Reply } from './sqlcore';

const send = (r: Reply) => postMessage(r);

try {
  const db = new PGlite();
  await db.waitReady;
  const core = createCore(db, send);
  onmessage = (e: MessageEvent<Job>) => void core.handle(e.data);
  send({ type: 'ready' });
} catch (err) {
  send({ type: 'boot-error', message: err instanceof Error ? err.message : String(err) });
}
