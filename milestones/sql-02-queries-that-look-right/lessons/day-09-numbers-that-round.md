# Numbers that round, truncate and overflow

## Theory

Numbers feel like the one part of SQL that cannot surprise you. The surprise is that
PostgreSQL has several kinds of number, each with its own rules for division, rounding and
running out of room, and the literal you type decides which one you get. Today: four small
experiments, each of which has cost somebody real money or a real outage.

```sql
DROP SCHEMA IF EXISTS day09 CASCADE;
CREATE SCHEMA day09;
SET search_path = day09;

CREATE TABLE visits (id int PRIMARY KEY, converted boolean NOT NULL);
INSERT INTO visits SELECT n, n % 8 = 0 FROM generate_series(1, 200) AS n;
```

200 visits, and every eighth one converted: 25 conversions, a 12.5% conversion rate.

### Integer division throws the remainder away

```sql
SELECT 1/2 AS a, 7/2 AS b, -7/2 AS c, -7 % 2 AS d, 7/2.0 AS e;
```

```text
 a | b | c  | d  |         e
---+---+----+----+--------------------
 0 | 3 | -3 | -1 | 3.5000000000000000
```

When both sides are integers, `/` is integer division: the fractional part is discarded,
and the result truncates *toward zero* (`-7/2` is `-3`). Python's `//` floors and gives
`-4`, so code ported between the two disagrees on negative numbers. Make either side
non-integer (`2.0`) and the whole expression becomes `numeric`.

That is a footnote until it is in a dashboard:

```sql
SELECT count(*) FILTER (WHERE converted) / count(*) * 100           AS rate_wrong,
       100 * count(*) FILTER (WHERE converted) / count(*)           AS rate_truncated,
       round(100.0 * count(*) FILTER (WHERE converted) / count(*), 2) AS rate_right
FROM visits;
```

```text
 rate_wrong | rate_truncated | rate_right
------------+----------------+------------
          0 |             12 |      12.50
```

`25 / 200` is 0 in integer arithmetic, and `0 * 100` is still 0. The first column is a
conversion rate of 0% that will stay 0% until conversions outnumber visits. It throws no
error, gives no warning, and draws a perfectly flat line on a chart. Moving the `100` to the
front gets 12, which is closer and still wrong, because the remainder is still discarded,
just later. Start the expression with `100.0`, or cast one side with `::numeric`.

(`count(*) FILTER (WHERE …)` counts only the rows that pass the condition. It is the clean
way to put several conditional counts in one row.)

Aggregates are more generous than operators: `avg` of integers returns `numeric` and `sum`
of `int` returns `bigint`, so the averaging function gets this right on its own.

```sql
SELECT avg(id), pg_typeof(avg(id)) AS avg_type, sum(id), pg_typeof(sum(id)) AS sum_type
FROM visits;
```

```text
         avg          | avg_type |  sum  | sum_type
----------------------+----------+-------+----------
 100.5000000000000000 | numeric  | 20100 | bigint
```

### Floating point: exact in binary, inexact in decimal

```sql
SELECT 0.1::float8 + 0.2::float8 AS float8_sum,
       0.1 + 0.2                 AS numeric_sum,
       0.1::float8 + 0.2::float8 = 0.3::float8 AS float8_equal,
       0.1 + 0.2 = 0.3           AS numeric_equal;
```

```text
     float8_sum      | numeric_sum | float8_equal | numeric_equal
---------------------+-------------+--------------+---------------
 0.30000000000000004 |         0.3 | f            | t
```

`float8` (`double precision`) stores a binary fraction. 0.1 has no finite binary
expansion, just as 1/3 has no finite decimal one, so what is stored is the nearest
representable neighbour, and the error shows up as soon as you add two of them. `numeric`
stores decimal digits and computes exactly, for anything you can write in decimal.

Notice what the second column did. **In Postgres, a literal like `0.1` is `numeric`**, not
float:

```sql
SELECT pg_typeof(0.1) AS literal, pg_typeof(0.1::float8) AS cast, pg_typeof(1e2) AS exponent;
```

```text
 literal |       cast       | exponent
---------+------------------+----------
 numeric | double precision | numeric
```

So a quick sanity check typed into `psql` can come out exact and convince you there is no
problem, while the `float8` column in your table behaves completely differently.
`WHERE price = 0.3` against a float column computes `0.1 + 0.2` the float way and does not
match:

```sql
CREATE TABLE m (v float8);
INSERT INTO m VALUES (0.1::float8 + 0.2::float8);
SELECT count(*) AS exact_match FROM m WHERE v = 0.3;
SELECT count(*) AS close_enough FROM m WHERE abs(v - 0.3) < 1e-9;
```

