# Milestone SQL-02 — Queries That Look Right

**Track:** SQL (PostgreSQL 16) · **Days:** 7 · **Time:** ~3 hours total, in 25–30 minute sittings

The first SQL week was about what the engine does underneath: pages, indexes, NULL. This
one is about the layer you type every day, and about the specific way it fails. SQL almost
never fails loudly. A wrong join, a misplaced filter or an integer division does not throw;
it returns a result that is plausible, well-formatted and wrong, and then that result goes
into a dashboard, an invoice or a decision.

So this is a week of fundamentals, but not a week of syntax. Each day takes one thing that
everybody believes they already know — the order a query runs in, what `LEFT JOIN`
promises, what `ORDER BY` guarantees — and finds the exact place where the belief and the
engine part company. Each one ends in a small set of habits that make the mistake hard to
make again.

**Prerequisites:** SQL-01, or comfort with `SELECT`, `WHERE` and `JOIN`. The same setup:
`docker run --rm -e POSTGRES_PASSWORD=x -p 5432:5432 postgres:16` and a `psql` prompt.
Every day starts in its own schema, so the days never trip over each other's tables.

---

### Day 4 — SQL does not run in the order you write it
**Concept:** the logical evaluation order — `FROM`, `WHERE`, `GROUP BY`, `HAVING`, `SELECT`,
`DISTINCT`, `ORDER BY`, `LIMIT` — and how every "column does not exist" and "not allowed
in WHERE" error is that order showing through. `WHERE` filters rows; `HAVING` filters
groups. The `GROUP BY` rule and the one exception Postgres makes to it.
**Task:** trigger each ordering error on purpose, fix each one, and read an `EXPLAIN` from
the bottom up to watch the clauses run in their real order.
**Worth knowing:** in `GROUP BY` a bare name means the *input* column, while in `ORDER BY`
it means the *output* alias — so `SELECT lower(name) AS name … GROUP BY name ORDER BY name`
can print the same name twice. Also: Google published a paper in 2024 arguing SQL's
clause order is a design mistake, and shipped a fix.
**Watch for:** an aggregate over zero rows returns one row containing NULL, not zero rows.

### Day 5 — The LEFT JOIN that became an INNER JOIN
**Concept:** what a join produces before anything filters it; the NULL-extended row that a
`LEFT JOIN` adds for an unmatched left row; why a `WHERE` condition on the right-hand
table throws exactly those rows away; `ON` versus `WHERE`; `count(*)` versus `count(col)`
after an outer join; the anti-join.
**Task:** lose customers from a report with one misplaced condition, prove it in `EXPLAIN`,
and fix it — then try the fix most people reach for and watch it fail too.
**Worth knowing:** `EXPLAIN` tells on you — the plan for the broken query says `Nested
Loop`, not `Left Join`, because the planner saw that the outer join had become an inner one
and planned it as such. Since 9.0, Postgres also deletes a `LEFT JOIN` from the plan
entirely when it provably cannot change the result.
**Watch for:** `NATURAL JOIN`, which joins on every column whose name matches — including
columns somebody adds next year.

### Day 6 — Joins multiply
**Concept:** a join to a one-to-many table repeats the left row once per match; join two
such tables and the repeats multiply. Grain: what one row of a result *means*. Aggregate
first, join second.
**Task:** build a report that turns 180.00 of revenue into 680.00, show where every
duplicate row came from, try `sum(DISTINCT)` and watch it lose a real payment, then fix it
properly.
**Worth knowing:** this bug is common enough that three ecosystems ship a named defence
against it — Looker's "symmetric aggregates", EF Core's split queries for "cartesian
explosion", Hibernate's `MultipleBagFetchException`. And a one-line detector:
`count(*)` against `count(DISTINCT key)` over the join.
**Watch for:** `count(DISTINCT x)` is a correct fix for counting, which makes people
believe `sum(DISTINCT x)` is a correct fix for summing. It is not.

### Day 7 — Without ORDER BY there is no order
**Concept:** a table is a heap, not a list; rows come back in whatever order the chosen
plan produces them. Ties under `ORDER BY` are unordered too. `LIMIT/OFFSET` pagination,
why it duplicates and skips rows, and why deep offsets are slow. Keyset pagination with a
row comparison.
**Task:** make a leaderboard change its answer by adding an index, make a feed show the
same post twice, then rebuild it with keyset pagination and compare the buffers touched.
**Worth knowing:** `synchronize_seqscans` — two concurrent scans of a big table share I/O
by starting the second one in the middle, so the same `SELECT` without `ORDER BY` can
return a different first row depending on what else is running. And `FETCH FIRST n ROWS
WITH TIES`.
**Watch for:** keyset pagination written as `created_at < $1 AND id < $2`, which looks
equivalent to the row comparison and silently skips rows.

### Day 8 — Window functions: aggregates that keep the rows
**Concept:** `OVER (PARTITION BY … ORDER BY …)`; `row_number`, `rank`, `dense_rank`; top-N
per group; `lag`. Window functions run after `WHERE`, so they cannot be filtered in it.
The default frame.
**Task:** per-region shares and ranks, a running total that is wrong on ties and then right,
and top-1-per-region three ways.
**Worth knowing:** with `ORDER BY` in the window, the default frame ends at the current
row's last *peer*, which is why `last_value()` returns the current row rather than the
last one. Also `DISTINCT ON`, a Postgres-only shortcut for top-1-per-group.
**Watch for:** `row_number()` on tied values picks a winner arbitrarily, and can pick a
different one tomorrow.

### Day 9 — Numbers that round, truncate and overflow
**Concept:** integer division, `numeric` versus `float8` versus `real`, rounding rules that
differ by type, `numeric(p,s)` rounding silently on insert, overflow.
**Task:** reproduce the 0% conversion rate, accumulate a float error you can see, and pick
the right type for money with a reason.
**Worth knowing:** `round(2.5)` is 3 but `round(2.5::float8)` is 2 — the two types use
different tie-breaking rules. The Vancouver Stock Exchange index lost nearly half its
value to truncation, and a Patriot battery's clock drifted a third of a second, both from
errors far smaller than these.
**Watch for:** a literal like `0.1` is `numeric` in Postgres, so a quick test can come out
exact and hide the float behaviour your column actually has.

### Day 10 — Time is not a number
**Concept:** what `timestamptz` stores (an instant, in UTC, with no zone) and what the
session `TimeZone` changes; `timestamp` without a zone; `AT TIME ZONE`; DST gaps; month
arithmetic; half-open ranges instead of `BETWEEN`.
**Task:** watch one stored instant display three ways, lose most of a day with `BETWEEN`,
and get a daily report to change its totals by changing nothing but the connection's time
zone.
**Worth knowing:** in a zone written POSIX-style, the sign is inverted —
`'12:00 UTC+5'` is five hours *behind* UTC. And Azure's 2012 leap-day outage: a certificate
expiry computed by adding 1 to the year produced February 29, 2013.
**Watch for:** `date_trunc('day', …)` on a `timestamptz` cuts at midnight in the
*session's* zone, so the same report run from two servers gives two answers.

---

## After this milestone

Natural next topics are transactions and isolation (what two sessions see of each other,
and the anomalies each isolation level allows), and constraints as the database's own
tests. As with every track here, the next milestone is specified once this one is done,
so it can be calibrated against what actually turned out to be hard.
