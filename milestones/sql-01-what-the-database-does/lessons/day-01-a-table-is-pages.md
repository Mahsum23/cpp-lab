# A table is a file of pages

## Theory

You already write queries that work. This track is about the layer underneath them: what
the engine does with the bytes once your `SELECT` arrives. Start with the most physical
question there is — where does a row actually live?

### A row is not the unit of anything

The mental model most people carry is that a table is a list of rows, and reading a row
reads a row. Neither half is true.

A database file is a flat array of fixed-size **pages**. Every page is the same size,
and the page is the unit the engine reads, writes, caches and locks. Rows are packed
into pages; a page holds as many as fit. When you ask for one row, the engine reads the
whole page that row sits in — because that is the smallest thing it can read.

In SQLite the page size is baked into the file at creation:

```sql
PRAGMA page_size;
PRAGMA page_count;
SELECT page_size * page_count AS bytes FROM pragma_page_size(), pragma_page_count();
```

4096 bytes by default, which is not a coincidence: it matches the page size of the
virtual-memory system and of most filesystems, so one database page is one filesystem
page is one memory page. PostgreSQL uses 8192 for the same family of reasons. The
number is a compromise nobody has wanted to relitigate since the 1990s: bigger pages
waste less space on per-page bookkeeping and read more useful bytes per seek, smaller
pages waste less I/O when you only wanted one row.

You can watch the file grow in page-sized steps rather than row-sized ones:

```sql
CREATE TABLE t(id INTEGER PRIMARY KEY, name TEXT, note TEXT);
PRAGMA page_count;
INSERT INTO t(name, note) VALUES ('a', 'x');
PRAGMA page_count;
```

Creating the table alone takes an empty file to two pages — one for the schema, one for
the table's own root — before a single row exists. Then the first row costs nothing
extra, and neither do the next hundred: the count sits still until a page fills, and the
file gains exactly one more. Growth is in page-sized steps, and the steps have nothing
to do with how many rows you inserted.

### What the row itself is

Inside the page, a row is a length-prefixed run of bytes: a header saying what type each
column is and how long it is, then the values end to end. There is no fixed column
offset to jump to — to read the fourth column the engine walks the first three.

That is why `SELECT *` is not free even when you were going to read most of it, and why
narrow tables are faster than wide ones in ways that surprise people: the cost is not
"per column you asked for", it is "per byte the engine had to walk past".

> [!NOTE]
> This is a **row store**, and it is one of two answers. Column stores — ClickHouse,
> DuckDB, Parquet — put all of one column's values together instead, so a query touching
> three columns of a hundred reads three columns' worth of bytes. That is the whole
> reason analytics engines exist as separate products: same SQL, opposite physical
> layout. Row stores win when you want whole rows; column stores win when you want whole
> columns.

### The hidden column you already have

Every ordinary SQLite table has a `rowid`: a 64-bit integer key that the table is
physically sorted by, whether you asked for one or not.

```sql
SELECT rowid, * FROM t LIMIT 3;
```

That works on a table where no such column was declared. The table is not a heap of rows
in insertion order — it is a B-tree keyed on `rowid`, and "the table" *is* that tree.

Declaring `id INTEGER PRIMARY KEY` does something special here: it doesn't create a
second key, it makes your column *be* the `rowid`. Exactly that spelling, too —
`INTEGER PRIMARY KEY` aliases the rowid, while `INT PRIMARY KEY` or
`BIGINT PRIMARY KEY` do not, and quietly get you a separate index instead. It's the
sharpest edge in SQLite's type system and it is invisible until you measure.

PostgreSQL made the opposite choice: its tables really are unordered heaps, and its
equivalent of a rowid — `ctid` — is a physical address of the form `(page, slot)` that
changes when the row is updated. Two engines, two answers, and knowing which one you're
on changes what "the table's order" even means.

> [!NOTE]
> There is no such thing as the natural order of a table. A `SELECT` with no `ORDER BY`
> may come back in insertion order today and in a different order tomorrow because
> someone added an index, and both are correct. Every "the rows came out shuffled" bug
> is this.

### Worth knowing: the file will tell you about itself

SQLite ships a virtual table called `dbstat` that reports where every page went:

```sql
SELECT name, count(*) AS pages, sum(payload) AS bytes
FROM dbstat
GROUP BY name
ORDER BY pages DESC;
```

One row per table and index, with the page count each is actually costing you. It's the
quickest way to find out that an index you forgot about is twice the size of the table
it indexes.

## Quiz

1. A table has 200 rows packed into 6 pages. You run a query that returns exactly one
   row, found by scanning. What is the smallest amount of data the engine could have
   read from disk?
2. Why is reading the tenth column of a row more expensive than reading the first, in a
   row-store engine?
3. You declare `id INT PRIMARY KEY` in SQLite instead of `id INTEGER PRIMARY KEY`. What
   actually changes?
4. A colleague says "the rows come back in the order I inserted them, I checked". What
   is wrong with relying on that?
5. What is the difference in physical layout between a row store and a column store, and
   which one would you want for `SELECT avg(price) FROM sales` over 50 million rows?

## Task

Get a database in front of you and look at its pages.

1. Install `sqlite3` if you don't have it — one binary, no server, no configuration. It's
   almost certainly already on your machine.
2. Create a database with one table, insert a few hundred rows, and watch
   `PRAGMA page_count` change as you go. Note where it jumps and where it doesn't.
3. Work out the file's size from `page_size * page_count`, then check it against what
   the filesystem says with `ls -l`. They should agree.
4. Select `rowid` from your table even though you never declared it.
5. Then query `dbstat` and find out how many pages your table is actually costing.

- File: `sql/day01.sql`
- Run: `sqlite3 day01.db < sql/day01.sql`

### Checklist

- [ ] `PRAGMA page_size` and `PRAGMA page_count` both queried
- [ ] observed `page_count` jumping in steps rather than growing per row
- [ ] `page_size * page_count` checked against the real file size on disk
- [ ] selected `rowid` from a table that never declared it
- [ ] `dbstat` queried for the per-table page count
