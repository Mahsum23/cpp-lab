# Time is not a number

## Theory

A timestamp looks like a number with a funny format. It is not one. It sits on top of
time zones that governments redraw, a calendar whose months differ in length, days that
are 23 or 25 hours long twice a year, and a type name that says the opposite of what the
type does. Most time bugs are not exotic. They come from treating any of those as
simpler than it is.

```sql
DROP SCHEMA IF EXISTS day10 CASCADE;
CREATE SCHEMA day10;
SET search_path = day10;
SET timezone = 'UTC';

CREATE TABLE events (id int, at_tz timestamptz, at_naive timestamp);
INSERT INTO events VALUES (1, '2026-03-29 12:00:00+00', '2026-03-29 12:00:00');
SELECT at_tz, at_naive FROM events;
```

```text
         at_tz          |      at_naive
------------------------+---------------------
 2026-03-29 12:00:00+00 | 2026-03-29 12:00:00
```

### timestamptz stores an instant, and no time zone at all

PostgreSQL has two timestamp types, and their names mislead in both directions:

- `timestamp with time zone`, usually written `timestamptz`, stores **an instant**: one
  exact point on the world's timeline, internally a count of microseconds from a fixed
  reference point in UTC. It does **not** store a time zone. The zone in its name
  describes what happens on the way in and out.
- `timestamp without time zone` stores **a wall-clock reading**: a date and a time of day
  that mean nothing until somebody says *where*.

The output is where the difference becomes visible. A `timestamptz` is displayed in your
session's `TimeZone` setting, and a `timestamp` is displayed as it is:

```sql
SET timezone = 'Asia/Tashkent';
SELECT at_tz, at_naive FROM events;
```

```text
         at_tz          |      at_naive
------------------------+---------------------
 2026-03-29 17:00:00+05 | 2026-03-29 12:00:00
```

```sql
SET timezone = 'America/New_York';
SELECT at_tz, at_naive FROM events;
```

```text
         at_tz          |      at_naive
------------------------+---------------------
 2026-03-29 08:00:00-04 | 2026-03-29 12:00:00
```

Same stored row, read three times. `at_tz` is the same instant each time, shown as the
local time in each place: noon UTC is 17:00 in Tashkent and 08:00 in New York.
`at_naive` doesn't move, because it has no idea where it is. If you want proof that no
zone is stored anywhere, ask for the sizes:

```sql
SELECT pg_column_size(at_tz) AS tz_bytes, pg_column_size(at_naive) AS naive_bytes FROM events;
```

```text
 tz_bytes | naive_bytes
----------+-------------
        8 |           8
```

Eight bytes each: one 64-bit number, with no room for a zone name.

### The zone matters on the way in, too

A string without an offset, assigned to a `timestamptz`, is read **in the session's time
zone**. The same text therefore becomes a different instant depending on who inserts it.
The session is still in New York:

```sql
INSERT INTO events VALUES (2, '2026-03-29 12:00:00', '2026-03-29 12:00:00');
SET timezone = 'UTC';
SELECT id, at_tz, at_naive FROM events ORDER BY id;
```

```text
 id |         at_tz          |      at_naive
----+------------------------+---------------------
  1 | 2026-03-29 12:00:00+00 | 2026-03-29 12:00:00
  2 | 2026-03-29 16:00:00+00 | 2026-03-29 12:00:00
```

Both rows were inserted with the text `12:00`, and they are four hours apart. In
production this is the bug where a server, a container or a developer's laptop runs with a
different `TimeZone` and every timestamp it writes is shifted. The defences: send
timestamps with an explicit offset (`…12:00:00+00`, or ISO 8601 with `Z`), and keep your
servers' `TimeZone` at UTC.

### Which one to use

For **something that happened** (an order placed, a login, a log line), use `timestamptz`.
It is an instant, and `timestamptz` is the type for instants. Arithmetic and comparisons
are correct across zones, and every reader sees it in their own local time. The PostgreSQL
wiki's "Don't Do This" page puts it as plainly as anything there: don't use `timestamp`
(without time zone) to store instants.

