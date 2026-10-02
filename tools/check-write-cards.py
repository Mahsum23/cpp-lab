#!/usr/bin/env python3
"""
check-write-cards.py — run every "write it" card's reference answer on a real PostgreSQL.

The review deck judges a learner's query by running it, in a PostgreSQL compiled to
WebAssembly, and comparing rows with what the reference `solution` returns. That only
means something if the solution is right, so before a card ships its solution is run here,
on a real server, the way a stranger following the lesson would run it:

    docker run --rm -e POSTGRES_PASSWORD=x -p 5432:5432 postgres:16
    cd app && npm run content          # writes the JSON this reads
    PGPASSWORD=x tools/check-write-cards.py

For each challenge it builds a fresh database, runs `setup`, the `solution` and (if any)
`verify` statement by statement in one session, and takes the last statement that returned
rows as the answer — the same rule the in-browser engine applies. It fails on any error,
and on an answer with no rows, which makes a poor target. `--dump FILE` writes every
answer as JSON, which test-write.mjs compares with what the in-browser engine produces.
"""
import csv
import glob
import io
import json
import os
import re
import subprocess
import sys
import tempfile

import yaml

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PSQL = ['psql', '-h', os.environ.get('PGHOST', 'localhost'), '-U', os.environ.get('PGUSER', 'postgres'), '-X', '-q']
NULL = '␀'


def split_statements(sql):
    """Split a script on `;`, leaving quoted text and $$ bodies alone."""
    out, buf, i = [], '', 0
    while i < len(sql):
        c = sql[i]
        if c == "'":
            j = i + 1
            while j < len(sql) and not (sql[j] == "'" and sql[j + 1:j + 2] != "'"):
                j += 2 if sql[j] == "'" else 1
            buf += sql[i:j + 1]
            i = j + 1
            continue
        if sql.startswith('$$', i):
            j = sql.index('$$', i + 2) + 2
            buf += sql[i:j]
            i = j
            continue
        if sql.startswith('--', i):
            j = sql.find('\n', i)
            i = len(sql) if j == -1 else j
            continue
        if c == ';':
            if buf.strip():
                out.append(buf.strip())
            buf = ''
        else:
            buf += c
        i += 1
    if buf.strip():
        out.append(buf.strip())
    return out


def run(db, statements):
    """Run statements in one session; return (error, columns, rows) of the last that returned rows."""
    with tempfile.TemporaryDirectory() as tmp:
        lines = ['\\set ON_ERROR_STOP on', "SET timezone TO 'UTC';", f"\\pset null '{NULL}'", '\\pset footer off']
        for n, stmt in enumerate(statements):
            lines += [f'\\o {tmp}/{n}.out', stmt + ';', '\\o']
        script = os.path.join(tmp, 'run.sql')
        open(script, 'w').write('\n'.join(lines))
        r = subprocess.run(PSQL + ['--csv', '-d', db, '-f', script], capture_output=True, text=True)
        if r.returncode != 0:
            return (r.stderr.strip().splitlines() or ['psql failed'])[-1], None, None
        for n in range(len(statements) - 1, -1, -1):
            text = open(f'{tmp}/{n}.out').read()
            if text.strip():
                rows = list(csv.reader(io.StringIO(text)))
                return None, rows[0], [[None if v == NULL else v for v in row] for row in rows[1:]]
    return None, [], []


def authoring_extras():
    """`bad` examples live only in the source YAML (they are never shipped): day id -> card id -> list."""
    out = {}
    for topic in glob.glob(os.path.join(ROOT, 'milestones/*/lessons/topic.yaml')):
        meta = yaml.safe_load(open(topic)) or {}
        folder = os.path.dirname(topic)
        for d in meta.get('days', []):
            num = str(d['day']).zfill(2)
            for path in glob.glob(os.path.join(folder, f'day-{num}-*.write.yaml')) + glob.glob(os.path.join(folder, f'day-{num}-*.practice.yaml')):
                doc = yaml.safe_load(open(path)) or {}
                for c in (doc.get('challenges') or []) + (doc.get('write') or []):
                    if c.get('bad'):
                        out.setdefault(d['id'], {})[str(c['id'])] = c['bad']
    return out


