# An index is a sorted copy

## Theory

Yesterday: a table is a heap of pages, and finding a row without help means reading all
of them. Today: what an index actually is, and the four separate reasons a perfectly good
one gets ignored.

### It is a second table you don't get to see

An index is not an annotation on a table, and it is not a hint. It is **another B-tree,
containing the indexed columns plus a pointer back to the row's physical location**, kept
sorted.

That single sentence explains almost everything indexes do:

- Lookups get fast, because the tree is sorted — finding a value is a descent through
  three or four pages instead of a walk through all of them.
- Writes get slower, because every `INSERT` now writes two trees, and (as yesterday's
  `ctid` lesson showed) an `UPDATE` that moves a row writes *every* index on the table.
- The database gets bigger, sometimes much bigger, because the index is a real copy of
  real data.
- `ORDER BY` on the indexed column can become free — the sorted order already exists on
  disk, so there is nothing to sort.

That third point is not theoretical. Two indexes on a 50,000-row table:

```
  relname  | pg_size_pretty
-----------+----------------
 idx_lower | 1544 kB
 idx_name  | 1544 kB
 s         | 4552 kB
```

Two indexes on one column each, and they are already two thirds of the size of the table
holding three columns. This is why index bloat is a real budget line and why
`pg_stat_user_indexes.idx_scan = 0` — an index nobody has ever used — is the first thing
a Postgres consultant grep's for.

You never pay for an index once. You pay on every write, forever, in exchange for the
reads.

### Ask the planner, never guess

Every engine will tell you its plan. In Postgres:

```sql
CREATE TABLE s(id bigserial PRIMARY KEY, name text, note text);
INSERT INTO s(name, note) SELECT 'name' || g, repeat('x', 40) FROM generate_series(1, 50000) g;
ANALYZE s;
EXPLAIN SELECT * FROM s WHERE name = 'name7';
```

```
                     QUERY PLAN
-----------------------------------------------------
 Seq Scan on s  (cost=0.00..1194.00 rows=1 width=58)
   Filter: (name = 'name7'::text)
```

`Seq Scan` — every page, to find one row. Now build the index:

```sql
CREATE INDEX idx_name ON s(name);
ANALYZE s;
EXPLAIN SELECT * FROM s WHERE name = 'name7';
```

```
 Index Scan using idx_name on s  (cost=0.29..8.31 rows=1 width=58)
   Index Cond: (name = 'name7'::text)
```

Cost 1194 to cost 8.31. Note `ANALYZE` in there — not `EXPLAIN ANALYZE`, the *other*
`ANALYZE`, which updates the planner's statistics. Postgres does not pick plans by
reading your query; it picks them by estimating rows from a sample of your data. Stale
statistics are behind an enormous share of "it was fast yesterday" incidents, and it is
the first thing to check after a bulk load.

Two numbers, both estimates: `cost` is in arbitrary units where 1.0 is roughly one
sequential page read, and `rows` is how many the planner *thinks* will come back.
`EXPLAIN ANALYZE` runs the query and prints what really happened next to the guess — and
the gap between estimate and reality is where nearly every planner mystery is solved.

### Reason one: you asked about a different value

Here is the rule that catches everyone: **an index on a column can only answer questions
about that column's value.** Wrap the column in a function and you are asking about a
different value, which the sorted copy is not sorted by.

```sql
EXPLAIN SELECT * FROM s WHERE lower(name) = 'name7';
```

```
 Seq Scan on s  (cost=0.00..1319.00 rows=250 width=58)
   Filter: (lower(name) = 'name7'::text)
```

`Seq Scan`, with `idx_name` sitting right there. Same story for `WHERE price * 1.2 > 100`,
`WHERE date(created_at) = '2026-01-01'`, and every `WHERE CAST(id AS text) = ?` written to
make a type error go away. Postgres's answer is to let you index the expression itself:

```sql
CREATE INDEX idx_lower ON s(lower(name));
ANALYZE s;
EXPLAIN SELECT * FROM s WHERE lower(name) = 'name7';
```

```
 Index Scan using idx_lower on s  (cost=0.29..8.31 rows=1 width=58)
   Index Cond: (lower(name) = 'name7'::text)
```

Expression indexes are a genuine Postgres advantage — MySQL only got them in 8.0.13, in
2018 — and the case-insensitive-email index is the single most common use of them in
production schemas anywhere.

### Reason two: the index would be slower

This is the one people refuse to believe, so watch it happen. One table, one index, one
query shape — only the *value* changes:

```
=== WHERE status = 'rare'      (2,000 of 200,000 rows)
 Index Only Scan using idx_status on t2 (actual time=0.033..1.644 rows=2000 loops=1)
 Execution Time: 1.788 ms

=== WHERE status = 'common'    (198,000 of 200,000 rows)
 Parallel Seq Scan on t2 (actual time=0.016..13.148 rows=99000 loops=2)
 Execution Time: 24.699 ms
```

The planner used the index for `'rare'` and *refused* it for `'common'`, and it was right
both times. An index scan costs one descent per matching row, plus a jump to the heap for
each; once you are fetching most of the table, reading it straight through in physical
order is cheaper than 198,000 random jumps. This is why "add an index" does nothing for
your `WHERE deleted = false` filter when 99% of rows are not deleted — and why a partial
index (`CREATE INDEX ... WHERE deleted = true`) is often the actual answer.

### Reason three: the query needed a column the index doesn't carry

