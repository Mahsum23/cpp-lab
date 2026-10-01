# The LEFT JOIN that became an INNER JOIN

## Theory

`LEFT JOIN` is the join people reach for when they want to keep everybody: every customer,
whether or not they ordered. And there is a one-line change that quietly takes that promise
back. It is probably the single most common logic error in reporting SQL. It survives code
review because the query still reads exactly like what it was meant to do.

```sql
DROP SCHEMA IF EXISTS day05 CASCADE;
CREATE SCHEMA day05;
SET search_path = day05;

CREATE TABLE customers (id int PRIMARY KEY, name text NOT NULL);
CREATE TABLE orders (
  id          int PRIMARY KEY,
  customer_id int REFERENCES customers,
  status      text NOT NULL,
  amount      numeric(10,2) NOT NULL
);
INSERT INTO customers VALUES (1, 'ana'), (2, 'bo'), (3, 'cy'), (4, 'dee');
INSERT INTO orders VALUES
  (10, 1, 'paid',     120.00),
  (11, 1, 'refunded',  40.00),
  (12, 2, 'refunded',  30.00),
  (13, 3, 'paid',      90.00);
```

Four customers: `ana` has a paid order and a refund, `bo` has only a refund, `cy` has a
paid order, and `dee` has never ordered anything.

### What a join actually produces

Conceptually, every join starts from **every pairing** of a left row with a right row, and
`ON` decides which pairings survive. An inner join returns the survivors and nothing else:

```sql
SELECT c.name, o.id, o.status
FROM customers c JOIN orders o ON o.customer_id = c.id
ORDER BY c.name, o.id;
```

```text
 name | id |  status
------+----+----------
 ana  | 10 | paid
 ana  | 11 | refunded
 bo   | 12 | refunded
 cy   | 13 | paid
```

`dee` is gone, because no pairing for `dee` passed the `ON`. A `LEFT JOIN` makes one extra
promise: **every left row appears at least once.** When a left row has no surviving
pairing, the join invents one — the left row glued to a right side made entirely of NULLs.
That invented row is called a **NULL-extended row**, and the whole of today is about what
happens to it next.

```sql
SELECT c.name, o.id, o.status
FROM customers c LEFT JOIN orders o ON o.customer_id = c.id
ORDER BY c.name, o.id;
```

```text
 name | id |  status
------+----+----------
 ana  | 10 | paid
 ana  | 11 | refunded
 bo   | 12 | refunded
 cy   | 13 | paid
 dee  |    |
```

### The bug

The report someone asks for: *every customer, with their paid orders*. The natural thing
to write is the left join plus a filter:

```sql
SELECT c.name, o.id, o.status
FROM customers c LEFT JOIN orders o ON o.customer_id = c.id
WHERE o.status = 'paid'
ORDER BY c.name;
```

```text
 name | id | status
------+----+--------
 ana  | 10 | paid
 cy   | 13 | paid
```

`bo` and `dee` have vanished, and the report asked for every customer. Follow the two
rows through the pipeline from yesterday. The join runs first (`FROM`), then `WHERE` filters
what it produced:

- `dee`'s NULL-extended row has `o.status` = NULL. `NULL = 'paid'` is **unknown**, and
  `WHERE` keeps only **true**. The row the left join added specifically to keep `dee` is
  thrown away by the filter.
- `bo`'s only row is the refund. `'refunded' = 'paid'` is false, and that row goes too.
  `bo` was never NULL-extended at all, because `bo` *did* match an order.

So the `WHERE` deletes exactly the rows that made it a left join. What remains is identical
to an inner join, and the planner knows it.

### Postgres tells on you

Ask for the plan:

```sql
EXPLAIN (COSTS OFF)
SELECT c.name, o.id
FROM customers c LEFT JOIN orders o ON o.customer_id = c.id
WHERE o.status = 'paid';
```

```text
                      QUERY PLAN
------------------------------------------------------
 Nested Loop
   ->  Seq Scan on orders o
         Filter: (status = 'paid'::text)
   ->  Index Scan using customers_pkey on customers c
         Index Cond: (id = o.customer_id)
```

There is no `Left` anywhere in that plan. The planner proved that the `WHERE` condition
can never be true on a NULL-extended row, a property called being *strict*, so it rewrote
your outer join into an inner join and planned it that way. It does this to make the query
faster, not to warn you. But it is a warning, and a free one. **If you wrote `LEFT JOIN`
and the plan says plain `Join` or `Nested Loop`, your left join is not a left join.**

### The fix: the condition belongs in ON

`ON` decides which pairings survive *before* the NULL-extension happens. `WHERE` filters
*after*. Move the status test into `ON` and it becomes part of the definition of "a match":

```sql
SELECT c.name, o.id, o.status
FROM customers c
LEFT JOIN orders o ON o.customer_id = c.id AND o.status = 'paid'
ORDER BY c.name;
```