def top_level_order_by(sql):
    """The same rule as isOrdered() in writecheck.ts: ORDER BY outside any parentheses, in the last statement."""
    last = [p for p in re.sub(r'--[^\n]*', ' ', sql).split(';') if p.strip()][-1]
    last = re.sub(r"'(?:[^']|'')*'", ' ', last)
    while True:
        flat = re.sub(r'\([^()]*\)', ' ', last)
        if flat == last:
            break
        last = flat
    return bool(re.search(r'\border\s+by\b', last, re.I))


def forbidden(sql, forbids):
    """The first forbid whose pattern the query hits (comments stripped, case-insensitive)."""
    text = re.sub(r'--[^\n]*', ' ', sql)
    for f in forbids or []:
        if re.search(f['match'], text, re.I):
            return f['say']
    return None


def main():
    dump = sys.argv[sys.argv.index('--dump') + 1] if '--dump' in sys.argv else None
    files = sorted(glob.glob(os.path.join(ROOT, 'app/public/content/weeks/*.json')))
    if not files:
        sys.exit('No content found. Run: cd app && npm run content')
    extras = authoring_extras()
    problems, answers, checked, bads = 0, {}, 0, 0
    for f in files:
        for day in json.load(open(f))['days']:
            sets = [day.get('write'), (day.get('practice') or {}).get('write')]
            for write in sets:
                # Go and C++ cards are judged by shape: app/scripts/check-shape-cards.mjs.
                if not write or write.get('lang', 'sql') != 'sql':
                    continue
                for c in write['challenges']:
                    checked += 1
                    db = f'write_check_{checked}'
                    label = f"{day['id']}/{c['id']}"

                    def answer(sql):
                        subprocess.run(PSQL + ['-c', f'DROP DATABASE IF EXISTS {db}', '-c', f'CREATE DATABASE {db}'],
                                       capture_output=True, check=True)
                        stmts = split_statements(write['setup']) + split_statements(sql)
                        # verify replaces the solution's rows as the answer, as it does in the app
                        if c.get('verify'):
                            stmts += split_statements(c['verify'])
                        return run(db, stmts)

                    err, cols, rows = answer(c['solution'])
                    hit = forbidden(c['solution'], c.get('forbids'))
                    if err:
                        problems += 1
                        print(f'  FAIL  {label}: {err}')
                        continue
                    if not rows:
                        problems += 1
                        print(f'  FAIL  {label}: the answer has no rows, so there is nothing to aim at')
                        continue
                    if hit:
                        problems += 1
                        print(f'  FAIL  {label}: the reference answer trips its own forbid: {hit}')
                        continue
                    answers[f"{day['id']}:{c['id']}"] = {'columns': cols, 'rows': rows}
                    shown = ' | '.join(','.join('NULL' if v is None else v for v in r) for r in rows[:3])
                    print(f"  ok    {label}: {len(rows)} row(s)  {shown[:90]}")
                    # The classic wrong answers must fail: an error, different rows, or a forbid.
                    for b in extras.get(day['id'], {}).get(str(c['id']), []):
                        bads += 1
                        if forbidden(b, c.get('forbids')):
                            continue
                        berr, bcols, brows = answer(b)
                        if berr:
                            continue
                        ordered = c.get('ordered')
                        if ordered is None:
                            ordered = top_level_order_by(c['verify'] or c['solution'])
                        same = (bcols is not None and len(bcols) == len(cols)) and (
                            brows == rows if ordered else sorted(map(str, brows)) == sorted(map(str, rows)))
                        if same:
                            problems += 1
                            print(f'  FAIL  {label}: a "bad" example passes: {" ".join(b.split())[:100]}')
    if dump:
        json.dump(answers, open(dump, 'w'), indent=1)
    print(f'\n{checked} challenge(s) checked, {bads} bad example(s) confirmed wrong, {problems} problem(s)')
    sys.exit(1 if problems else 0)


if __name__ == '__main__':
    main()
