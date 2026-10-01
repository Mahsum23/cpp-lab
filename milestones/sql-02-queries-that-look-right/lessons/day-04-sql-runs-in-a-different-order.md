# SQL does not run in the order you write it

## Theory

You write `SELECT` first. The database runs it nearly last. That one mismatch is behind
a surprising share of the errors people hit in their first few years of SQL, and behind a
few that never throw an error at all. Once you can see the real order, most of SQL's
"arbitrary" rules turn out to be consequences of it.

Every day this week starts in its own schema, so today's tables never collide with
yesterday's. If you reconnect, run the `SET` line again; it only lasts for the session.

```sql
DROP SCHEMA IF EXISTS day04 CASCADE;
CREATE SCHEMA day04;
SET search_path = day04;

CREATE TABLE orders (
  id       int PRIMARY KEY,
  customer text NOT NULL,
  status   text NOT NULL,
  amount   numeric(10,2) NOT NULL
);
INSERT INTO orders VALUES
  (1, 'ana', 'paid',      120.00),
  (2, 'ana', 'paid',       40.00),
  (3, 'bo',  'cancelled', 500.00),
  (4, 'bo',  'paid',       30.00),
  (5, 'cy',  'paid',       90.00),
  (6, 'cy',  'paid',       25.00);
```

### The order on paper, and the order it runs in

A `SELECT` statement is a pipeline. Each clause takes a set of rows and hands a new set of
rows to the next one. The *logical* order of that pipeline is:

| Clause, in running order | What it does to the rows |
|---|---|
| 1. `FROM`, `JOIN` | builds the input rows |
| 2. `WHERE` | throws away input rows |
| 3. `GROUP BY` | collapses rows into groups |
| 4. `HAVING` | throws away groups |
| 5. `SELECT` | computes the output columns, window functions included, and names them |
| 6. `DISTINCT` | removes duplicate output rows |
| 7. `ORDER BY` | sorts the output rows |
| 8. `LIMIT`, `OFFSET` | keeps a slice of them |

"Logical" is doing real work in that sentence. The optimizer is free to execute things in
any physical order that gives the same answer. It pushes filters down, uses an index to
avoid a sort, stops early for a `LIMIT`. What it may not do is give you an answer that
differs from running these steps in this order. So this is the order to reason in, and the
order every name-resolution rule follows.

The rule that matters most: **a clause can only see what the steps before it produced.**

### Every one of these errors is the pipeline showing through

An alias is created in step 5. `WHERE` is step 2, so the alias does not exist yet:

```sql
SELECT id, amount * 1.2 AS gross FROM orders WHERE gross > 100;
```

```text
ERROR:  column "gross" does not exist
LINE 1: ...ELECT id, amount * 1.2 AS gross FROM orders WHERE gross > 10...
                                                             ^
```

`ORDER BY` is step 7, after the alias exists, so the same name works there:

```sql
SELECT id, amount * 1.2 AS gross FROM orders ORDER BY gross DESC LIMIT 2;
```

```text
 id |  gross
----+---------
  3 | 600.000
  1 | 144.000
```

Now a quirk worth knowing exactly. `ORDER BY` accepts an output alias only *on its own*.
Put it inside an expression and Postgres goes looking for an input column instead, and does
not find one:

```sql
SELECT id, amount * 1.2 AS gross FROM orders ORDER BY gross + 0;
```

```text
ERROR:  column "gross" does not exist
LINE 1: ...CT id, amount * 1.2 AS gross FROM orders ORDER BY gross + 0;
                                                             ^
```

This is history showing through. In SQL-92, `ORDER BY` could only name output columns,
while `GROUP BY` could only use input columns. Later standards and Postgres allow arbitrary
expressions in both, and the manual states the rule plainly: a name that appears *inside an
expression* is always taken as an input column.

Aggregates are computed in step 3. `WHERE` runs before any group exists, so it cannot ask
about a sum:

```sql
SELECT customer, sum(amount) FROM orders WHERE sum(amount) > 150 GROUP BY customer;
```

