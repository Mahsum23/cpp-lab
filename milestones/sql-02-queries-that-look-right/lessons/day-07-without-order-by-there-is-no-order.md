# Without ORDER BY there is no order

## Theory

Run a `SELECT` without `ORDER BY` on a small table and the rows come back in the order you
inserted them. Run it a thousand times and they come back the same way a thousand times.
So code starts to rely on it: the "first" row, the "latest" entry, page 2 of a list. This
lesson is about why that order is an accident of how the rows happen to be stored and
read, and the three different ways the accident ends.

```sql
DROP SCHEMA IF EXISTS day07 CASCADE;
CREATE SCHEMA day07;
SET search_path = day07;

CREATE TABLE players (id int PRIMARY KEY, name text NOT NULL, score int NOT NULL);
INSERT INTO players VALUES (1, 'ana', 90), (2, 'bo', 75), (3, 'cy', 90), (4, 'dee', 60), (5, 'eli', 75);
SELECT * FROM players;
```

```text
 id | name | score
----+------+-------
  1 | ana  |    90
  2 | bo   |    75
  3 | cy   |    90
  4 | dee  |    60
  5 | eli  |    75
```

### A table is a heap, not a list

The SQL standard is blunt: without `ORDER BY`, the order of rows is *implementation
dependent*. The relational model is blunter. A relation is a **set**, and sets have no
order at all. What you just saw is simply the order in which a sequential scan meets the
rows in the table's pages, and on day 1 you saw what an `UPDATE` does to a row: it writes
a new version, somewhere else.

```sql
UPDATE players SET score = 91 WHERE id = 1;
SELECT ctid, * FROM players;
```

```text
 ctid  | id | name | score
-------+----+------+-------
 (0,2) |  2 | bo   |    75
 (0,3) |  3 | cy   |    90
 (0,4) |  4 | dee  |    60
 (0,5) |  5 | eli  |    75
 (0,6) |  1 | ana  |    91
```

`ana` was first. One update later, `ana` is last. Nobody touched the query. The new version
of the row went into the next free slot on the page, `(0,6)`, and the scan meets it there.
On a busy table the same thing happens through updates, deletes, `VACUUM` freeing space
mid-table, and bulk loads, all day long. "Insertion order" holds only until the first
write.

```sql
UPDATE players SET score = 90 WHERE id = 1;
```

### ORDER BY with ties is unordered too

This is the version that gets past people who know the first rule. You did write
`ORDER BY`. `ana` and `cy` both have 90:

```sql
SELECT name, score FROM players ORDER BY score DESC LIMIT 2;
```

```text
 name | score
------+-------
 cy   |    90
 ana  |    90
```

`ORDER BY score` promises an order between different scores. Between equal scores it
promises nothing. Watch what an index does to that "nothing". On a tiny table the planner
would not bother with an index, so for the experiment, discourage sequential scans:

```sql
CREATE INDEX ON players (score);
SET enable_seqscan = off;
SELECT name, score FROM players ORDER BY score DESC LIMIT 2;
RESET enable_seqscan;
```

```text
 name | score
------+-------
 ana  |    90
 cy   |    90
```

Same data, same query, and a different winner. The first plan read the heap and sorted it,
and `cy` came out on top. The second walked the index backwards, and the index stores
equal keys in its own order. On a real table you do not set anything: the planner switches
plans by itself when the statistics change, after an `ANALYZE`, a bit of growth, or a
version upgrade. Your leaderboard changes its mind and nobody deployed anything.

The fix is to make the order **total**. Add a column that is unique as the last sort key,
so no two rows can ever tie:

```sql
SELECT name, score FROM players ORDER BY score DESC, id LIMIT 3;
```

```text
 name | score
------+-------
 ana  |    90
 cy   |    90
 bo   |    75
```

And when ties should *share* a place instead of being broken arbitrarily, Postgres 13
added the standard way to say so:

```sql
SELECT name, score FROM players ORDER BY score DESC FETCH FIRST 3 ROWS WITH TIES;
```

```text
 name | score
------+-------
 cy   |    90
 ana  |    90
 bo   |    75
 eli  |    75
```

Asked for three, got four. The third place is a tie between `bo` and `eli`, and
`WITH TIES` refuses to pick one for you.

### Pagination: where order bugs become user-visible

The textbook way to page through a list:

```sql
CREATE TABLE posts (
  id         bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  created_at timestamptz NOT NULL,
  title      text NOT NULL
);
INSERT INTO posts (created_at, title)
SELECT timestamptz '2026-01-01' + n * interval '1 minute', 'post ' || n
FROM generate_series(1, 100000) AS n;
CREATE INDEX posts_feed ON posts (created_at DESC, id DESC);
VACUUM ANALYZE posts;

SELECT id, title FROM posts ORDER BY created_at DESC, id DESC LIMIT 3;
```

```text
   id   |    title
--------+-------------
 100000 | post 100000
  99999 | post 99999
  99998 | post 99998
```

That is page 1. While the reader looks at it, somebody publishes a post. Then the reader
clicks "next":