If the index contains every column the query needs, the engine can answer from the index
alone and never touch the heap:

```sql
EXPLAIN SELECT name FROM s WHERE name = 'name7';
```

```
 Index Only Scan using idx_name on s  (cost=0.29..8.31 rows=1 width=9)
```

**`Index Only Scan`** is the phrase to look for — it means the second lookup, index to
row, did not happen. Change that `SELECT name` to `SELECT *` and it drops back to a plain
`Index Scan`, because `note` only exists in the heap. This is why adding one more column
to an existing index sometimes beats adding a whole new index, and Postgres has dedicated
syntax for exactly that: `CREATE INDEX ... INCLUDE (note)` carries the extra column in the
index's leaf pages without making it part of the sort key.

> [!NOTE]
> Index-only scans in Postgres are only *mostly* index-only. The index has no visibility
> information, so the engine still has to know whether each row is visible to your
> transaction — it consults the **visibility map**, one bit per page saying "everything on
> this page is visible to everyone". Pages the map hasn't marked force a heap fetch
> anyway. `EXPLAIN ANALYZE` prints `Heap Fetches:`, and a high number there on a
> supposedly index-only scan almost always means the table needs vacuuming. Two lessons
> in and vacuum is already the answer to a second unrelated question.

### Worth knowing: `C.UTF-8` is not `C`, and the difference is a sequential scan

A prefix search looks like it should be a range scan — everything starting with `name7`
is contiguous in a sorted list. It isn't:

```sql
EXPLAIN SELECT * FROM s WHERE name LIKE 'name7%';
```

```
 Seq Scan on s  (cost=0.00..1194.00 rows=1010 width=58)
   Filter: (name ~~ 'name7%'::text)
```

The reason is **collation**. An index is sorted according to some collation, and a
locale-aware one (`en_US.UTF-8`, and yes `C.UTF-8`) can sort in ways where the strings
matching a prefix are not one contiguous run — so `LIKE 'x%'` cannot be turned into a
range. Only the `C` collation, which compares byte by byte, guarantees it can.

The trap is that `C.UTF-8` *looks* like `C` and is not. Prove it by declaring an index
with the real thing:

```sql
CREATE INDEX idx_c ON s(name COLLATE "C");
ANALYZE s;
EXPLAIN SELECT * FROM s WHERE name LIKE 'name7%';
```

```
 Bitmap Heap Scan on s  (cost=26.44..624.27 rows=1010 width=58)
   ->  Bitmap Index Scan on idx_c  (cost=0.00..26.19 rows=990 width=0)
         Index Cond: ((name >= 'name7'::text) AND (name < 'name8'::text))
```

Look at what the planner did with your `LIKE`: it rewrote it into `name >= 'name7' AND
name < 'name8'`, a range, exactly as the intuition said it should. The equivalent without
touching collation is a `text_pattern_ops` index, which sorts by byte regardless of the
database's locale.

Two more things worth carrying out of this. First, the plan is a **Bitmap Heap Scan**, not
an Index Scan — Postgres's middle gear for when a few thousand rows match: collect all
their locations first, sort them into physical order, then sweep the heap once. Second,
and this is the part that bites in production: a database created with a locale-aware
collation will *silently* not use your index for prefix searches, and you will discover it
the week after it worked on someone's laptop where the default was different.

## Quiz

1. You add an index to speed up a slow report. Name two distinct costs you have just
   taken on.
2. A query filters on an indexed column and the plan still shows `Seq Scan`, even though
   the index exists and the column is right. Give two different reasons that can happen.
3. What does `Index Only Scan` mean in a PostgreSQL plan, what work does it save, and
   what can still force it to touch the heap anyway?
4. Your table has an index on `email`. Which of `WHERE email = ?`, `WHERE lower(email) = ?`
   and `WHERE email LIKE 'a%'` can use it, and what decides the last one?
5. `EXPLAIN` says a query will return 3 rows; `EXPLAIN ANALYZE` shows it returned 40,000.
   What is most likely wrong, and what does the planner do with a bad estimate?

## Task

Prove each of these to yourself rather than taking the lesson's word for it. Use enough
rows that the planner has a real decision to make — 50,000 is plenty, and
`generate_series` will produce them in one statement.

1. `EXPLAIN` an equality filter with no index. Record the plan and its cost.
2. Add the index, `ANALYZE`, run it again, and record how both changed.
3. Wrap the column in `lower()` and watch it fall back to a sequential scan.
4. Add an expression index and watch it recover.
5. Get one query to report `Index Only Scan`, then change it so the same index gives you
   a plain `Index Scan`, and work out what you changed.
6. Build a column where one value is rare and one is common, index it, and find the query
   where Postgres uses the index and the query where it refuses. Use `EXPLAIN ANALYZE` and
   compare the execution times — the refusal should be the faster one.

Write every plan you saw into the file as a comment beside the query that produced it.
That file is the point of the exercise, not the queries.

- File: `sql/day02.sql`
- Run: `psql -h localhost -U postgres -f sql/day02.sql`

### Checklist

- [ ] the same query planned with and without an index, both plans and costs recorded
- [ ] a function on the indexed column observed falling back to a sequential scan
- [ ] an expression index built, and the plan recovering
- [ ] one query reporting `Index Only Scan`, and one reporting `Index Scan` off the same
      index, and you can say what the difference was
- [ ] the planner observed *refusing* an index for an unselective value, with
      `EXPLAIN ANALYZE` timings showing it was right to
