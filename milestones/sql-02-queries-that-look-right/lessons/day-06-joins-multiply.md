# Joins multiply

## Theory

Yesterday a join quietly *lost* rows. Today it quietly makes extra ones, which is worse,
because extra rows go straight into sums, and inflated sums look like good news. Nobody
files a bug when revenue goes up.

```sql
DROP SCHEMA IF EXISTS day06 CASCADE;
CREATE SCHEMA day06;
SET search_path = day06;

CREATE TABLE orders   (id int PRIMARY KEY, customer text NOT NULL, total numeric(10,2) NOT NULL);
CREATE TABLE items    (order_id int REFERENCES orders, sku text NOT NULL, qty int NOT NULL);
CREATE TABLE payments (order_id int REFERENCES orders, amount numeric(10,2) NOT NULL);

INSERT INTO orders VALUES (1, 'ana', 100.00), (2, 'bo', 80.00);
INSERT INTO items VALUES (1, 'mug', 1), (1, 'tea', 2), (1, 'spoon', 1), (2, 'kettle', 1);
INSERT INTO payments VALUES (1, 50.00), (1, 50.00), (2, 80.00);
```

Two orders. `ana` bought three things for 100.00 and paid in two halves, which is a
perfectly ordinary split payment. `bo` bought a kettle for 80.00 and paid once. The truth,
straight from each table:

```sql
SELECT (SELECT sum(total) FROM orders) AS revenue, (SELECT sum(amount) FROM payments) AS paid;
```

```text
 revenue |  paid
---------+--------
  180.00 | 180.00
```

### A join repeats the "one" side once per match on the "many" side

Join orders to items and sum the order totals:

```sql
SELECT sum(o.total) FROM orders o JOIN items i ON i.order_id = o.id;
```

```text
  sum
--------
 380.00
```

Nothing is broken here. The join did exactly what joins do. `ana`'s order matched three
item rows, so it appears three times, and its 100.00 is summed three times:
`3 × 100 + 1 × 80 = 380`. In one-to-many terms, the "one" side (an order) is repeated once
for every match on the "many" side (its items). This is called **fan-out**.

### Two "many" sides multiply

Now the report someone actually asked for: per customer, revenue, amount paid, and number
of line items. One query, two joins:

```sql
SELECT o.customer,
       sum(o.total)  AS revenue,
       sum(p.amount) AS paid,
       count(i.sku)  AS lines
FROM orders o
JOIN items    i ON i.order_id = o.id
JOIN payments p ON p.order_id = o.id
GROUP BY o.customer
ORDER BY o.customer;
```

```text
 customer | revenue |  paid  | lines
----------+---------+--------+-------
 ana      |  600.00 | 300.00 |     6
 bo       |   80.00 |  80.00 |     1
```

`ana`'s 100.00 order shows as 600.00 in revenue, 300.00 paid, and 6 lines. `bo` is right,
and only by luck: one item and one payment, so nothing multiplied. That is how this bug
survives testing. Every simple test case comes out right.

Look at the rows the aggregates actually saw:

```sql
SELECT o.id, i.sku, p.amount
FROM orders o
JOIN items    i ON i.order_id = o.id
JOIN payments p ON p.order_id = o.id
ORDER BY o.id, i.sku, p.amount;
```

```text
 id |  sku   | amount
----+--------+--------
  1 | mug    |  50.00
  1 | mug    |  50.00
  1 | spoon  |  50.00
  1 | spoon  |  50.00
  1 | tea    |  50.00
  1 | tea    |  50.00
  2 | kettle |  80.00
```

Items and payments have nothing to do with each other. They are both about the order,
not about each other, so the join paired **every item with every payment**: 3 × 2 = 6 rows
for order 1. Revenue counted the order once per row (×6). Payments were counted once per
item (×3). Items were counted once per payment (×2). Three different wrong numbers, each
off by a different factor.

### See the multiplication in the plan

`EXPLAIN ANALYZE` runs the query and reports how many rows each node actually produced,
which makes fan-out visible without guessing:

```sql
EXPLAIN (ANALYZE, COSTS OFF, TIMING OFF, SUMMARY OFF)
SELECT sum(o.total)
FROM orders o
JOIN items    i ON i.order_id = o.id
JOIN payments p ON p.order_id = o.id;
```