```sql
INSERT INTO posts (created_at, title) VALUES (timestamptz '2026-12-31', 'breaking news');
SELECT id, title FROM posts ORDER BY created_at DESC, id DESC LIMIT 3 OFFSET 3;
```

```text
  id   |   title
-------+------------
 99998 | post 99998
 99997 | post 99997
 99996 | post 99996
```

`post 99998` again. `OFFSET 3` means "skip three rows", not "skip the three you saw", and
the new post pushed everything down by one. A delete does the opposite and silently skips a
row. Every infinite-scroll feed built on `OFFSET` has this bug, and on a busy feed it fires
constantly.

### And OFFSET is slow, however good the index

The second problem is cost. `OFFSET` takes a number, and the only thing a database can do
with a number is count. To skip 90,000 rows it has to produce 90,000 rows and throw them
away:

```sql
EXPLAIN (ANALYZE, COSTS OFF, TIMING OFF, SUMMARY OFF)
SELECT id, title FROM posts ORDER BY created_at DESC, id DESC LIMIT 10 OFFSET 90000;
```

```text
                               QUERY PLAN
------------------------------------------------------------------------
 Limit (actual rows=10 loops=1)
   ->  Index Scan using posts_feed on posts (actual rows=90010 loops=1)
```

The index scan did its job perfectly, and walked 90,010 entries to hand back 10. Page 9,001
costs nine thousand times what page 1 costs. Users rarely go that deep, but crawlers,
exports and "load all" buttons do.

### Keyset pagination: remember where you were

Instead of remembering *how many* rows you have seen, remember *the last one*. Each page
asks for the rows that come after it in the sort order. With a two-column sort, "after" is
a comparison of the pair, and SQL has exactly that, a **row comparison**:

```sql
SELECT id, title FROM posts
WHERE (created_at, id) < ('2026-01-07 22:42:00+00', 10002)
ORDER BY created_at DESC, id DESC
LIMIT 3;
```

```text
  id   |   title
-------+------------
 10001 | post 10001
 10000 | post 10000
  9999 | post 9999
```

`(a, b) < (x, y)` means `a < x OR (a = x AND b < y)`, which is "earlier, or at the same
moment with a smaller id". Since the index is on exactly `(created_at, id)`, Postgres can
jump straight to that position:

```sql
EXPLAIN (ANALYZE, BUFFERS, COSTS OFF, TIMING OFF, SUMMARY OFF)
SELECT id, title FROM posts
WHERE (created_at, id) < ('2026-01-07 22:42:00+00', 10002)
ORDER BY created_at DESC, id DESC
LIMIT 10;
```

```text
                                                 QUERY PLAN
------------------------------------------------------------------------------------------------------------
 Limit (actual rows=10 loops=1)
   Buffers: shared hit=4
   ->  Index Scan using posts_feed on posts (actual rows=10 loops=1)
         Index Cond: (ROW(created_at, id) < ROW('2026-01-07 22:42:00+00'::timestamp with time zone, 10002))
         Buffers: shared hit=4
```

Ten rows read for ten rows returned. Run the `OFFSET 90000` query with `BUFFERS` added and
compare: whether your numbers say `hit`, `read` or both depends on what is cached, but
their total for the offset version is around a thousand pages, against about four here. A
new post at the top cannot shift this page either, because it is anchored to a row, not to
a count.

Markus Winand, author of *Use The Index, Luke*, has campaigned for years under the banner
"No Offset", and many large public APIs page this way. Stripe's list endpoints take
`starting_after=<object id>` rather than a page number. The honest trade-off is that
keyset pagination cannot jump to "page 37". It moves forwards and backwards from where you
are. For feeds, timelines, exports and APIs that is exactly what you want. For a search
results page with numbered links, people still use `OFFSET` and accept the cost.

### The keyset that looks right and skips rows

The row comparison is not decoration. Here is a small feed where two posts share a
timestamp and one was imported late with a backdated time, so `id` and `created_at`
disagree:

```sql
CREATE TABLE feed (id int PRIMARY KEY, created_at timestamptz NOT NULL, title text);
INSERT INTO feed VALUES
  (1, '2026-05-01 10:00+00', 'first'),
  (2, '2026-05-01 10:05+00', 'second'),
  (3, '2026-05-01 10:05+00', 'third'),
  (4, '2026-05-01 10:10+00', 'fourth'),
  (5, '2026-05-01 10:02+00', 'imported late');
SELECT id, created_at, title FROM feed ORDER BY created_at DESC, id DESC LIMIT 2;
```

```text
 id |       created_at       | title
----+------------------------+--------
  4 | 2026-05-01 10:10:00+00 | fourth
  3 | 2026-05-01 10:05:00+00 | third
```

Page 1 ended at `(10:05, 3)`. The tempting way to write "after that" compares each column
separately:

```sql
SELECT id, title FROM feed
WHERE created_at < '2026-05-01 10:05+00' AND id < 3
ORDER BY created_at DESC, id DESC LIMIT 2;
```

```text
 id | title
----+-------
  1 | first
```

