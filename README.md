# slowpath

A deliberate-practice curriculum for the layer underneath the code you already write:
the sockets under your networking library, the pages and tuples under your SQL, the
runtime under your goroutines. Short daily sessions, a phone app that carries them, and
one rule that shapes everything else: **understanding should be fast; writing the
solution should stay slow.**

The name comes from that rule, and from the kernel. A *fast path* handles the common case
cheaply and hands anything hard to the *slow path*, which does the real work. Here,
explanations, API semantics and "why does it behave like that" are the fast path — ask
freely, get answers straight. The code you write is the slow path. Nobody writes it for
you, because that is the part that actually changes what you can do.

## Tracks

| Track | Milestone available now | For |
|---|---|---|
| **C++ systems** | `01-raw-sockets` — 8 days | You write C++ but have never opened a socket, set up CMake or CI by hand |
| **PostgreSQL** | `sql-01-what-the-database-does` — 3 days | You write SQL that works but have never looked at what the engine does with it |
| **Go** | `go-01-from-zero` — 6 days | You can program, and know nothing about Go yet |

Each milestone lives in `milestones/<name>/`: a spec in its `README.md` and the daily
lessons in `lessons/`. Milestones are written one at a time — all of a milestone's days
exist up front, and the next milestone is written once the current one lands, so it can
be calibrated against how the last one went.

## A day

About 25 minutes, in five steps:

1. **Theory.** One concept, grounded: what the thing actually *is*, what problem it
   exists to solve, whether the world still does it this way — and at least one thing
   you can go and see for yourself (`/proc/<pid>/fd`, `ss -tan`, `pageinspect`).
2. **Quiz.** Five questions. Every wrong option is a misconception someone really holds,
   and each one says why it is wrong.
3. **Drill.** Two to four exercises you can do on a phone — predict the output, find the
   bug, choose the right call. The day is done when the drill is done, so a day away from
   a computer is still a real day. *(The Go days have drills; the C++ and SQL drills are
   still being written.)*
4. **Task.** A small piece of code that needs a machine. It waits in a queue until you are
   at one — see `./lab` below.
5. **Teach-back.** Explain the day's mechanism in your own words to an examiner, which
   probes the weakest part of your answer and rules `solid` or `gaps`. It never gives
   the answer away: that would hand over the exact thing being measured.

Finished days feed a spaced-repetition deck: quiz questions, code blocks to put back in
order, the teach-back question again weeks later, and fresh challenges written from the
day's material.

## The app

The curriculum is also an installable PWA that serves one day at a time, keeps streaks
and the review deck, and syncs between devices through a private GitHub gist:

```bash
cd app
npm install
npm run dev        # http://localhost:5173
```

`app/README.md` covers deploying it to GitHub Pages and installing it on a phone. The
lesson files in `milestones/` are the source of truth — `npm run content` compiles them
into the app's JSON, so editing a lesson and rebuilding is all it takes to change what
the app serves.

The mentor chat, the teach-back examiner and the fresh review challenges call a model
API straight from your device with your own key — Gemini's free tier or an Anthropic
key; Settings explains the cost of each. Everything else works without a key.

## Doing a task: `./lab`

The expensive part of a task was never the coding. It was working out which day you were
on, remembering what it asked, making a directory, making a file, and remembering the run
command — five small frictions, each one a chance to decide not to bother.

```
./lab                  open the current day: scaffold its files, print its checklist
./lab check            run that day's build/run command
./lab done             mark it finished, so the next ./lab moves on
./lab list             where you are across every track
./lab --day sql-day-02 jump to any day
```

`./lab` creates the file at exactly the path the lesson names, with the checklist in a
comment header and a skeleton that already compiles, and never overwrites anything.

It works offline with nothing installed. Which day you are on comes from the progress the
app syncs, when `LAB_TOKEN` (a GitHub token with gists scope) is in your environment;
otherwise from a local `.lab/state.json` that `./lab done` advances. It always tells you
which source it used, so it is never quietly wrong.

## What you need

- **C++:** Linux, WSL or macOS, and a C++20 compiler. Milestone 01 is built with a single
  compiler invocation on purpose — you build a real build system later, and appreciate
  why.
- **PostgreSQL:** Docker. The whole setup is
  `docker run --rm -e POSTGRES_PASSWORD=x -p 5432:5432 postgres:16` and a `psql` prompt.
- **Go:** the Go toolchain and nothing else. Every exercise is one file run with
  `go run` — no modules, no dependencies.

## Operating rules

**On getting stuck:**
- Genuinely new territory → direct explanation up front, then build.
- Territory you already partly know → guiding questions first. Answers only after you're
  actually stuck, not after you're mildly uncomfortable.

**On AI use (this matters):**
The research on this is consistent: delegating the struggle to an assistant measurably
erodes exactly the skills this repo exists to build. The in-app mentor will explain
anything and refuses to write the task, for this reason. So:
- Write the first version yourself, always. Even if it's bad.
- Ask for concepts, API semantics, and "why does this behave this way" freely.
- Do NOT ask for the implementation before you've attempted it.
- If you paste code and ask "fix this", you've skipped the part that teaches you.

**Definition of done for a milestone:**
1. It compiles and runs.
2. You can explain every line you wrote without looking it up.
3. Code review passed.
4. Teach-back passed.

## The C++ track, in full

The other two tracks are planned a milestone at a time. The C++ track has a longer arc.

### Phase 1 — Concurrency & Networking
Goal: move from *using* async primitives to *understanding the execution model*.

- `01-raw-sockets` — Blocking TCP echo server + client. Plain POSIX sockets. No libraries.
- `02-asio-coroutines` — Rebuild it with Boost.Asio + C++20 coroutines.
- `03-concurrent-server` — Handle many clients at once. Where the real design problems live.
- `04-senders-writeup` — Explore `std::execution` (senders/receivers). Written comparison
  against the Asio model. The writeup *is* the deliverable.

### Phase 2 — Architecture
Goal: practice structuring a nontrivial system, and living with your own decisions.

- `05-simulator-design` — Design doc **before** any code. Event-driven simulator.
- `06-simulator-core` — Build the simulation core. No I/O, no UI, testable in isolation.
- `07-simulator-io` — Add the boundary layer. Then compare against the design doc and
  write down where you were wrong. That comparison is the actual lesson.

### Phase 3 — Tooling
Goal: the invisible skills. Starting from an empty directory, not from a refinement.

- `08-cmake-from-scratch` — What every line does. Built up, not copy-pasted.
- `09-testing` — Catch2 or GTest. Including the awkward part: testing async code.
- `10-sanitizers` — ASan / UBSan / TSan. TSan especially, given the concurrency work.
- `11-ci` — GitHub Actions. Clean clone → build → test → green.

Modern C++ features get pulled in *where they naturally fit* — `std::expected`, ranges,
deducing `this` — not studied as a separate track.

## Layout

```
milestones/<name>/README.md     a milestone's spec
milestones/<name>/lessons/      one .md per day, plus its .quiz.yaml, .drill.yaml, week.yaml
app/                            the PWA (Svelte), built from the lesson files
tools/lab.mjs, ./lab            the task launcher
PROGRESS.md                     the running log: what got done, and what was confusing
```