```text
                                 QUERY PLAN
----------------------------------------------------------------------------
 Aggregate (actual rows=1 loops=1)
   ->  Hash Join (actual rows=7 loops=1)
         Hash Cond: (i.order_id = o.id)
         ->  Seq Scan on items i (actual rows=4 loops=1)
         ->  Hash (actual rows=3 loops=1)
               Buckets: 2048  Batches: 1  Memory Usage: 17kB
               ->  Hash Join (actual rows=3 loops=1)
                     Hash Cond: (p.order_id = o.id)
                     ->  Seq Scan on payments p (actual rows=3 loops=1)
                     ->  Hash (actual rows=2 loops=1)
                           Buckets: 1024  Batches: 1  Memory Usage: 9kB
                           ->  Seq Scan on orders o (actual rows=2 loops=1)
```

Read it bottom-up again: 2 orders come in, 3 rows leave the first join, 7 leave the
second. Two orders fed the aggregate seven rows. On a real table this is the number to look
at, and when a join's output is larger than the row count of the table you meant to
report on, you have fan-out. (Your `Memory Usage` figures may differ slightly. The `rows=`
numbers will not.)

### Grain: what one row means

The idea that prevents all of this has a name from data warehousing: **grain**. The grain of
a result is what one row of it *stands for*. Ralph Kimball's four-step design process
puts "declare the grain" second, right after choosing the business process. His group's
writing calls failing to declare it up front the most frequent design error.

Apply it to the report. The intended grain is **one row per customer**. `orders` has a grain
of one row per order. `items` has one row per order line. `payments` has one row per
payment. Joining tables of different grains produces a result whose grain is *their
combination*, here one row per (line, payment) pair, and summing anything at that grain
counts it once per pair.

So the rule: **bring each table to the grain of the report before you join it.**

### The fix: aggregate first, join second

Collapse `items` and `payments` to one row per order each. Now every join is one-to-one,
and nothing can multiply:

```sql
SELECT o.customer, o.total AS revenue, p.paid, i.lines
FROM orders o
JOIN (SELECT order_id, count(*) AS lines FROM items GROUP BY order_id) i
  ON i.order_id = o.id
JOIN (SELECT order_id, sum(amount) AS paid FROM payments GROUP BY order_id) p
  ON p.order_id = o.id
ORDER BY o.customer;
```

```text
 customer | revenue |  paid  | lines
----------+---------+--------+-------
 ana      |  100.00 | 100.00 |     3
 bo       |   80.00 |  80.00 |     1
```

Every number is right. The same idea written as correlated subqueries, one per measure, is
often easier to read and just as correct:

```sql
SELECT o.customer, o.total AS revenue,
       (SELECT sum(amount) FROM payments p WHERE p.order_id = o.id) AS paid,
       (SELECT count(*)    FROM items    i WHERE i.order_id = o.id) AS lines
FROM orders o
ORDER BY o.customer;
```

```text
 customer | revenue |  paid  | lines
----------+---------+--------+-------
 ana      |  100.00 | 100.00 |     3
 bo       |   80.00 |  80.00 |     1
```

Either form keeps the grain honest. A customer with several orders would need one more
`GROUP BY customer` on top. The principle does not change: aggregate the "many" side
before it meets anything else.

### The tempting fix that loses money

`count(DISTINCT x)` is a correct way to count things that a join duplicated. So it is
natural to reach for `DISTINCT` everywhere:

```sql
SELECT o.customer,
       sum(DISTINCT o.total)  AS revenue,
       sum(DISTINCT p.amount) AS paid,
       count(DISTINCT i.sku)  AS lines
FROM orders o
JOIN items    i ON i.order_id = o.id
JOIN payments p ON p.order_id = o.id
GROUP BY o.customer
ORDER BY o.customer;
```

```text
 customer | revenue | paid  | lines
----------+---------+-------+-------
 ana      |  100.00 | 50.00 |     3
 bo       |   80.00 | 80.00 |     1
```

Revenue and lines now look right, and `paid` is **50.00**. `ana` made two payments of
exactly 50.00, and `sum(DISTINCT amount)` adds each *distinct value* once. Two real
payments of the same size are, to `DISTINCT`, the same number. The revenue column only
looks right by coincidence. Give `ana` a second order that also totals 100.00 and it
collapses the same way. Even `count(DISTINCT i.sku)` would break the day someone orders
the same SKU on two lines. `DISTINCT` removes equal *values*. What you needed to remove was
duplicated *rows*, and rows are identified by keys, not by what they happen to contain.

### This is a famous bug, not a beginner's one

This exact problem is common enough that tools ship features against it:

- **Looker** calls it "fanout" and has a feature named *symmetric aggregates*. When a model
  declares a join as one-to-many, Looker rewrites `sum` so that each value is counted once
  per *primary key* rather than once per row. Its documentation describes it as on by
  default. It is the `DISTINCT` idea done properly, keyed on identity instead of value.
- **Entity Framework Core** documents it as *cartesian explosion*: loading a blog with
  both its posts and its tags in one query returns posts × tags rows. Its answer,
  `AsSplitQuery()`, sends one query per collection instead.
- **Hibernate** refuses outright. Ask it to fetch two list-type collections of one entity
  in one query and it throws `MultipleBagFetchException: cannot simultaneously fetch
  multiple bags`, because the result would be exactly the 3 × 2 table above.

Three ecosystems arrived at the same conclusion. Two independent one-to-many joins in one
query is almost never what anyone meant.

### Worth knowing: a one-line fan-out detector

Before trusting any join you are about to aggregate, compare the number of rows with the
number of distinct keys at the grain you meant:

```sql
SELECT count(*) AS rows, count(DISTINCT o.id) AS orders
FROM orders o
JOIN items    i ON i.order_id = o.id
JOIN payments p ON p.order_id = o.id;
```

```text
 rows | orders
------+--------
    7 |      2
```

If they differ, every `sum` over that join is suspect. And checking the assumption that a
relationship is one-to-one, rather than believing it, is a single query:

```sql
SELECT order_id, count(*) FROM payments GROUP BY order_id HAVING count(*) > 1;
```

```text
 order_id | count
----------+-------
        1 |     2
```

Somebody once said "each order has one payment", the schema never enforced it, and here
is the order that proves otherwise. If the relationship really must be one-to-one, a
`UNIQUE` constraint on `payments.order_id` would make the database refuse the second row,
and then it would be safe to rely on.

### Carry this

- A join repeats the "one" side once per match on the "many" side. Two independent
  "many" sides multiply.
- Decide the grain of the result first: what does one row mean?
- Aggregate each "many" table down to the report's grain *before* joining it.
- `count(DISTINCT key)` can repair a count. `sum(DISTINCT value)` cannot repair a sum.
- If a join's row count exceeds the distinct count of the keys you are reporting on, stop
  and look.

## Quiz

1. An order totalling 100.00 has three item rows. Why does
   `SELECT sum(o.total) FROM orders o JOIN items i ON i.order_id = o.id` count it as
   300.00?
2. One order has 3 items and 2 payments. When both tables are joined to it in one query,
   how many rows does that order become, and why?
3. Why is `sum(DISTINCT p.amount)` not a fix for an inflated payment total?
4. What does "the grain of a result" mean, and what rule about grain prevents fan-out?
5. How can `EXPLAIN ANALYZE` show you that a join has fanned out?

## Drill

1. Predict what a two-join report shows for an order with 2 items and 4 payments.
2. A `count(DISTINCT …)` repair looks correct. Find the case where it breaks.
3. Choose the queries that report a customer's total paid correctly.

## Task

Build the inflated report, show where each extra row came from, and fix it properly.

1. Start the file with the day's setup block from the lesson.
2. Write the per-customer report with `revenue`, `paid` and `lines` using two joins.
   Record the result and, for `ana`, the factor by which each column is wrong.
3. List the raw joined rows for order 1 and explain in a comment where the six came from.
4. Run `EXPLAIN (ANALYZE, COSTS OFF, TIMING OFF, SUMMARY OFF)` on it and record the row
   count at each join node.
5. Try the `sum(DISTINCT …)` version, record which number is wrong, and explain why.
6. Rewrite the report so it aggregates `items` and `payments` to one row per order before
   joining. Show that all three numbers match the truth.
7. Write the one-line fan-out detector (`count(*)` against `count(DISTINCT o.id)`) for the
   broken join, and the duplicate check on `payments.order_id`.

Record what each query printed as a comment beside it.

- File: `sql/day06.sql`
- Run: `psql -h localhost -U postgres -f sql/day06.sql`

### Checklist

- [ ] the two-join report run, with the wrong factor for each of `ana`'s three columns
      stated
- [ ] the six joined rows for order 1 listed, and their origin (items × payments)
      explained
- [ ] `EXPLAIN ANALYZE` row counts recorded at each join
- [ ] `sum(DISTINCT …)` tried, with the lost payment identified and explained
- [ ] a pre-aggregated version whose revenue, paid and lines all match the truth
- [ ] the fan-out detector and the duplicate-payment check, with their results
