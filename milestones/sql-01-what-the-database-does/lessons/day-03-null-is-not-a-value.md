# NULL is not a value

## Theory

Two lessons about where bytes live. This one is about a single value that isn't one, and
the class of bug it produces: queries that are syntactically perfect, throw no error, log
nothing, and return the wrong answer for years.

### It is not zero, and it is not empty

`NULL` means *unknown*. Not absent, not blank, not a default — unknown. Once you take
that literally, everything else follows, including the parts that look broken.

If a value is unknown, then any comparison with it is also unknown:

```sql
SELECT NULL = NULL AS "null = null", NULL <> NULL AS "null <> null", NULL IS NULL AS "is null";
```

```
 null = null | null <> null | is null
-------------+--------------+---------
             |              | t
```

The first two came back **blank — which is psql printing NULL**, not false. `NULL = NULL`
is not false; it is unknown, because two unknown quantities may or may not be equal and
SQL declines to guess. This is why `IS NULL` exists as separate syntax: it is the only
operator that asks about the unknown-ness itself rather than about the value.

So SQL does not run on booleans. It runs on **three-valued logic**: true, false, unknown.
And the rule that turns that from trivia into production bugs is one line long:

> `WHERE` keeps a row only when the condition is **true**. Unknown is discarded, exactly
> like false.

Silently. That is the whole failure mode.

### The query that returns nothing, forever

Here is the shape, and it is in more codebases than anyone would like:

Three users, and one of the two orders has a NULL `user_id` — a returns row, a deleted
account, a legacy import, whatever your schema permits:

```sql
CREATE TABLE users(id int, name text);
INSERT INTO users VALUES (1, 'ana'), (2, 'bo'), (3, 'cy');
```

```sql
CREATE TABLE orders(id int, user_id int);
INSERT INTO orders VALUES (10, 1), (11, NULL);
SELECT name FROM users WHERE id NOT IN (SELECT user_id FROM orders);
```

```
 name
------
(0 rows)
```

Two users have never ordered anything. The query says nobody has. It is a perfectly
reasonable-looking way to ask the question, it returns a perfectly reasonable-looking
empty result, and it is wrong.

Expand it for user 2. `2 NOT IN (1, NULL)` means `2 <> 1 AND 2 <> NULL`:

```
 2=1 | 2=NULL | not in
-----+--------+--------
 f   |        |
```

`2 <> 1` is true. `2 <> NULL` is **unknown**. And `true AND unknown` is unknown — not
true — so `WHERE` drops the row. Now notice that nothing about this depended on the
number 2. Whatever value you test, the second term stays unknown, so the whole `NOT IN`
is at best unknown and the row is always dropped. **A single NULL anywhere in the list
makes `NOT IN` return nothing for every possible input.**

`IN` is not symmetric with it: `2 IN (1, NULL)` is also unknown and also drops the row,
but at least it can return true when there *is* a match, so the bug hides only the misses.
`NOT IN` hides everything.

The fix is `NOT EXISTS`, which is written in terms of rows rather than values and so has
nothing to be unknown about:

```sql
SELECT name FROM users WHERE NOT EXISTS (SELECT 1 FROM orders o WHERE o.user_id = users.id);
```

```
 name
------
 bo
 cy
```

Postgres will also usually plan `NOT EXISTS` better — as an anti-join rather than as a
filter — so the correct version is generally the faster one too. That is rare enough to
be worth enjoying.

### It is contagious

Unknown propagates through arithmetic and string operations as well as comparisons:

```sql
SELECT 'a' || NULL AS concat, 1 + NULL AS arith, coalesce('a' || NULL, 'fallback') AS fixed;
```

```
 concat | arith |  fixed
--------+-------+----------
        |       | fallback
```

`'a' || NULL` is not `'a'`. If one part of the greeting you are building is unknown, the
greeting is unknown. Every templating bug that renders an empty string where a name
should be traces back to this, and `coalesce(x, fallback)` — return the first non-NULL
argument — is the standard defence.

Aggregates go the other way and **skip NULLs entirely**, which is the source of a whole
second family of quiet wrongness:

```sql
CREATE TABLE n(v int);
INSERT INTO n VALUES (1), (2), (NULL);
SELECT count(*), count(v), sum(v), avg(v) FROM n;
```

```
 count | count | sum |       avg
-------+-------+-----+--------------------
     3 |     2 |   3 | 1.5000000000000000
```

`count(*)` counts rows: 3. `count(v)` counts non-NULL values: 2. And `avg` is 1.5, not 1
— it divided by 2, not by 3. If those NULLs represent "sensor was offline", the average
you just reported is the average of the readings you have, which is a defensible answer.
If they represent "we forgot to record a zero", it is a lie. The database cannot tell the
difference, and neither can the dashboard.

### The inconsistency the experts actually argue about

Here is where SQL stops being merely counter-intuitive and becomes genuinely
self-contradictory. `WHERE v = NULL` matches nothing, because two unknowns are not known
to be equal. Put a second NULL into that same table and ask two more questions of it:

```sql
INSERT INTO n VALUES (NULL);
SELECT v, count(*) FROM n GROUP BY v ORDER BY v;
SELECT count(DISTINCT v) AS distinct_v, count(*) AS all_rows FROM n;
```

```
 v | count            distinct_v | all_rows
---+-------           ------------+----------
 1 |     1                     2 |        4
 2 |     1
   |     2
```

`GROUP BY` collected the two NULL rows into **one group of two** — treating them as equal
to each other, in a language where `NULL = NULL` is not true — while `count(DISTINCT v)`
ignored them entirely and reported 2 distinct values out of 4 rows. `ORDER BY` has an opinion too:
Postgres sorts NULLs as larger than every value, so they land last ascending and first
descending, and `ORDER BY x NULLS FIRST` exists because the standard left it to the
implementation.

So NULLs are unequal in `WHERE`, equal in `GROUP BY` and `DISTINCT`, absent from
aggregates, and last-by-default in `ORDER BY`. Four different answers to "are two unknowns
the same thing", inside one language.

That inconsistency is why this is one of the longest-running arguments in database theory.
C. J. Date, who has spent four decades writing about the relational model and worked with
Codd himself, argues that nulls should be removed from it outright: that three-valued
logic makes queries mean things their authors cannot predict, and that missing information
belongs in additional relations rather than in a magic value. It is not a fringe position,
and it is not a settled one — Claude Rubinson's *Nulls, three-valued logic, and ambiguity
in SQL* (SIGMOD Record, 2007) argues Date misreads his own example queries, while
conceding the broader point: nulls introduce a startling amount of complexity into
apparently straightforward queries. Nobody in that argument thinks the current situation
is *good*. You have to write queries in it anyway.

### Worth knowing: UNIQUE lets in as many NULLs as you like — until you ask it not to

A `UNIQUE` constraint is defined in terms of equality, and NULLs are never equal, so:

```sql
CREATE TABLE u(v int UNIQUE);
INSERT INTO u VALUES (NULL), (NULL), (NULL);
SELECT count(*) FROM u;
```

```
 count
-------
     3
```

Three NULLs in a unique column, no error. This is the standard's behaviour and it is
correct by the rules — but it is not what "unique" means to the person reading your
schema, and it is why partial unique indexes and `NOT NULL` on key columns are so common.

PostgreSQL 15 finally added the other option:

```sql
CREATE TABLE u2(v int UNIQUE NULLS NOT DISTINCT);
INSERT INTO u2 VALUES (NULL);
INSERT INTO u2 VALUES (NULL);
```

```
ERROR:  duplicate key value violates unique constraint "u2_v_key"
DETAIL:  Key (v)=(null) already exists.
```

`NULLS NOT DISTINCT` says: for the purpose of this constraint, treat unknowns as equal to
each other. It arrived roughly thirty years into the language's life, which tells you how
long people put up with the alternative.

One more tool worth carrying: `IS DISTINCT FROM` is `<>` with unknowns treated as
comparable, so `WHERE v IS DISTINCT FROM 1` returns the NULL rows as well as the 2s —
which is almost always what the person writing `WHERE v <> 1` actually meant.

## Quiz

1. In PostgreSQL, what does `NULL = NULL` evaluate to, and what does `WHERE` do with a
   row whose condition evaluates to that?
2. Walk through why `WHERE x NOT IN (1, 2, NULL)` returns no rows for every possible `x`.
3. A column holds 1, 2 and NULL. What do `count(*)`, `count(v)` and `avg(v)` return, and
   why can that make a dashboard wrong without anything failing?
4. Name a place where SQL treats two NULLs as equal to each other and a place where it
   treats them as not equal.
5. A `UNIQUE` column already contains a NULL. You insert another NULL. What happens, and
   how would you make it fail instead?

## Task

Build the bug, then fix it, then prove the fix.

1. Create a `users` table and an `orders` table where `orders.user_id` is nullable, and
   insert at least one order whose `user_id` is NULL.
2. Ask "which users have never ordered" with `NOT IN` and a subquery. Record the result.
   It should be visibly, silently wrong.
3. Expand the failing condition by hand for one specific user: select each term of the
   `AND` separately and record what each one evaluates to.
4. Rewrite the question with `NOT EXISTS` and record the correct result.
5. Then explore the inconsistency: on a table containing two NULLs, run `GROUP BY`,
   `count(DISTINCT ...)`, `ORDER BY` and a `WHERE v = NULL`, and record which of them
   treated the two NULLs as the same thing.
6. Finally, get a `UNIQUE` column to accept several NULLs, then get it to reject them.

Write every result you saw into the file as a comment beside the query that produced it.
The comparison of step 2 against step 4 is the point of the exercise.

- File: `sql/day03.sql`
- Run: `psql -h localhost -U postgres -f sql/day03.sql`

### Checklist

- [ ] `NOT IN` with a NULL in the list observed returning zero rows
- [ ] the failing condition expanded term by term, with the unknown one identified
- [ ] the same question answered correctly with `NOT EXISTS`
- [ ] `count(*)`, `count(v)` and `avg(v)` compared on a column containing a NULL
- [ ] a `UNIQUE` column observed accepting several NULLs, then rejecting them