`second` is lost because it shares the timestamp, and `imported late` is lost because its
id is larger. The row comparison gets both:

```sql
SELECT id, title FROM feed
WHERE (created_at, id) < ('2026-05-01 10:05+00', 3)
ORDER BY created_at DESC, id DESC LIMIT 2;
```

```text
 id |     title
----+---------------
  2 | second
  5 | imported late
```

### Worth knowing: the same query can start in the middle of the table

One more way order goes away, and it involves nobody's writes at all. Since 8.3, Postgres
has **synchronized sequential scans**. When one scan is already reading through a big
table, a second one starts wherever the first one currently is, wraps around at the end,
and the two share their disk reads. "Big" means larger than a quarter of `shared_buffers`,
so on a default install anything above 32 MB. You can watch it happen in a single session:

```sql
CREATE TABLE big AS
SELECT g AS id, repeat('x', 200) AS pad FROM generate_series(1, 300000) AS g;
SELECT pg_size_pretty(pg_relation_size('big')) AS size, current_setting('shared_buffers');

SELECT id FROM big LIMIT 3;
```

```text
 size  | current_setting
-------+-----------------
 69 MB | 128MB
```

```text
 id
----
  1
  2
  3
```

Now leave a scan partway through, with a cursor that skips 100,000 rows and stops:

```sql order
BEGIN;
DECLARE c CURSOR FOR SELECT id FROM big;
MOVE 100000 IN c;
COMMIT;
```

Then ask for "the first three rows" again:

```sql
SELECT id FROM big LIMIT 3;
```

```text
  id
-------
 99553
 99554
 99555
```

The same `SELECT id FROM big LIMIT 3`, a second later, starts near row 100,000. Scans
report their position every 16 pages, so your number will be a little below 100,000 rather
than exactly this one. Turn the feature off and it goes back to the beginning:

```sql
SET synchronize_seqscans = off;
SELECT id FROM big LIMIT 3;
RESET synchronize_seqscans;
DROP TABLE big;
```

```text
 id
----
  1
  2
  3
```

The manual warns that this "can result in unpredictable changes in the row ordering
returned by queries that have no ORDER BY clause", and Franck Pachot has written up the
`LIMIT`-without-`ORDER BY` version of exactly this experiment. It is the cleanest proof
there is that the order you saw was never a property of the table.

### Carry this

- No `ORDER BY`, no order. Not "insertion order", not "probably the same".
- `ORDER BY` is only as deterministic as its last key. End it with something unique, such
  as the primary key.
- Use `FETCH FIRST n ROWS WITH TIES` when ties should share a place.
- `OFFSET` duplicates and skips under concurrent writes, and costs as many rows as it
  skips.
- Keyset pagination: `WHERE (sort_col, id) < (last_sort_col, last_id)`, an index on
  exactly those columns, and never two separate `<` comparisons.

## Quiz

1. A query without `ORDER BY` has returned rows in insertion order for months. Name two
   things that can change that order without the query changing.
2. `ORDER BY score DESC LIMIT 1` on a table where two players share the top score: which
   one is returned, and how do you make the answer stable?
3. A feed uses `LIMIT 20 OFFSET 20` for page 2, and a post is published while the reader
   is on page 1. What does the reader see on page 2, and why?
4. Why does `LIMIT 10 OFFSET 90000` stay slow even with an index that matches the
   `ORDER BY` exactly?
5. Why must keyset pagination write `(created_at, id) < (x, y)` rather than
   `created_at < x AND id < y`?

## Drill

1. Predict what `FETCH FIRST 2 ROWS WITH TIES` returns on a table with a three-way tie.
2. A feed's "next page" query compares only the timestamp. Find the row it skips.
3. Choose which of three queries is guaranteed to return the same row every time.

## Task

Make order fail three ways, then build pagination that cannot.

1. Start the file with the day's setup block from the lesson.
2. Show a row moving to the end of an unordered `SELECT` after an `UPDATE`, with `ctid`
   before and after.
3. Show `ORDER BY score DESC LIMIT 2` returning different tied winners under two plans,
   then make it stable with a tiebreaker.
4. Reproduce the duplicated row on page 2 with `OFFSET`, by inserting between the two
   page queries.
5. Record `EXPLAIN (ANALYZE, BUFFERS)` for a deep `OFFSET` page and for the equivalent
   keyset page, and write down the rows and buffers each one touched.
6. On a table where `id` and `created_at` disagree, show the two-comparison keyset
   skipping rows and the row-comparison keyset returning them.

Record what each query printed as a comment beside it.

- File: `sql/day07.sql`
- Run: `psql -h localhost -U postgres -f sql/day07.sql`

### Checklist

- [ ] a row observed moving in an unordered `SELECT` after an `UPDATE`, with its `ctid`
- [ ] the same `ORDER BY … LIMIT` returning different tied rows under two plans, and a
      tiebreaker making it deterministic
- [ ] a row shown twice across two `OFFSET` pages after an insert in between
- [ ] rows and buffers recorded for a deep `OFFSET` page and for the keyset page
- [ ] two-comparison keyset shown skipping rows, and the row comparison returning them