```text
ERROR:  aggregate functions are not allowed in WHERE
LINE 1: SELECT customer, sum(amount) FROM orders WHERE sum(amount) >...
                                                       ^
```

That is what `HAVING` is for: a `WHERE` that runs after grouping, on groups. It still runs
before `SELECT`, though, so it cannot use the alias either. Spell the aggregate out:

```sql
SELECT customer, sum(amount) AS total
FROM orders
GROUP BY customer
HAVING sum(amount) > 150
ORDER BY customer;
```

```text
 customer | total
----------+--------
 ana      | 160.00
 bo       | 530.00
```

`DISTINCT` is step 6 and `ORDER BY` is step 7. After `DISTINCT` has collapsed six orders
into three customers, there is no single `amount` left to sort a customer by, and Postgres
says so rather than picking one:

```sql
SELECT DISTINCT customer FROM orders ORDER BY amount;
```

```text
ERROR:  for SELECT DISTINCT, ORDER BY expressions must appear in select list
LINE 1: SELECT DISTINCT customer FROM orders ORDER BY amount;
                                                      ^
```

Five errors with five messages, and all of them come from the same one rule.

### WHERE and HAVING answer different questions

The errors are the cheap part, because they stop you. The expensive version runs fine.

"Which customers spent more than 150?" Look again at the `HAVING` result: `bo` is in it,
with 530. But 500 of that was a cancelled order. Whether `bo` belongs in the answer depends
on whether the filter on `status` happens **before** grouping (it changes what gets summed)
or not at all:

```sql
SELECT customer, sum(amount) AS total
FROM orders
WHERE status = 'paid'
GROUP BY customer
HAVING sum(amount) > 150
ORDER BY customer;
```

```text
 customer | total
----------+--------
 ana      | 160.00
```

Same `HAVING`, different answer, because `WHERE` changed which rows reached the sum. The
working rule:

- a condition about **one row** (`status = 'paid'`) goes in `WHERE`;
- a condition about **a group** (`sum(amount) > 150`) goes in `HAVING`.

Putting a row condition in `HAVING` is usually either an error or a slower way to get the
same result. Leaving it out entirely is a wrong number that nothing will ever flag.

### Seeing the order with your own eyes

You do not have to take the table above on trust. `EXPLAIN` shows you the plan, and a
plan is a tree that runs **from the innermost node outwards**. Read it bottom-up:

```sql
EXPLAIN (COSTS OFF)
SELECT customer, sum(amount) AS total
FROM orders
WHERE status = 'paid'
GROUP BY customer
HAVING sum(amount) > 100
ORDER BY total DESC
LIMIT 1;
```

```text
                        QUERY PLAN
-----------------------------------------------------------
 Limit
   ->  Sort
         Sort Key: (sum(amount)) DESC
         ->  GroupAggregate
               Group Key: customer
               Filter: (sum(amount) > '100'::numeric)
               ->  Sort
                     Sort Key: customer
                     ->  Seq Scan on orders
                           Filter: (status = 'paid'::text)
```

From the bottom: scan `orders` (**FROM**), with a filter on each row (**WHERE**). Sort by
customer so equal customers are adjacent, then aggregate them (**GROUP BY**), with a filter
on each group (**HAVING**). Sort by the total (**ORDER BY**), then stop after one row
(**LIMIT**). Your query, run in exactly the order the table above promised. Note that the
`WHERE` filter is attached to the scan and the `HAVING` filter is attached to the
aggregate. That is the whole difference between them, made physical.

### The GROUP BY rule, and why it exists

After `GROUP BY customer`, each output row stands for several input rows. So what could
`status` mean in that row?

```sql
SELECT customer, status, sum(amount) FROM orders GROUP BY customer;
```

```text
ERROR:  column "orders.status" must appear in the GROUP BY clause or be used in an aggregate function
LINE 1: SELECT customer, status, sum(amount) FROM orders GROUP BY cu...
                         ^
```

