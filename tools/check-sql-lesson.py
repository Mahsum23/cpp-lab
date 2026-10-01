#!/usr/bin/env python3
"""
check-sql-lesson.py — run a SQL lesson the way a reader would, and check its outputs.

Every ```sql block in a lesson's Theory section is run in order, in one fresh database and
one psql session, exactly as someone following the lesson top to bottom would run it. Every
output block that directly follows a sql block (an unlabelled or ```text fence) must then
appear verbatim in what psql actually printed for that block, apart from trailing spaces and
psql's "file:line:" prefix on errors.

That is the rule from CLAUDE.md made mechanical: every output block in a lesson is real
output, and the lesson runs end to end for a stranger. It catches a snippet that references
a table the lesson never creates, an output pasted from a different state, and a number that
changed with a version upgrade.

Buffer counts (`shared hit=… read=…`) depend on what happens to be cached, so they are
compared as "some buffers" rather than as exact numbers. A lesson that quotes them should
give the reader an invariant to check instead.

Needs psql on the PATH and a server to talk to — the lessons' own setup is enough:
    docker run --rm -e POSTGRES_PASSWORD=x -p 5432:5432 postgres:16
    PGPASSWORD=x tools/check-sql-lesson.py milestones/sql-02-*/lessons/day-*.md

Each lesson file gets a scratch database of its own, dropped and recreated on every run.
"""
import os
import re
import subprocess
import sys
import tempfile

PSQL = ['psql', '-h', os.environ.get('PGHOST', 'localhost'), '-U', os.environ.get('PGUSER', 'postgres'), '-X', '-q']


def fences(md):
    theory = md.split('\n## Quiz')[0]
    return [(m.group(1).strip(), m.group(2)) for m in re.finditer(r'```([^\n]*)\n(.*?)```', theory, re.S)]


def norm(text):
    lines = [re.sub(r'^psql:[^:]*:\d+: ', '', line).rstrip() for line in text.splitlines()]
    lines = [re.sub(r'shared (hit=\d+)? ?(read=\d+)?', 'shared N', line) for line in lines]
    return [line for line in lines if line.strip()]


def check(path, db):
    blocks = fences(open(path).read())
    script, pairs = [], []
    for i, (lang, body) in enumerate(blocks):
        if lang.split(' ')[0] != 'sql':
            continue
        script.append(f'\\echo @@{i}@@\n{body}')
        nxt = blocks[i + 1] if i + 1 < len(blocks) else None
        if nxt and nxt[0] in ('', 'text'):
            pairs.append((i, nxt[1]))

    subprocess.run(PSQL + ['-c', f'DROP DATABASE IF EXISTS {db}', '-c', f'CREATE DATABASE {db}'],
                   capture_output=True, check=True)
    with tempfile.NamedTemporaryFile('w', suffix='.sql', delete=False) as f:
        f.write('\n'.join(script))
    run = subprocess.run(PSQL + ['-d', db, '-f', f.name], stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True)
    os.unlink(f.name)

    parts = re.split(r'^@@(\d+)@@\n', run.stdout, flags=re.M)
    printed = {int(parts[k]): parts[k + 1] for k in range(1, len(parts), 2)}

    problems = 0
    for i, expected in pairs:
        got, want = norm(printed.get(i, '')), norm(expected)
        if want and not any(got[j:j + len(want)] == want for j in range(len(got) - len(want) + 1)):
            problems += 1
            print(f'--- {path}: output after sql block {i} does not match\nexpected:\n'
                  + '\n'.join(want) + '\ngot:\n' + '\n'.join(got) + '\n')
    shown = {i for i, _ in pairs}
    for i, out in printed.items():
        if 'ERROR' in out and i not in shown:
            problems += 1
            print(f'--- {path}: sql block {i} errors, and the lesson shows no output for it:\n{out}')
    print(f'{os.path.basename(path)}: {len(pairs)} output blocks checked, {problems} problems')
    return problems


if __name__ == '__main__':
    if len(sys.argv) < 2:
        sys.exit(__doc__)
    total = sum(check(p, f'lesson_check_{n}') for n, p in enumerate(sys.argv[1:]))
    sys.exit(1 if total else 0)