`timestamp` is right for wall-clock values that are deliberately not instants, like "the
shop opens at 09:00", which is 09:00 in every branch whatever the zone.

The honest complication is **future** events. Jon Skeet, who maintains the Noda Time
library, wrote *Storing UTC is not a silver bullet* in 2019, as the EU debated abolishing
seasonal clock changes. His argument: a conference "at 09:00 in a European city next year",
stored as a UTC instant, becomes the wrong local time if the zone's rules change before it
happens, and rules change several times a year somewhere in the world. For future
local-time events he stores the local time *and* the zone name, and works out the instant
when it is needed. Past events are facts; future ones are intentions, and an intention
can be stored more faithfully than as an instant.

### AT TIME ZONE goes both ways

`AT TIME ZONE` converts between the two types. Applied to a `timestamptz` it answers
"what did the clock on the wall say *there*?", and returns a plain `timestamp`:

```sql
SELECT timestamptz '2026-03-29 12:00:00+00' AT TIME ZONE 'Asia/Tashkent' AS wall_clock,
       pg_typeof(timestamptz '2026-03-29 12:00:00+00' AT TIME ZONE 'Asia/Tashkent') AS type;
```

```text
     wall_clock      |            type
---------------------+-----------------------------
 2026-03-29 17:00:00 | timestamp without time zone
```

Applied to a plain `timestamp`, it does the reverse: "this wall-clock time, read in that
place, was which instant?", and returns a `timestamptz`. Same keywords, opposite types.
That is the most common way people get it backwards.

### Days are not always 24 hours

On 29 March 2026, Berlin's clocks jump from 02:00 straight to 03:00. 02:30 does not exist
there that day:

```sql
SET timezone = 'Europe/Berlin';
SELECT timestamptz '2026-03-29 02:30:00' AS nonexistent;
```

```text
      nonexistent
------------------------
 2026-03-29 03:30:00+02
```

Postgres did not error. It moved the time forward by the size of the gap, which is a
documented choice rather than a universal one, so other systems you exchange times with may
pick differently. The day as a whole is an hour short, and the two ways of saying "a day
later" now disagree:

```sql
SELECT timestamptz '2026-03-30 00:00' - timestamptz '2026-03-29 00:00' AS length_of_day,
       timestamptz '2026-03-29 01:00' + interval '1 day'    AS plus_1_day,
       timestamptz '2026-03-29 01:00' + interval '24 hours' AS plus_24_hours;
SET timezone = 'UTC';
```

```text
 length_of_day |       plus_1_day       |     plus_24_hours
---------------+------------------------+------------------------
 23:00:00      | 2026-03-30 01:00:00+02 | 2026-03-30 02:00:00+02
```

`interval '1 day'` means "same wall-clock time tomorrow". `interval '24 hours'` means
"86,400 seconds later". Usually identical, and on two days a year not. A daily job
scheduled with one when you meant the other fires an hour off for half the year.

### Months are not a fixed length either

```sql
SELECT date '2026-01-31' + interval '1 month'                    AS plus_one_month,
       date '2026-01-31' + interval '1 month' + interval '1 month' AS plus_one_twice,
       date '2026-01-31' + interval '2 months'                    AS plus_two_months;
```

```text
   plus_one_month    |   plus_one_twice    |   plus_two_months
---------------------+---------------------+---------------------
 2026-02-28 00:00:00 | 2026-03-28 00:00:00 | 2026-03-31 00:00:00
```

January 31st plus a month is February 28th, because February has no 31st, so Postgres
clamps to the last day of the month. Then adding one month twice is not the same as adding
two months once. A subscription that renews "every month" by adding a month to the
*previous renewal date* drifts from the 31st to the 28th and stays there. Compute each
renewal from the original start date.

Clamping is also why Postgres is safe in the case that took down Azure:

```sql
SELECT date '2024-02-29' + interval '1 year' AS leap_day_plus_a_year;
```

```text
 leap_day_plus_a_year
----------------------
 2025-02-28 00:00:00
```

On 29 February 2012, Microsoft Azure suffered a widespread outage. According to
Microsoft's own post-mortem, an agent that created certificates computed their expiry date
by taking the current date and adding one to the year. That produced 29 February 2013, a
date that does not exist, so certificate creation failed, the agents failed to start, and
the failures cascaded across clusters. Microsoft credited affected customers 33% of their
monthly bill. Building a date by editing its fields is exactly this:

```sql
SELECT date '2025-02-29';
```

```text
ERROR:  date/time field value out of range: "2025-02-29"
LINE 1: SELECT date '2025-02-29';
                    ^
```

Interval arithmetic knows about calendars. String surgery on a date does not.

### BETWEEN loses most of a day

```sql
CREATE TABLE logins (id int, at timestamptz);
INSERT INTO logins VALUES
  (1, '2026-06-01 09:00+00'),
  (2, '2026-06-07 23:59:59.5+00'),
  (3, '2026-06-08 00:00:00+00'),
  (4, '2026-06-08 10:00+00');
SELECT id FROM logins WHERE at BETWEEN '2026-06-01' AND '2026-06-07' ORDER BY id;
```

```text
 id
----
  1
```

"Logins in the first week of June" missed login 2, from June 7th. `BETWEEN` is inclusive
at both ends, and the date `'2026-06-07'` became the timestamp `2026-06-07 00:00:00`, so
everything after midnight on the 7th is outside the range: a whole day, gone. The obvious
patch makes it worse:

```sql
SELECT id FROM logins WHERE at BETWEEN '2026-06-01' AND '2026-06-08' ORDER BY id;
```

```text
 id
----
  1
  2
  3
```

Login 3, exactly at midnight on the 8th, is now in this week *and* will be in next week's
report as well. The fix is a **half-open range**, inclusive at the start and exclusive at
the end:

```sql
SELECT id FROM logins WHERE at >= '2026-06-01' AND at < '2026-06-08' ORDER BY id;
```

```text
 id
----
  1
  2
```

Half-open ranges tile perfectly: every instant belongs to exactly one week, with no gaps
and no overlaps, at any precision. The same "Don't Do This" page lists "don't use
`BETWEEN`, especially with timestamps" for exactly this reason.

### "Today" depends on who is asking

`date_trunc('day', …)` on a `timestamptz` cuts at midnight **in the session's time zone**:

```sql
SELECT date_trunc('day', timestamptz '2026-06-01 22:30+00') AS utc_day;
SET timezone = 'Asia/Tashkent';
SELECT date_trunc('day', timestamptz '2026-06-01 22:30+00') AS tashkent_day;
SELECT date_trunc('day', timestamptz '2026-06-01 22:30+00', 'UTC') AS pinned_to_utc;
SET timezone = 'UTC';
```

```text
        utc_day
------------------------
 2026-06-01 00:00:00+00
```

```text
      tashkent_day
------------------------
 2026-06-02 00:00:00+05
```

```text
     pinned_to_utc
------------------------
 2026-06-01 05:00:00+05
```

A purchase at 22:30 UTC belongs to June 1st by UTC and to June 2nd in Tashkent. A daily
revenue report grouped by `date_trunc('day', created_at)` gives different totals
depending on the time zone of the connection that ran it: the dashboard server, the
analyst's laptop, the cron job. Pass the zone explicitly as the third argument and the
answer stops depending on who asks.

### now() is frozen for the whole transaction

```sql
BEGIN;
SELECT pg_sleep(0.2);
SELECT now() = transaction_timestamp() AS now_is_transaction_start,
       now() = statement_timestamp()   AS now_is_statement_start;
COMMIT;
```

```text
 now_is_transaction_start | now_is_statement_start
--------------------------+------------------------
 t                        | f
```

