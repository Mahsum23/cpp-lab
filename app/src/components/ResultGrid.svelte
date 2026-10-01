<script lang="ts">
  /**
   * A query result, the way psql would draw it: column names over rows of text, NULL shown
   * as a faint NULL so it can never be mistaken for the string. Wide results scroll
   * sideways inside the box rather than stretching the page.
   */
  import type { Cell } from '../lib/writecheck';

  interface Props {
    columns: string[];
    rows: Cell[][];
    /** Rows shown before "… N more". */
    limit?: number;
    /** Rows (as JSON keys) to mark as the ones that disagree with the target. */
    mark?: Set<string>;
    caption?: string;
  }
  let { columns, rows, limit = 6, mark, caption }: Props = $props();

  const shown = $derived(rows.slice(0, limit));
  const key = (r: Cell[]) => JSON.stringify(r);
</script>

<div class="grid" role="table" aria-label={caption}>
  {#if columns.length === 0}
    <p class="none">No result set — the statement ran, but returned no rows.</p>
  {:else}
    <table>
      <thead>
        <tr>{#each columns as c}<th>{c}</th>{/each}</tr>
      </thead>
      <tbody>
        {#each shown as row}
          <tr class:off={mark?.has(key(row))}>
            {#each row as cell}
              <td>{#if cell === null}<span class="null">NULL</span>{:else}{cell}{/if}</td>
            {/each}
          </tr>
        {:else}
          <tr><td class="empty" colspan={columns.length}>(0 rows)</td></tr>
        {/each}
      </tbody>
    </table>
    {#if rows.length > limit}
      <p class="more">… {rows.length - limit} more row{rows.length - limit === 1 ? '' : 's'}</p>
    {/if}
  {/if}
</div>

<style>
  .grid {
    overflow-x: auto;
    border: 1px solid var(--border);
    border-radius: 10px;
    background: var(--bg-elev);
  }

  table {
    border-collapse: collapse;
    width: 100%;
    font-family: var(--font-mono);
    font-size: 12.5px;
  }

  th,
  td {
    padding: 6px 11px;
    text-align: left;
    white-space: nowrap;
  }

  th {
    font-weight: 700;
    color: var(--text-dim);
    border-bottom: 1px solid var(--border);
    background: var(--surface-2);
  }

  td {
    color: var(--text);
  }

  tr + tr td {
    border-top: 1px solid color-mix(in srgb, var(--border) 55%, transparent);
  }

  tr.off td {
    background: color-mix(in srgb, var(--bad) 14%, transparent);
  }

  .null {
    color: var(--text-faint);
    font-style: italic;
  }

  .empty,
  .none,
  .more {
    color: var(--text-faint);
    font-size: 12.5px;
  }

  .none,
  .more {
    margin: 0;
    padding: 8px 11px;
  }
</style>
