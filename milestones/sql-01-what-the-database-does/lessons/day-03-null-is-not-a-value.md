# NULL is not a value

## Theory

The last two days were physical. This one is about semantics, and it's here early
because it is the single most reliable source of quietly wrong answers in SQL — the kind
that don't error, don't look odd, and are off by exactly the rows you cared about.

### Three-valued logic

Most languages have two truth values. SQL has three: **true, false, and unknown**.

`NULL` does not mean zero, or empty string, or "false". It means *no value is recorded
here*, and the consequence is that any comparison involving it can't produce a verdict:

```sql
SELECT NULL = NULL;
SELECT NULL <> NULL;
SELECT NULL IS NULL;
```

The first two return `NULL` — not true, not false. Only the third returns `1`. That is
the whole design in three lines: **you cannot ask whether an unknown equals anything,
including another unknown.** "Is the value I don't know the same as the other value I
don't know?" has no honest answer but "unknown", and SQL refuses to invent one.

`WHERE` keeps only rows where the condition is **true**. Unknown is not true, so:

```sql
SELECT 1 WHERE NULL = NULL;
```

returns no rows. Not an error, not a warning — silence. That silence is the entire
problem.

### The one that has actually cost people money

`NOT IN` with a `NULL` anywhere in the list returns nothing. Ever.

```sql
SELECT 3 WHERE 3 IN (1, NULL);
SELECT 3 WHERE 3 NOT IN (1, NULL);
```

Both come back empty, and the second is the dangerous one. Expand it: `3 NOT IN (1,
NULL)` is `3 <> 1 AND 3 <> NULL`, which is `true AND unknown`, which is **unknown** —
not true, so the row is dropped. It doesn't matter that 3 obviously isn't in the list.
As long as one `NULL` is present, `NOT IN` can never return true for any value.

The usual shape in real code:

```sql
SELECT * FROM orders
WHERE customer_id NOT IN (SELECT id FROM banned_customers);
```

The day someone inserts a `banned_customers` row with a `NULL` id, this query silently
returns zero orders. It has been correct for two years; nothing was deployed; there is
no error in any log. Use `NOT EXISTS` instead, which asks a row-at-a-time question and
is immune:

```sql
SELECT * FROM orders o
WHERE NOT EXISTS (SELECT 1 FROM banned_customers b WHERE b.id = o.customer_id);
```

### Aggregates quietly disagree with each other

```sql
CREATE TABLE u(v INTEGER);
INSERT INTO u VALUES (1), (2), (NULL);
SELECT count(*), count(v), sum(v), avg(v) FROM u;
```

`3, 2, 3, 1.5`.

`count(*)` counts rows. `count(v)` counts **non-null values** — a different question with
a confusingly similar spelling. `sum` and `avg` skip nulls entirely, so the average is
3/2, not 3/3. If your "average response time" quietly excludes every request that
timed out and recorded no time, you have a metric that improves as your service gets
worse.

### Where NULL suddenly does equal NULL

Having insisted that nothing equals `NULL`, SQL then has two places where nulls are
treated as the same thing after all:

```sql
SELECT v, count(*) FROM u GROUP BY v;
```

`GROUP BY` puts all the nulls in one group, and `DISTINCT` collapses them to one row.
It has to — grouping is about identity, not comparison — but it does mean the same
`NULL` that refuses to equal itself in a `WHERE` cheerfully groups with itself one clause
later.

### Worth knowing: UNIQUE doesn't mean unique

```sql
CREATE TABLE w(v INTEGER UNIQUE);
INSERT INTO w VALUES (NULL), (NULL), (NULL);
SELECT count(*) FROM w;
```

Three rows, no error. A `UNIQUE` constraint is enforced by comparing values, and two
nulls don't compare equal, so the constraint has nothing to object to. Standard SQL
requires this, and SQLite, PostgreSQL, Oracle and MySQL all agree.

This is why "one active session per user" implemented as a nullable `UNIQUE` column
lets you create unlimited sessions with a null in it. PostgreSQL 15 finally added
`UNIQUE NULLS NOT DISTINCT` to opt out — a good clue as to how often this bites, since
it took the standard about forty years to admit people wanted the other behaviour.

## Quiz

1. `SELECT NULL = NULL` — what comes back, and why isn't it either true or false?
2. Why does `WHERE x NOT IN (1, 2, NULL)` return no rows regardless of what `x` is?
3. A table has 100 rows; 30 have a null `duration`. What do `count(*)`, `count(duration)`
   and `avg(duration)` each report, and which one silently misleads?
4. Name the two places where SQL treats two nulls as the same thing, despite `NULL =
   NULL` being unknown.
5. You add `UNIQUE` to a nullable column to enforce "at most one active session per
   user". What actually happens?

## Task

Make each of these bite, then fix it.

1. Build a small table with some nulls in it.
2. Write a `NOT IN` query against a subquery that contains a null, and confirm it returns
   nothing when it obviously should return rows.
3. Rewrite the same question with `NOT EXISTS` and confirm it's now correct.
4. Show `count(*)`, `count(col)`, `sum` and `avg` disagreeing on the same column, and
   work out by hand what the average *should* be if nulls counted as zero.
5. Create a `UNIQUE` column and insert three nulls into it. Then find a way to actually
   forbid that — a partial index or a `CHECK` will do it.

- File: `sql/day03.sql`
- Run: `sqlite3 day03.db < sql/day03.sql`

### Checklist

- [ ] `NULL = NULL` evaluated, and the result is neither 0 nor 1
- [ ] a `NOT IN` query returning nothing because of one null, demonstrated
- [ ] the same question answered correctly with `NOT EXISTS`
- [ ] `count(*)` and `count(col)` shown disagreeing, and `avg` explained
- [ ] three nulls inserted into a `UNIQUE` column, then a constraint that does stop them