`bo` has one paid order and one cancelled one. There is no single status to show. Every
column in the `SELECT` list must either be grouped on, so it is the same for the whole
group, or be inside an aggregate, so it is reduced to one value.

This strictness was not always universal, and the history is a good argument for it. For
years MySQL accepted exactly this query and returned *some* `status` from the group,
whichever one it happened to read first. That was an indeterminate value, delivered
without a warning. MySQL turned the strict mode `ONLY_FULL_GROUP_BY` on by default in
5.7.5, and a lot of old applications broke on upgrade. They had been relying on a value
the database had never promised.

Postgres has one sensible exception, called **functional dependency**. If you group by a
table's primary key, every other column of that table is determined by it, so it is safe
to select:

```sql
CREATE TABLE customers (id int PRIMARY KEY, name text, city text);
INSERT INTO customers VALUES (1, 'ana', 'Tashkent'), (2, 'bo', 'Lisbon'), (3, 'cy', 'Oslo');
SELECT c.id, c.name, c.city, count(*) AS orders
FROM customers c JOIN orders o ON o.customer = c.name
GROUP BY c.id
ORDER BY c.id;
```

```text
 id | name |   city   | orders
----+------+----------+--------
  1 | ana  | Tashkent |      2
  2 | bo   | Lisbon   |      2
  3 | cy   | Oslo     |      2
```

Group by `c.name` instead and the same query is rejected, because nothing promises that
two customers cannot share a name.

### The empty group that isn't empty

One more consequence, and it bites people writing totals for dashboards. An aggregate
**without** `GROUP BY` treats the whole input as one group, even when the input is empty.
So it always returns exactly one row:

```sql
SELECT count(*), sum(amount) FROM orders WHERE customer = 'zed';
```

```text
 count | sum
-------+-----
     0 |
```

`count` says 0, as you would hope. `sum` of no rows is NULL, not 0, and every NULL rule
from last week applies to it from here on: `total + sum(...)` is now NULL. Write
`coalesce(sum(amount), 0)` when you mean zero. Add a `GROUP BY` and the same filter returns
**no rows at all**, because there are no groups to report:

```sql
SELECT customer, count(*) FROM orders WHERE customer = 'zed' GROUP BY customer;
```

```text
 customer | count
----------+-------
(0 rows)
```

Code that reads "the first row" of the result has to handle both shapes.

### The argument about whether SELECT should come first

The order you write a query in and the order it runs in disagree, and plenty of people
think the way you write it is the mistake. Julia Evans's widely shared explainer is titled
simply *SQL queries don't start with SELECT*. Some tools now let you write it in the
running order instead. DuckDB accepts `FROM orders SELECT customer`, or just `FROM orders`.
In 2024 a team at Google published *SQL Has Problems. We Can Fix Them: Pipe Syntax In SQL*
at VLDB. It argues that the fixed clause order is one of the main reasons SQL is hard to
learn and to edit, and it describes a piped form, implemented in Google's own SQL dialect,
where each step reads top to bottom in the order it runs.

The other side has a strong argument of its own. Fifty years of SQL, every tutorial, every
ORM and every engine you will meet uses `SELECT … FROM`. Postgres has not adopted either
form. So the practical position today: you will write `SELECT` first for the foreseeable
future, and you should *read* every query in the running order anyway.

### Worth knowing: GROUP BY and ORDER BY disagree about names

Postgres lets `GROUP BY` use an output alias, or a column position, as a convenience:

```sql
SELECT upper(customer) AS who, count(*) FROM orders GROUP BY who ORDER BY who;
```

```text
 who | count
-----+-------
 ANA |     2
 BO  |     2
 CY  |     2
```

Now give the alias the same name as an input column, and add a customer whose name differs
only in case:

```sql
INSERT INTO orders VALUES (7, 'Ana', 'paid', 10.00);
SELECT lower(customer) AS customer, count(*)
FROM orders
GROUP BY customer
ORDER BY customer, count(*);
```

```text
 customer | count
----------+-------
 ana      |     1
 ana      |     2
 bo       |     2
 cy       |     2
```

