# Window functions: aggregates that keep the rows

## Theory

`GROUP BY` answers "what is the total per region" and, in the process, destroys the rows it
summarised. A whole family of everyday questions needs the total *and* the rows: what
share of its region is each sale, what is the running total, which sale is each region's
largest, how did today compare with yesterday. For years the answer was a self-join or a
correlated subquery per question. Window functions arrived in the SQL:2003 standard and in
PostgreSQL 8.4 in 2009. MySQL only got them with 8.0 in 2018, which is why so much code
in the wild still does it the old, slow way.

```sql
DROP SCHEMA IF EXISTS day08 CASCADE;
CREATE SCHEMA day08;
SET search_path = day08;

CREATE TABLE sales (id int PRIMARY KEY, region text NOT NULL, day date NOT NULL, amount int NOT NULL);
INSERT INTO sales VALUES
  (1, 'north', '2026-03-01', 100),
  (2, 'north', '2026-03-02',  50),
  (3, 'north', '2026-03-02',  70),
  (4, 'north', '2026-03-03',  30),
  (5, 'south', '2026-03-01', 200),
  (6, 'south', '2026-03-02', 200),
  (7, 'south', '2026-03-03',  10);
```

### GROUP BY collapses, OVER keeps

```sql
SELECT region, sum(amount) FROM sales GROUP BY region ORDER BY region;
```

```text
 region | sum
--------+-----
 north  | 250
 south  | 410
```

Seven rows went in, two came out. Now the same `sum`, with `OVER` instead of `GROUP BY`:

```sql
SELECT id, region, amount,
       sum(amount) OVER (PARTITION BY region) AS region_total,
       round(100.0 * amount / sum(amount) OVER (PARTITION BY region), 1) AS pct
FROM sales
ORDER BY id;
```

```text
 id | region | amount | region_total | pct
----+--------+--------+--------------+------
  1 | north  |    100 |          250 | 40.0
  2 | north  |     50 |          250 | 20.0
  3 | north  |     70 |          250 | 28.0
  4 | north  |     30 |          250 | 12.0
  5 | south  |    200 |          410 | 48.8
  6 | south  |    200 |          410 | 48.8
  7 | south  |     10 |          410 |  2.4
```

Seven in, seven out. For each row, the window function looks at a **window** of related
rows, here every row in the same region, computes the aggregate over that window, and
writes the result next to the row. Nothing collapses. That is the whole idea; everything
else is about choosing the window:

```text
function(...) OVER (
  PARTITION BY ...   -- which rows are related (like GROUP BY, but keeps them)
  ORDER BY ...       -- the order inside each partition
  ROWS/RANGE ...     -- the frame: which of those rows this row actually sees
)
```