```text
 exact_match
-------------
           0
```

```text
 close_enough
--------------
            1
```

Never test floats for equality. Compare with a tolerance, or do not use floats for
anything you need to compare exactly.

### Errors that accumulate

One error of 4 × 10⁻¹⁷ is harmless. A million of them are not, and `real` (`float4`), with
half the precision, gets there much faster:

```sql
SELECT sum(0.1::float8) AS float8, sum(0.1::real) AS real, sum(0.1::numeric) AS numeric
FROM generate_series(1, 1000000);
```

```text
       float8       |   real    | numeric
--------------------+-----------+----------
 100000.00000133288 | 100958.34 | 100000.0
```

Adding 0.1 a million times in `real` gives **100,958**, nearly 1% too high. A `real` has a
24-bit significand, so above 2²⁴ = 16,777,216 it cannot even represent consecutive
integers:

```sql
SELECT 16777216::real + 1::real AS plus_one;
```

```text
   plus_one
---------------
 1.6777216e+07
```

Plus one, and nothing changed. Accumulated rounding error has a famous body count. On
25 February 1991 a Patriot missile battery at Dhahran, Saudi Arabia, failed to intercept an
incoming Scud, which struck a US Army barracks and killed 28 soldiers. The US General
Accounting Office's report (GAO/IMTEC-92-26) traced it to the system clock. Time was
counted in tenths of a second and multiplied by 1/10, held in a 24-bit fixed-point
register. 1/10 has no exact binary form, so the multiplier was chopped. After roughly 100
hours of continuous operation the chopped bits had added up to about 0.34 seconds of
drift. A Scud covers more than half a kilometre in that time, enough to put it outside
the window the system was looking in.

### numeric: exact, but it has rules too

`numeric` is decimal and arbitrary-precision, and for money it is the right type in
Postgres. It is exact for values you can write in decimal. It cannot write 1/3 any more
than you can:

```sql
SELECT 1 / 3::numeric AS third, 1 / 3::numeric * 3 AS back_again;
```

```text
         third          |       back_again
------------------------+------------------------
 0.33333333333333333333 | 0.99999999999999999999
```

And a declared scale is enforced **by rounding, silently**, on the way in:

```sql
CREATE TABLE prices (p numeric(10,2));
INSERT INTO prices VALUES (19.999), (0.005), (0.015);
SELECT p FROM prices;
```

```text
   p
-------
 20.00
  0.01
  0.02
```

No error and no warning: 19.999 was stored as 20.00. That is usually what you want for a
price column. It is a problem when the third decimal mattered, for example a per-unit
cost that gets multiplied later.

### Rounding is not one rule

Round 2.5 to an integer. The answer depends on the type:

```sql
SELECT round(2.5) AS numeric_25, round(3.5) AS numeric_35, round(-2.5) AS numeric_m25,
       round(2.5::float8) AS float8_25, round(3.5::float8) AS float8_35;
```

```text
 numeric_25 | numeric_35 | numeric_m25 | float8_25 | float8_35
------------+------------+-------------+-----------+-----------
          3 |          4 |          -3 |         2 |         4
```

`numeric` rounds half **away from zero**, the school rule. `float8` rounds half **to even**
(2.5 → 2, 3.5 → 4), the IEEE 754 default, sometimes called banker's rounding, because it
does not drift upward when you round many values. Casting follows the same split:

```sql
SELECT 2.5::int AS from_numeric, 2.5::float8::int AS from_float8;
```

```text
 from_numeric | from_float8
--------------+-------------
            3 |           2
```

The same 2.5 becomes 3 or 2, depending on a type you may never have chosen consciously.

And then there is not rounding at all. `trunc` drops digits, `round` rounds them:

```sql
SELECT trunc(1.23456, 3) AS truncated, round(1.23456, 3) AS rounded;
```

```text
 truncated | rounded
-----------+---------
     1.234 |   1.235
```

In 1982 the Vancouver Stock Exchange launched an index at 1000.000. It was recomputed
thousands of times a day and each result was *truncated* to three decimals, not rounded,
so every recomputation lost a fraction of a point and none ever gained one. By November
1983 the index stood at about 524.8, nearly half its starting value, while the market
underneath had been rising. Recomputed with the lost fractions restored, it came to about
1098.9. Each error was smaller than a thousandth of a point. There were simply millions
of them, and they all pointed the same way.

### Overflow is an error, which is a gift

```sql
SELECT 2147483647 + 1;
```

```text
ERROR:  integer out of range
```

```sql
SELECT 2147483647::bigint + 1 AS fine;
```