```text
 name | id | status
------+----+--------
 ana  | 10 | paid
 bo   |    |
 cy   | 13 | paid
 dee  |    |
```

Now `bo`'s refund is not a match, so `bo` has no surviving pairing and gets a
NULL-extended row like `dee`, which is exactly what "every customer, with their paid
orders" means. The plan agrees:

```sql
EXPLAIN (COSTS OFF)
SELECT c.name, o.id
FROM customers c
LEFT JOIN orders o ON o.customer_id = c.id AND o.status = 'paid';
```

```text
                  QUERY PLAN
-----------------------------------------------
 Hash Left Join
   Hash Cond: (c.id = o.customer_id)
   ->  Seq Scan on customers c
   ->  Hash
         ->  Seq Scan on orders o
               Filter: (status = 'paid'::text)
```

### The fix people reach for instead, which is also wrong

Most people who notice `dee` missing reason: "the NULL row is being dropped, so let NULLs
through":

```sql
SELECT c.name, o.id
FROM customers c LEFT JOIN orders o ON o.customer_id = c.id
WHERE o.status = 'paid' OR o.status IS NULL
ORDER BY c.name;
```

```text
 name | id
------+----
 ana  | 10
 cy   | 13
 dee  |
```

`dee` is back and `bo` is still missing. `bo` was never a NULL row. `bo` had a real,
non-paid match, which the `WHERE` deleted, and nothing was left to NULL-extend. This
version is worse than the original, because it passes the obvious test (customers with no
orders show up) and fails the subtle one (customers with only the wrong kind of order).

### And the mirror image

The rule is not "put conditions in `ON`". A condition on the **left** table inside `ON`
does not filter anything, because a left join keeps every left row regardless:

```sql
SELECT c.name, o.id
FROM customers c
LEFT JOIN orders o ON o.customer_id = c.id AND c.name = 'ana'
ORDER BY c.name, o.id;
```

```text
 name | id
------+----
 ana  | 10
 ana  | 11
 bo   |
 cy   |
 dee  |
```

Everyone is still here, with only `ana` allowed to match. So, for a `LEFT JOIN`:

| Condition is about… | Put it in… | Because |
|---|---|---|
| the **right** table (which matches count) | `ON` | `WHERE` would delete the NULL-extended rows |
| the **left** table (which rows to report) | `WHERE` | `ON` cannot remove left rows |

### count(*) lies after an outer join

One more consequence of the NULL-extended row. It is a real row, so `count(*)` counts it:

```sql
SELECT c.name, count(*) AS star, count(o.id) AS orders
FROM customers c LEFT JOIN orders o ON o.customer_id = c.id
GROUP BY c.name
ORDER BY c.name;
```

```text
 name | star | orders
------+------+--------
 ana  |    2 |      2
 bo   |    1 |      1
 cy   |    1 |      1
 dee  |    1 |      0
```

`dee` has never ordered and `count(*)` says 1. After an outer join, count a column from the
right table, ideally its key: `count(o.id)` skips NULLs, which is exactly what you want
here. The same goes for sums. `sum` over a NULL-extended row is NULL, so wrap it:

```sql
SELECT c.name, coalesce(sum(o.amount), 0) AS paid
FROM customers c
LEFT JOIN orders o ON o.customer_id = c.id AND o.status = 'paid'
GROUP BY c.name
ORDER BY c.name;
```

```text
 name |  paid
------+--------
 ana  | 120.00
 bo   |      0
 cy   |  90.00
 dee  |      0
```

### Using the NULL row on purpose: the anti-join

"Customers who have never ordered" is a question *about* the NULL-extended row, so here a
`WHERE … IS NULL` is exactly right. Test the right table's join column, which can only be
NULL on an invented row:

```sql
SELECT c.name
FROM customers c LEFT JOIN orders o ON o.customer_id = c.id
WHERE o.customer_id IS NULL;
```

```text
 name
------
 dee
```

This is called an **anti-join**: rows on the left with no partner on the right. It means
the same thing as last week's `NOT EXISTS`, and Postgres plans the two identically:

```sql
EXPLAIN (COSTS OFF)
SELECT c.name FROM customers c
WHERE NOT EXISTS (SELECT 1 FROM orders o WHERE o.customer_id = c.id);
```

```text
             QUERY PLAN
-------------------------------------
 Hash Right Anti Join
   Hash Cond: (o.customer_id = c.id)
   ->  Seq Scan on orders o
   ->  Hash
         ->  Seq Scan on customers c
```

`Right Anti Join` is new in PostgreSQL 16. It lets the planner build its hash table on
whichever side is smaller, even for an anti-join. Of the two spellings, `NOT EXISTS` is the
one that says what you mean, and it cannot be broken by testing the wrong column.

### Worth knowing: Postgres will delete a join you wrote