(`100.0 *` and not `100 *` is deliberate: `amount` is an integer, and integer division
would turn every share into 0. That is day 9's whole subject.)

### Ranking: three functions that disagree only on ties

```sql
SELECT region, id, amount,
       row_number() OVER w AS row_number,
       rank()       OVER w AS rank,
       dense_rank() OVER w AS dense_rank
FROM sales
WINDOW w AS (PARTITION BY region ORDER BY amount DESC)
ORDER BY region, amount DESC, id;
```

```text
 region | id | amount | row_number | rank | dense_rank
--------+----+--------+------------+------+------------
 north  |  1 |    100 |          1 |    1 |          1
 north  |  3 |     70 |          2 |    2 |          2
 north  |  2 |     50 |          3 |    3 |          3
 north  |  4 |     30 |          4 |    4 |          4
 south  |  5 |    200 |          1 |    1 |          1
 south  |  6 |    200 |          2 |    1 |          1
 south  |  7 |     10 |          3 |    3 |          2
```

North has no ties, so all three agree. South has two 200s:

- `row_number` numbers rows 1, 2, 3 regardless. **Which** 200 gets 1 is not defined, for
  exactly the reason from day 7: the window's `ORDER BY amount` says nothing about ties.
- `rank` gives both 200s rank 1 and then skips to 3, like a race with a shared first place.
- `dense_rank` gives both 1 and continues with 2, with no gaps.

`WINDOW w AS (…)` names a window once so several functions can share it.

### Top-N per group, and why WHERE cannot do it

"Each region's largest sale" is the classic. The natural attempt:

```sql
SELECT region, id, rank() OVER (PARTITION BY region ORDER BY amount DESC) AS r
FROM sales
WHERE rank() OVER (PARTITION BY region ORDER BY amount DESC) = 1;
```

```text
ERROR:  window functions are not allowed in WHERE
LINE 3: WHERE rank() OVER (PARTITION BY region ORDER BY amount DESC)...
              ^
```

Back to day 4's pipeline. Window functions are computed in the `SELECT` step, after
`WHERE`, `GROUP BY` and `HAVING`. `WHERE` cannot filter on something that has not been
computed yet. Snowflake, BigQuery and DuckDB added a non-standard `QUALIFY` clause for
exactly this. Postgres has not, and it has a fun way of showing it:

```sql
SELECT region, id, amount FROM sales
QUALIFY rank() OVER (PARTITION BY region ORDER BY amount DESC) = 1;
```

```text
ERROR:  syntax error at or near "rank"
LINE 2: QUALIFY rank() OVER (PARTITION BY region ORDER BY amount DES...
                ^
```

The error points at `rank`, not at `QUALIFY`, because Postgres read `QUALIFY` as a table
alias: `FROM sales QUALIFY` is `FROM sales AS qualify`. (Adding `QUALIFY` has been
proposed on the pgsql-hackers mailing list. Until something like that lands, you write a
subquery.) Compute the rank in an inner query, filter it in an outer one:

```sql
SELECT region, id, amount
FROM (
  SELECT region, id, amount,
         rank() OVER (PARTITION BY region ORDER BY amount DESC) AS r
  FROM sales
) ranked
WHERE r = 1
ORDER BY region, id;
```

```text
 region | id | amount
--------+----+--------
 north  |  1 |    100
 south  |  5 |    200
 south  |  6 |    200
```

South returns two rows, because `rank` gave both 200s first place. That is a decision you
are making by choosing the function. Use `rank` when a tie for first is genuinely two
winners. Use `row_number` with a tiebreaker (`ORDER BY amount DESC, id`) when you need
exactly one.

### The running total that jumps two rows at once

Add `ORDER BY` inside the window and `sum` becomes a running total:

```sql
SELECT id, day, amount, sum(amount) OVER (ORDER BY day) AS running
FROM sales
WHERE region = 'north'
ORDER BY id;
```

```text
 id |    day     | amount | running
----+------------+--------+---------
  1 | 2026-03-01 |    100 |     100
  2 | 2026-03-02 |     50 |     220
  3 | 2026-03-02 |     70 |     220
  4 | 2026-03-03 |     30 |     250
```

Row 2 should show 150 and shows 220. Rows 2 and 3 share a day, and both got the total
*including each other*. Nothing is broken. This is the **default frame**, and you never
wrote it. When a window has an `ORDER BY` and no frame clause, the standard says the frame
is:

```text
RANGE BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW
```

`RANGE` means "up to the current row **and all of its peers**", where peers are rows
that are equal on the `ORDER BY` key. Both 03-02 rows are peers, so each sees the other.
For a running total you want `ROWS`, which counts physical rows, plus a tiebreaker so the
order among peers is defined:

```sql
SELECT id, day, amount,
       sum(amount) OVER (ORDER BY day, id ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW) AS running
FROM sales
WHERE region = 'north'
ORDER BY id;
```

```text
 id |    day     | amount | running
----+------------+--------+---------
  1 | 2026-03-01 |    100 |     100
  2 | 2026-03-02 |     50 |     150
  3 | 2026-03-02 |     70 |     220
  4 | 2026-03-03 |     30 |     250
```

The default is not unreasonable: if two sales really happened at the same moment, there
is no "first" between them, and `RANGE` refuses to invent one. It is just almost never
what someone writing a running total meant, and it fails only on data with ties. Test
data rarely has ties.

### lag and lead: comparing a row with its neighbour

"How did each day compare with the day before?" used to need a self-join on `day - 1`.
`lag` reads a value from the previous row of the window:

```sql
SELECT day, total, total - lag(total) OVER (ORDER BY day) AS change
FROM (SELECT day, sum(amount) AS total FROM sales GROUP BY day) d
ORDER BY day;
```

```text
    day     | total | change
------------+-------+--------
 2026-03-01 |   300 |
 2026-03-02 |   320 |     20
 2026-03-03 |    40 |   -280
```

The first day has no previous row, so `lag` returns NULL and so does the subtraction. The
inner query is a `GROUP BY` and the outer one is a window: aggregate to the grain you want
(day 6), *then* compare across rows.

### Windows see only what WHERE left behind

One more consequence of running in the `SELECT` step:

```sql
SELECT id, amount, sum(amount) OVER () AS total
FROM sales
WHERE region = 'north'
ORDER BY id;
```

```text
 id | amount | total
----+--------+-------
  1 |    100 |   250
  2 |     50 |   250
  3 |     70 |   250
  4 |     30 |   250
```

`OVER ()` is a window of "all rows", but only the rows that survived `WHERE`. So the total
is north's 250, not the table's 660. If you need "share of the whole table" while showing
only some rows, compute the window in a subquery first and filter outside it.

### Worth knowing: last_value() returns the current row

Given the default frame, predict `last_value`:

```sql
SELECT id, day, amount,
       first_value(amount) OVER (ORDER BY day, id) AS first,
       last_value(amount)  OVER (ORDER BY day, id) AS last_default,
       last_value(amount)  OVER (ORDER BY day, id
                                 ROWS BETWEEN UNBOUNDED PRECEDING AND UNBOUNDED FOLLOWING) AS last_whole
FROM sales
WHERE region = 'north'
ORDER BY id;
```

```text
 id |    day     | amount | first | last_default | last_whole
----+------------+--------+-------+--------------+------------
  1 | 2026-03-01 |    100 |   100 |          100 |         30
  2 | 2026-03-02 |     50 |   100 |           50 |         30
  3 | 2026-03-02 |     70 |   100 |           70 |         30
  4 | 2026-03-03 |     30 |   100 |           30 |         30
```

`first_value` works as expected, because the frame always starts at the beginning.
`last_value` returns the current row's own amount every time, because the default frame
*ends* at the current row. The last row of the frame is always the one you are standing
on. It is the same default as the running total, showing up in a function where it is
never what anyone wants. Spell out `UNBOUNDED FOLLOWING`, or flip the order and use
`first_value`.

And a Postgres-only shortcut for top-1-per-group that skips the subquery altogether:

```sql
SELECT DISTINCT ON (region) region, id, amount
FROM sales
ORDER BY region, amount DESC, id;
```

```text
 region | id | amount
--------+----+--------
 north  |  1 |    100
 south  |  5 |    200
```

`DISTINCT ON (region)` keeps the first row of each region *according to the `ORDER BY`*,
which must begin with the same columns. It is not standard SQL, it is very readable, and
the `id` at the end of the `ORDER BY` is what decides the tie between the two 200s.

### Carry this

- `GROUP BY` collapses rows; `OVER` computes over a window of related rows and keeps
  every one.
- Window functions run in the `SELECT` step, so they cannot appear in `WHERE`. Filter on
  them from an outer query.
- `row_number` breaks ties arbitrarily unless you add a tiebreaker; `rank` shares a place
  and leaves a gap; `dense_rank` shares without gaps.
- An `ORDER BY` in a window brings a default frame of `RANGE … CURRENT ROW`, which
  includes peers. For running totals write `ROWS` and a unique final sort key.
- `last_value` needs `ROWS BETWEEN UNBOUNDED PRECEDING AND UNBOUNDED FOLLOWING`.

## Quiz

1. What is the difference between what `GROUP BY` and a window function do to the rows of
   a query?
2. Why is `WHERE rank() OVER (…) = 1` rejected, and what is the standard way to filter on
   a window function in PostgreSQL?
3. Two sales share the same day. Why does `sum(amount) OVER (ORDER BY day)` give both of
   them the same running total, and how do you get a true row-by-row running total?
4. Two rows tie for first place in a partition. What do `row_number`, `rank` and
   `dense_rank` assign to them, and to the row after them?
5. Why does `last_value(x) OVER (ORDER BY t)` return the current row's own value?

## Drill

1. Predict a running total with the default frame on data containing a tie.
2. A "top sale per region" query uses `row_number`. Find what is wrong with it.
3. Choose the query that shows each sale's share of the whole table while listing only
   one region's sales.

## Task

Rebuild three classic reports with windows, and catch the default frame in the act.

1. Start the file with the day's setup block from the lesson.
2. For every sale, show its region's total and its percentage of that total, without
   `GROUP BY` in the outer query.
3. Show `row_number`, `rank` and `dense_rank` side by side and explain, in a comment, each
   difference on the tied rows.
4. Get each region's top sale three ways: a subquery over `rank`, a subquery over
   `row_number` with a tiebreaker, and `DISTINCT ON`. Record how the three differ for
   `south`.
5. Write a running total for `north` with the default frame and record the wrong row.
   Fix it with `ROWS` and a tiebreaker.
6. Show `last_value` returning the current row, then fix it.

Record what each query printed as a comment beside it.

- File: `sql/day08.sql`
- Run: `psql -h localhost -U postgres -f sql/day08.sql`

### Checklist

- [ ] each sale shown with its region total and percentage, computed with a window
- [ ] `row_number`, `rank` and `dense_rank` compared on a tie, with each difference
      explained
- [ ] top sale per region found three ways, with the difference for the tied region
      recorded
- [ ] a default-frame running total shown wrong on tied days, then fixed with `ROWS` and a
      tiebreaker
- [ ] `last_value` shown returning the current row, then returning the true last value