`ana` appears twice. When a name is ambiguous, **`GROUP BY` resolves it to the input
column** (`'Ana'` and `'ana'` are different groups), while **`ORDER BY` resolves it to the
output column** (both print as `ana`). Postgres lets each clause use the other kind of name
as an extension, and when a name could be either it falls back to the reading SQL-92 gave
that clause. Each choice is defensible on its own. Together they produce this. The fix is
to never reuse an input column's name as an alias, or to group by position
(`GROUP BY 1`), which is unambiguous.

### Carry this

- Read every query in running order: FROM, WHERE, GROUP BY, HAVING, SELECT, DISTINCT,
  ORDER BY, LIMIT.
- A clause sees only what the steps before it produced. That is why an alias is invisible
  to `WHERE` and `HAVING`, and why aggregates are invisible to `WHERE`.
- Row conditions go in `WHERE`, group conditions go in `HAVING`.
- `sum()` of nothing is NULL. Use `coalesce(sum(x), 0)` when you mean zero.
- Never name an alias after an input column.

## Quiz

1. `SELECT amount * 2 AS doubled FROM orders WHERE doubled > 100` fails with "column
   doubled does not exist", while `… ORDER BY doubled` works. Why?
2. A report should list customers whose paid orders total more than 150. Where does
   `status = 'paid'` go, where does `sum(amount) > 150` go, and what goes wrong if the
   status condition is left out?
3. In an `EXPLAIN` plan for a query with both `WHERE` and `HAVING`, where does each filter
   appear, and why?
4. `SELECT customer, status, sum(amount) FROM orders GROUP BY customer` is rejected, but
   grouping by a table's primary key lets you select its other columns. What is the
   principle behind both?
5. `SELECT sum(amount) FROM orders WHERE false` and the same query with
   `GROUP BY customer` added: how many rows does each return, and what is in them?

## Drill

1. A query filters groups with a `SELECT` alias in `HAVING`. Does it run?
2. Predict what an aggregate with no `GROUP BY` returns when its `WHERE` matches nothing.
3. A "top customer" query sorts by a total and keeps one row. Who comes out on top, and
   what is wrong with that answer?

## Task

Trigger the pipeline's rules on purpose, then read the pipeline in a real plan.

1. Start the file with the day's setup block (schema, `orders` table, rows) from the
   lesson, so it runs on its own.
2. Write a query that uses a `SELECT` alias in `WHERE`, run it, and record the error.
   Then fix it twice: once by repeating the expression in `WHERE`, once by wrapping the
   query in a subquery and filtering the alias outside it.
3. Write the "customers whose **paid** orders total more than 150" report correctly, and
   next to it the version without the status filter. Record both results and which
   customer differs.
4. Run `EXPLAIN (COSTS OFF)` on the correct report and, in a comment, label each plan
   node with the clause it implements (FROM, WHERE, GROUP BY, HAVING, ORDER BY, LIMIT).
5. Show `sum()` returning one NULL row over an empty input, and the `GROUP BY` version
   returning zero rows. Then make the first one return 0.
6. Reproduce the `GROUP BY` / `ORDER BY` name disagreement with an alias that reuses an
   input column's name, and fix it.

`psql -f` keeps going after an error, so leave the failing queries in. They are part of
the record. Write what each query printed as a comment beside it.

- File: `sql/day04.sql`
- Run: `psql -h localhost -U postgres -f sql/day04.sql`

### Checklist

- [ ] an alias used in `WHERE`, its error recorded, and fixed both by repeating the
      expression and with a subquery
- [ ] the paid-orders report written with the status condition in `WHERE`, compared
      against the version without it, with the customer who differs named
- [ ] an `EXPLAIN` plan with every node labelled with the clause it implements
- [ ] an aggregate over an empty input returning one NULL row, the `GROUP BY` version
      returning none, and `coalesce` turning the NULL into 0
- [ ] the `GROUP BY` versus `ORDER BY` alias disagreement reproduced and fixed
