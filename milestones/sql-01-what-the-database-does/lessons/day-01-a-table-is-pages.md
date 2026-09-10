# A table is a file of pages

## Theory

You already write queries that work. This track is about the layer underneath them: what
the engine does with the bytes once your `SELECT` arrives. Start with the most physical
question there is — where does a row actually live?

Everything below is run against **PostgreSQL 16**, because it is the engine most likely
to be under whatever you build next, and because it is unusually willing to show you its
own internals. Stack Overflow's developer survey has had it as the most-used database
since 2023, and by 2025 it had pulled to 55.6% of all respondents — 58.2% of professional
developers, roughly eighteen points clear of MySQL in second. But popularity is not why
it earns this track. It earns it because you can ask Postgres to hand you a raw 8 kB page
and tell you what is on it, and almost nothing else will.

### A row is not the unit of anything

The mental model most people carry is that a table is a list of rows, and reading a row
reads a row. Neither half is true.

A table on disk is a flat array of fixed-size **pages** — Postgres calls the file a
*heap*. Every page is the same size, and the page is the unit the engine reads, writes,
caches and locks. Rows are packed into pages; a page holds as many as fit. When you ask
for one row, the engine reads the whole page that row sits in, because that is the
smallest thing it can read.

```sql
SHOW block_size;
```

```
 block_size
------------
 8192
```

8192 bytes, and it is a compile-time constant: changing it means rebuilding Postgres and
recreating every cluster, which is why essentially nobody does. SQLite defaults to 4096,
matching the virtual-memory page and most filesystem blocks. The number is a compromise
nobody has wanted to relitigate since the 1990s — bigger pages waste less space on
per-page bookkeeping and read more useful bytes per seek, smaller pages waste less I/O
when you only wanted one row.

Watch the file grow in page-sized steps rather than row-sized ones:

```sql order
CREATE TABLE t(id bigserial PRIMARY KEY, name text, note text);
SELECT pg_relation_size('t') / 8192 AS pages;
INSERT INTO t(name, note) SELECT 'name' || g, repeat('x', 40) FROM generate_series(1, 2000) g;
SELECT pg_relation_size('t') / 8192 AS pages, pg_size_pretty(pg_relation_size('t')) AS heap;
```

```
 pages
-------
     0

 pages |  heap
-------+--------
    23 | 184 kB
```