Add a one-to-one table and join to it without using any of its columns:

```sql
CREATE TABLE profiles (customer_id int PRIMARY KEY REFERENCES customers, bio text);
EXPLAIN (COSTS OFF)
SELECT c.name FROM customers c LEFT JOIN profiles p ON p.customer_id = c.id;
```

```text
       QUERY PLAN
-------------------------
 Seq Scan on customers c
```

The join is not in the plan at all. Because `profiles.customer_id` is unique, each
customer matches at most one profile, so a left join can neither add rows nor remove them.
And since no profile column is used, the whole join is provably a no-op. PostgreSQL 9.0
added this *join removal*, and its release materials pitched it as an optimisation for
ORM-generated queries, which routinely join tables that the final `SELECT` never touches.
Select `p.bio` and the join comes straight back. It also needs the uniqueness: the same
join to `orders`, where a customer can match many rows, stays in the plan.

### Watch for: NATURAL JOIN

`NATURAL JOIN` joins on *every* column the two tables share a name with. That reads as
convenient until somebody adds a column:

```sql
CREATE TABLE a (id int, note text);
CREATE TABLE b (id int, val int);
INSERT INTO a VALUES (1, 'x'), (2, 'y');
INSERT INTO b VALUES (1, 100), (2, 200);
SELECT * FROM a NATURAL JOIN b ORDER BY id;
```

```text
 id | note | val
----+------+-----
  1 | x    | 100
  2 | y    | 200
```

```sql
ALTER TABLE b ADD note text;
SELECT * FROM a NATURAL JOIN b ORDER BY id;
```

```text
 id | note | val
----+------+-----
(0 rows)
```

Nobody touched the query. A migration added an unrelated `note` column to `b`, and now
the join condition is `a.id = b.id AND a.note = b.note`, where every `b.note` is NULL. Write
the join columns out with `ON`, every time.

### Carry this

- A `LEFT JOIN` adds a NULL-extended row for each unmatched left row. Every condition
  after the join decides whether that row survives.
- A condition on the right table of a `LEFT JOIN` goes in `ON`. In `WHERE` it silently
  turns the join into an inner join.
- If you wrote `LEFT JOIN` and `EXPLAIN` shows no `Left`, that is your bug.
- After an outer join, use `count(right_table.key)`, never `count(*)`, and
  `coalesce(sum(…), 0)`.
- For "has no X", `NOT EXISTS` says exactly what you mean.

## Quiz

1. In a `LEFT JOIN`, what is a NULL-extended row, and when does the join produce one?
2. `customers LEFT JOIN orders ON o.customer_id = c.id WHERE o.status = 'paid'` loses
   every customer without a paid order. Why does it lose the customers who have no
   orders at all, and why does it also lose the customers who have only refunds?
3. Why does adding `OR o.status IS NULL` to that `WHERE` still give a wrong answer?
4. You wrote a `LEFT JOIN`, and `EXPLAIN` shows a plain `Nested Loop` with no `Left` in
   it. What does that tell you?
5. After `customers LEFT JOIN orders … GROUP BY c.name`, why does `count(*)` report 1 for
   a customer who has never ordered, and what should be counted instead?

## Drill

1. A condition about the *left* table is placed in a `LEFT JOIN`'s `ON`. How many rows
   come back?
2. A query lists every product with its review count. Find the bug.
3. Which of three queries returns the customers who have never ordered?

## Task

Lose customers with one misplaced condition, prove it from the plan, and fix it.

1. Start the file with the day's setup block from the lesson.
2. Write "every customer with their paid orders" with the status condition in `WHERE`.
   Record the result and name each customer who is missing.
3. Run `EXPLAIN (COSTS OFF)` on it and record the join node. Explain in a comment why it
   is not a left join.
4. Move the condition into `ON`. Record the result and the new plan's join node.
5. Try `WHERE o.status = 'paid' OR o.status IS NULL`, record which customer is still
   missing, and explain why in a comment.
6. Write "orders per customer" with `count(*)` and with `count(o.id)`, and record the row
   where they disagree.
7. Write "customers who have never ordered" as an anti-join, both as `LEFT JOIN … IS NULL`
   and as `NOT EXISTS`.

Record what each query printed as a comment beside it.

- File: `sql/day05.sql`
- Run: `psql -h localhost -U postgres -f sql/day05.sql`

### Checklist

- [ ] the `WHERE` version run, with the missing customers named and the reason for each
- [ ] the `EXPLAIN` join node recorded for both the `WHERE` and the `ON` versions, and
      the difference explained
- [ ] the `OR … IS NULL` attempt run, with the customer it still loses named and explained
- [ ] `count(*)` and `count(o.id)` compared after the left join, with the disagreeing row
      recorded
- [ ] "never ordered" written both as `LEFT JOIN … IS NULL` and as `NOT EXISTS`, with the
      same result