`now()` is the time the transaction *began*, and it does not move until it ends. Every row
a long transaction inserts gets the same `now()`, which is usually what you want: one
logical moment for one unit of work. When you need the actual current time, for example to
measure how long something took, `clock_timestamp()` keeps ticking.

### Worth knowing: 'UTC+5' is five hours behind UTC

```sql
SELECT timestamptz '2026-06-01 12:00 UTC+5' AS posix_style,
       timestamptz '2026-06-01 12:00+05'    AS iso_style;
```

```text
      posix_style       |       iso_style
------------------------+------------------------
 2026-06-01 17:00:00+00 | 2026-06-01 07:00:00+00
```

Same digits, opposite answers, ten hours apart. `+05` is ISO 8601, where positive means
*east* of Greenwich: Tashkent's offset. `UTC+5` is read as a POSIX time-zone string, and
POSIX counts positive offsets *west* of Greenwich. That is the convention behind strings
like `EST5EDT`, where New York is "5". So `12:00 UTC+5` is 12:00 in a zone five hours
behind UTC, which is 17:00 UTC. Use zone names (`Asia/Tashkent`) or ISO offsets
(`+05:00`), and never write an offset as `UTC+n`.

### Carry this

- `timestamptz` stores an instant and no zone. The session's `TimeZone` decides how it is
  read in and displayed.
- Use `timestamptz` for things that happened. Send it with an explicit offset.
- `interval '1 day'` is not `interval '24 hours'`. Adding months clamps, and does not add
  up the way you expect.
- Use half-open ranges, `>= start AND < end`, never `BETWEEN`, for time.
- Pass the zone explicitly to `date_trunc` in anything that reports by day.

## Quiz

1. What does a `timestamptz` value actually store, and what does the session's `TimeZone`
   setting change about it?
2. The text `'2026-03-29 12:00:00'` is inserted into a `timestamptz` column from two
   sessions, one with `TimeZone` set to UTC and one set to `America/New_York`. Are the
   stored values the same?
3. Why does `WHERE at BETWEEN '2026-06-01' AND '2026-06-07'` miss most of June 7th, and
   what should be written instead?
4. On the day Berlin moves its clocks forward, what is the difference between adding
   `interval '1 day'` and adding `interval '24 hours'` to 01:00?
5. Why can a daily revenue report built on `date_trunc('day', created_at)` give different
   totals when run from different servers?

## Drill

1. Predict the result of adding one month to January 31st, twice.
2. A weekly report double-counts some events. Find which ones.
3. Choose the type for three columns: when a payment happened, a shop's daily opening
   time, and a webinar scheduled next year in a named city.

## Task

Make time lie four ways, then make each query honest.

1. Start the file with the day's setup block from the lesson.
2. Show one `timestamptz` row displayed in three time zones, next to a `timestamp` that
   doesn't change. Record `pg_column_size` for both.
3. Insert the same offset-less text under two different `TimeZone` settings, and record
   the gap between the two stored instants.
4. Reproduce the `BETWEEN` week losing a login, the "fix" that double-counts midnight, and
   the half-open range that is right.
5. Show `interval '1 day'` and `interval '24 hours'` disagreeing across a DST change, and
   `+ 1 month` twice disagreeing with `+ 2 months`.
6. Show `date_trunc('day', …)` returning different days under two time zones, then pin it
   with the third argument.

Record what each query printed as a comment beside it.

- File: `sql/day10.sql`
- Run: `psql -h localhost -U postgres -f sql/day10.sql`

### Checklist

- [ ] one `timestamptz` shown in three zones beside an unchanging `timestamp`, with both
      column sizes recorded
- [ ] the same text inserted under two `TimeZone` settings, with the resulting gap recorded
- [ ] `BETWEEN` shown losing a row and double-counting midnight, and a half-open range
      returning exactly the week
- [ ] `1 day` against `24 hours` across a DST change, and month arithmetic not adding up
- [ ] `date_trunc` giving two different days under two zones, then pinned with an explicit
      zone