```text
    fine
------------
 2147483648
```

Unlike C, where signed overflow is undefined behaviour, Postgres refuses. The error is
loud, and loudness is good, but it does not help when the integer is a primary key and
the error arrives at the 2,147,483,648th insert. On 8 November 2018 Basecamp 3 went
read-only for about five hours. Its busy `events` table had an `int` id column, which ran
out at 2,147,483,647. Ruby on Rails had already switched its default primary keys to
`bigint` in version 5.1, but that table was older than the change. Use `bigint` for ids.
The 4 extra bytes per row are cheaper than one bad morning.

### Money

The community-maintained "Don't Do This" page on the PostgreSQL wiki says plainly: don't
use the `money` type. Its output depends on
the server's `lc_monetary` locale setting, and it stores a fixed number of fractional
digits for every currency.

```sql
SELECT 12.345::money AS money;
```

```text
 money
--------
 $12.35
```

There are two respected answers instead, and you will meet both. Store `numeric` with an
explicit scale and keep the currency in its own column. Or store an integer count of
the currency's smallest unit, which is what Stripe's API does: amounts are integers in
cents for USD, and in whole yen for JPY, a currency with no minor unit. Either works.
`float8` for money does not, for every reason above.

### Worth knowing: in Postgres, NaN equals NaN

IEEE 754 says Not-a-Number is unequal to everything, including itself. Postgres
deliberately breaks that rule:

```sql
SELECT 'NaN'::float8 = 'NaN'::float8 AS nan_equals_nan,
       'NaN'::float8 > 1e308          AS nan_beats_everything;
```

```text
 nan_equals_nan | nan_beats_everything
----------------+----------------------
 t              | t
```

A B-tree needs every value to be equal to itself and comparable with every other value,
or it cannot sort them, and a `float8` column could never be indexed. So Postgres treats
all NaNs as equal and sorts them above every other number, including infinity. It is a
small, documented departure from a standard, made so that indexes keep working.

### Carry this

- `int / int` is integer division. For a ratio, start with `100.0 *` or cast a side to
  `numeric`.
- A literal `0.1` is `numeric`. Test with the column's real type before trusting a result.
- Never compare floats with `=`. Never store money in floats.
- `numeric(p,s)` rounds silently on insert. `round` on `numeric` is half away from zero;
  on `float8` it is half to even.
- Primary keys are `bigint`.

## Quiz

1. Why does `count(*) FILTER (WHERE converted) / count(*) * 100` return 0 for a 12.5%
   conversion rate, and how do you fix it?
2. Why is `0.1::float8 + 0.2::float8 = 0.3` false in PostgreSQL while `0.1 + 0.2 = 0.3`
   is true?
3. You insert 19.999 into a `numeric(10,2)` column. What is stored, and does anything
   warn you?
4. What do `round(2.5)` and `round(2.5::float8)` return in PostgreSQL, and why do they
   differ?
5. Which type would you use for an amount of money in PostgreSQL, and why not `float8` or
   `money`?

## Drill

1. Predict the result of an average computed by hand with integer columns.
2. A test of a float column passes in `psql` and fails in production. Find why.
3. Choose the right type for three columns: an order total, a sensor reading, and a
   primary key on a busy table.

## Task

Reproduce each numeric trap, then write the version that cannot fall into it.

1. Start the file with the day's setup block from the lesson.
2. Compute the conversion rate three ways (integer, integer with the 100 moved, and
   numeric) and record all three results.
3. Show `0.1 + 0.2` as `numeric` and as `float8`, and a `WHERE v = 0.3` on a `float8`
   column failing to match. Fix it with a tolerance.
4. Sum 0.1 a million times as `float8`, `real` and `numeric`, and record how far each one
   is from 100,000.
5. Show `round(2.5)` and `round(2.5::float8)` disagreeing, and `numeric(10,2)` silently
   rounding 19.999.
6. Trigger `integer out of range`, and show the same arithmetic succeeding as `bigint`.

Record what each query printed as a comment beside it.

- File: `sql/day09.sql`
- Run: `psql -h localhost -U postgres -f sql/day09.sql`

### Checklist

- [ ] the conversion rate computed as integer, as integer with the 100 first, and as
      numeric, with all three results recorded
- [ ] `0.1 + 0.2` compared as `numeric` and as `float8`, and a float equality match failing
      then fixed with a tolerance
- [ ] the million-fold sum recorded for `float8`, `real` and `numeric`
- [ ] `round(2.5)` against `round(2.5::float8)`, and `numeric(10,2)` rounding 19.999 on
      insert
- [ ] `integer out of range` triggered, and the same arithmetic succeeding as `bigint`
