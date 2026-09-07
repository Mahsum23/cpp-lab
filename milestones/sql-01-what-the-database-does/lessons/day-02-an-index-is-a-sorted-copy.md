# An index is a sorted copy

## Theory

Yesterday: a table is pages, and finding a row without help means reading them all.
Today: what an index actually is, and the exact reasons a perfectly good one gets
ignored.

### It is a second table you don't get to see

An index is not an annotation on a table, and it is not a hint. It is **another B-tree,
containing the indexed columns plus a pointer back to the row**, kept sorted.

That single sentence explains almost everything indexes do:

- Lookups get fast because the tree is sorted, so finding a value is a descent through
  a handful of pages instead of a walk through all of them.
- Writes get slower because every `INSERT` now writes two trees, and every `UPDATE` of
  an indexed column writes two trees.
- The database gets bigger, sometimes larger than the table, because the index is a
  real copy of real data.
- `ORDER BY` on the indexed column can become free — the sorted order already exists on
  disk, so there is nothing to sort.

You never pay for an index once. You pay on every write, forever, in exchange for the
reads.

### Ask the engine what it plans to do

Never guess about this. Every engine will tell you, and in SQLite the question is:

```sql
CREATE TABLE t(id INTEGER PRIMARY KEY, name TEXT, note TEXT);
EXPLAIN QUERY PLAN SELECT * FROM t WHERE name = 'name7';
CREATE INDEX idx_name ON t(name);
EXPLAIN QUERY PLAN SELECT * FROM t WHERE name = 'name7';
```

Before the index, the plan is one word you should learn to dread:

```
SCAN t
```

After it:

```
SEARCH t USING INDEX idx_name (name=?)
```

(`SELECT *` here wants `note`, which the index doesn't carry — hold that thought.)

**SCAN means every row. SEARCH means a descent.** In PostgreSQL the same distinction is
`Seq Scan` versus `Index Scan`, and `EXPLAIN ANALYZE` there will also run the query and
report what really happened, which is the version you want when the estimate and reality
disagree.

### Why a perfectly good index gets ignored

Here is the rule that catches everyone: **an index on a column can only answer questions
about that column's value.** The moment you wrap the column in a function, you are
asking about a different value, and the sorted copy is sorted by the wrong thing.

```sql
EXPLAIN QUERY PLAN SELECT * FROM t WHERE lower(name) = 'name7';
```

`SCAN t`, with `idx_name` sitting right there. The index is ordered by `name`; the query
asks about `lower(name)`; nothing in the tree is in that order. Same story for
`WHERE price * 1.2 > 100`, `WHERE date(created_at) = '2026-01-01'`, and every
`WHERE CAST(id AS TEXT) = ?` written to make a type error go away.

The fix is to index the expression you actually query:

```sql
CREATE INDEX idx_lower ON t(lower(name));
EXPLAIN QUERY PLAN SELECT * FROM t WHERE lower(name) = 'name7';
```

```
SEARCH t USING INDEX idx_lower (<expr>=?)
```

### The covering index

If the index contains every column the query needs, the engine can answer from the index
alone and never touch the table:

```sql
EXPLAIN QUERY PLAN SELECT name FROM t WHERE name > 'name1';
```

```
SEARCH t USING COVERING INDEX idx_name (name>?)
```

**COVERING** is the word to look for. It means the second lookup — index to row — didn't
happen at all, and it's why adding one more column to an index sometimes makes a query
several times faster than adding a whole new index would.

### Worth knowing: LIKE 'x%' does not use your index, and the reason is a default

A prefix search looks like it should be an index range scan: everything starting with
`name7` is contiguous in a sorted list. Try it:

```sql
EXPLAIN QUERY PLAN SELECT * FROM t WHERE name LIKE 'name7%';
```

```
SCAN t
```

The reason is that SQLite's `LIKE` is **case-insensitive for ASCII by default**, while
your index is sorted case-sensitively (BINARY collation). Sorted by `A < a < b`, an
index cannot produce the range "everything matching `name7` in either case" as one
contiguous run — so the optimiser correctly refuses.

Two ways out, and both restore the range scan:

```sql
PRAGMA case_sensitive_like = ON;
CREATE INDEX idx_ci ON t(name COLLATE NOCASE);
```

Either makes the collation of the question match the collation of the index, and the
plan turns into `SEARCH t USING COVERING INDEX ... (name>? AND name<?)` — note that it
became a *range*, `>` and `<`, which is exactly what a prefix match is once you can
trust the order.

The general lesson outlives SQLite: **an index is only usable by a query whose collation
matches the index's.** In PostgreSQL this is the same trap wearing different clothes —
a `LIKE 'x%'` index scan there requires either the C locale or an explicit
`text_pattern_ops` index, and thousands of people have discovered that on production the
week after it worked locally.

## Quiz

1. You add an index to speed up a slow report. Name two costs you have just taken on.
2. A query filtering on an indexed column shows `SCAN` in its plan. Give two different
   reasons that can happen even though the index exists and the column is right.
3. What does `COVERING` mean in a query plan, and what work does it save?
4. Your table has an index on `email`. Which of these can use it, and why:
   `WHERE email = ?`, `WHERE lower(email) = ?`, `WHERE email LIKE 'a%'`?
5. Why does an index make `ORDER BY name` cheaper even for a query that returns every
   row in the table?

## Task

Prove each of these to yourself rather than taking the lesson's word for it. Use a table
with a few hundred rows — small is fine, the plan doesn't depend on size here.

1. Run `EXPLAIN QUERY PLAN` for an equality filter with no index. Record the plan.
2. Add the index, run it again, and record how the plan changed.
3. Wrap the column in `lower()` and watch it fall back to a scan.
4. Add an expression index and watch it recover.
5. Get one query to report `COVERING INDEX`, and work out why that one qualifies when
   your earlier one didn't.
6. Reproduce the `LIKE 'x%'` scan, then fix it with a `COLLATE NOCASE` index and confirm
   the plan turns into a range.

Write every plan you saw into the file as a comment beside the query that produced it.
That file is the point of the exercise, not the queries.

- File: `sql/day02.sql`
- Run: `sqlite3 day02.db < sql/day02.sql`

### Checklist

- [ ] the same query planned both with and without an index, both plans recorded
- [ ] a function on the indexed column observed falling back to `SCAN`
- [ ] an expression index built, and the plan recovering
- [ ] one query reporting `COVERING INDEX`, and you can say why
- [ ] `LIKE 'x%'` scanning, then using a range after the collation is fixed