A freshly created Postgres table is **zero pages** — an empty file. (SQLite's answer is
different and worth knowing: creating a table there costs pages before any row exists,
because the schema and the table's own tree root have to live somewhere.) Then 2000 rows
land in 23 pages, and the file grew one page at a time at moments that had nothing to do
with your row count. Ninety-seven of those rows fit on the first page — a number you will
be able to derive rather than guess by the end of this lesson.

### Where a row is, exactly

Every Postgres row carries hidden system columns you never declared. The one that
answers "where does this row live" is `ctid`:

```sql
SELECT ctid, id, name FROM t WHERE id IN (1, 2, 82) ORDER BY id;
```

```
  ctid  | id |  name
--------+----+--------
 (0,1)  |  1 | name1
 (0,2)  |  2 | name2
 (0,82) | 82 | name82
```

`(page, slot)`. Row 1 is the first slot of page zero; row 82 is the 82nd slot of the same
page. This is a **physical address**, not an identity — and the difference is the whole
lesson of the next section.

### An UPDATE does not update

Here is the fact that surprises people who have used Postgres for years:

```sql
UPDATE t SET note = 'changed' WHERE id = 1;
SELECT ctid FROM t WHERE id = 1;
```

```
  ctid
---------
 (22,56)
```

The row moved from page 0 to page 22. Postgres did not modify the row in place. It wrote
a **new version** of the row wherever there was space, and marked the old one as dead.
Both copies are in the file right now.

That is MVCC — multi-version concurrency control — and it is the mechanism behind
Postgres's most-loved property: readers never block writers and writers never block
readers, because a reader is looking at a version that hasn't gone anywhere. The two
other hidden columns are the bookkeeping:

```sql
SELECT ctid, xmin, xmax, id FROM t ORDER BY id LIMIT 3;
```

```
  ctid   | xmin | xmax | id
---------+------+------+----
 (22,56) |  798 |    0 |  1
 (0,2)   |  797 |    0 |  2
 (0,3)   |  797 |    0 |  3
```

`xmin` is the transaction that created this version, `xmax` the transaction that deleted
it (0 if it is still live). Row 1 wears its update on its sleeve: same table, same
`INSERT`, but a *newer* `xmin` than its neighbours, because the version you are looking
at was created by the `UPDATE` and not by the insert. Every query you run is really "show me the versions visible
to my transaction id", which is why a long-running `SELECT` can sit there returning a
consistent snapshot of a table being rewritten underneath it.

The bill arrives as **bloat**:

```sql order
SELECT pg_size_pretty(pg_relation_size('t')) AS before_updates;
UPDATE t SET note = note || 'a';
SELECT count(*) AS live_rows, pg_size_pretty(pg_relation_size('t')) AS file FROM t;
```

Run that middle statement three times, changing the appended character each time, so
every row gets three new versions:

```
 live_rows |  file
-----------+--------
      2000 | 720 kB
```

Same 2000 rows, and the file went from 184 kB to 720 kB. Three updates of every row left
three dead versions of every row lying in the heap. Now clean up:

```sql order
VACUUM t;
SELECT pg_size_pretty(pg_relation_size('t')) AS after_vacuum;
VACUUM FULL t;
SELECT pg_size_pretty(pg_relation_size('t')) AS after_vacuum_full;
```

```
 after_vacuum
--------------
 720 kB

 after_vacuum_full
-------------------
 184 kB
```

**Plain `VACUUM` gave back nothing.** It marks the dead space reusable *by that table*,
so the file stops growing — but it does not shrink the file, and this is the single most
misunderstood thing about Postgres operations. `VACUUM FULL` genuinely returns the space,
by rewriting the whole table into a new file, and it takes an `ACCESS EXCLUSIVE` lock for
the duration: nothing reads or writes that table until it finishes. On a large production
table that is an outage, which is why teams reach for `pg_repack` instead, and why "our
disk is full and `VACUUM` didn't help" is a support conversation that happens every week
of the year.

> [!NOTE]
> **The most expensive consequence of ctid, in production.** Because an index entry
> points at a physical `(page, slot)`, moving a row means every index on the table has to
> be updated — even indexes on columns your `UPDATE` never touched. Uber's engineering
> blog made this famous in 2016 as their headline reason for migrating off Postgres:
> a table with a dozen indexes turned a one-column update into twelve index writes, and
> that amplification then rode through their replication stream, which ships physical
> page changes rather than statements. MySQL's InnoDB avoids it by making secondary
> indexes point at the primary key instead of a physical location — which costs an extra
> lookup on every index read. There is no free answer here, only a trade someone picked.

### Worth knowing: ask Postgres for the raw bytes of a page

There is a contrib extension that reads pages directly, and it turns every claim above
into something you can check yourself. Rebuild the table first if you have been updating
it — the numbers below are page 0 of a table freshly loaded with those 2000 rows:

```sql
CREATE EXTENSION IF NOT EXISTS pageinspect;
SELECT lower, upper, pagesize FROM page_header(get_raw_page('t', 0));
SELECT count(*) AS tuples, min(lp_len) AS small, max(lp_len) AS big FROM heap_page_items(get_raw_page('t', 0));
```

```
 lower | upper | pagesize
-------+-------+----------
   412 |   432 |     8192

 tuples | smallest | largest
--------+----------+---------
     97 |       79 |      80
```

Do the arithmetic and the page layout falls out of it. A page starts with a 24-byte
header, then grows an array of 4-byte **line pointers** downward from the front while the
row data itself is stacked upward from the back. `lower` is where the pointer array ends,
`upper` where the data begins, and the gap between them is the free space — here
432 − 412 = 20 bytes, so this page is full.

Which gives you an invariant to check rather than a number to believe:
**`lower` = 24 + 4 × tuples**. Here that is 24 + 97 × 4 = 412, exactly. Run those two
queries against any page of any table of your own and it will still hold, whatever the
counts happen to be. That layer of indirection is also why a row can be moved *within* a
page without any index noticing — the line pointer keeps the slot number stable while the
data behind it moves.

Now account for one row's 79 bytes. Eight for the bigint, six for `'name1'`, 41 for the
40-character note — varying-length values each carry a length byte — and the other 24 are
a per-row header that is yours whether you want it or not. Postgres charges 23 bytes of
visibility bookkeeping per row, rounded up for alignment. That is why a table of millions
of narrow rows is far bigger than `rows × columns` suggests, and why "just add a boolean
column" is never as free as it sounds.

> [!NOTE]
> **The clock nobody watches until it stops them.** Transaction ids are 32-bit, so they
> wrap. Postgres protects itself by refusing all writes once a table's oldest unfrozen
> transaction gets too far behind — `SELECT name, setting FROM pg_settings WHERE name =
> 'autovacuum_freeze_max_age'` shows the threshold, 200 million by default, against a
> 2^31 ceiling. Vacuum's *other* job, besides reclaiming space, is freezing old rows so
> this never happens. When it falls behind on a write-heavy table the ending is always
> the same: Sentry's engineering blog describes losing most of a US working day to
> exactly this, and the only recovery is to stop accepting writes and vacuum.

## Quiz

1. A table has 200 rows packed into 6 pages. A query returns exactly one row, found by
   scanning. What is the smallest amount of data the engine could have read from disk?
2. You run `UPDATE t SET note = 'x' WHERE id = 1` in PostgreSQL. Describe what happens to
   the row's physical location and to the previous version of the row.
3. Your table's file is 4 GB, of which only 500 MB is live rows. You run `VACUUM`. What
   happens to the size of the file on disk, and why?
4. In PostgreSQL an index entry points at a physical `(page, slot)` address. Given that,
   explain why updating one unindexed column of a row can still cause writes to five
   different indexes.
5. What are `xmin` and `xmax`, and how do they let one transaction read a table while
   another rewrites it?

## Task

Get a PostgreSQL server in front of you and make it show you its own pages. Do not take
any of the numbers above on trust — the point of this exercise is that you produced them.

If you have no Postgres to hand, `docker run --rm -e POSTGRES_PASSWORD=x -p 5432:5432
postgres:16` and `psql -h localhost -U postgres` is a 30-second setup.

1. Confirm `block_size`, then create a table and check `pg_relation_size` before and
   after inserting a couple of thousand rows. Record where the page count jumps.
2. Select `ctid` alongside your own columns and work out how many rows are landing per
   page.
3. Update one row. Select its `ctid` again. Explain the number you get.
4. Update *every* row three times, then compare `pg_relation_size` and `count(*)`.
5. Run `VACUUM`, measure again, then `VACUUM FULL`, and measure again. Only one of them
   changes the file size — record both numbers.

Write every number you saw into the file as a comment beside the query that produced it.
That file is the point of the exercise, not the queries.

- File: `sql/day01.sql`
- Run: `psql -h localhost -U postgres -f sql/day01.sql`

### Checklist

- [ ] `block_size` confirmed and the table's page count measured before and after inserts
- [ ] `ctid` selected, and rows-per-page worked out from it
- [ ] a single row observed changing its `ctid` after an `UPDATE`
- [ ] the file measured growing while `count(*)` stayed the same
- [ ] `VACUUM` and `VACUUM FULL` both measured, and you can say why only one shrank it
