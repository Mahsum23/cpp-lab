# cpp-lab

A deliberate-practice repo for going from mid-level to senior C++ engineer.
Not a tutorial collection. Every milestone produces something that runs.

## How this works

- Each milestone lives in `milestones/NN-name/` and has its own `README.md` with the task spec.
- Milestone specs are written **one at a time**, not all upfront — each one is calibrated
  based on how the previous one actually went.
- Within a milestone, all of its days are written up front, so progress never waits on
  asking for the next lesson. Pacing is the app's job (one session a day), not a
  side effect of which files happen to exist.
- Every milestone ends with two things: a code review, and a teach-back.
- `PROGRESS.md` is the log. Update it as you go.

## Operating rules

**On getting stuck:**
- Genuinely new territory → direct explanation up front, then build.
- Territory you already partly know → guiding questions first. Answers only after you're
  actually stuck, not after you're mildly uncomfortable.

**On AI use (this matters):**
The research is clear that delegating the struggle to an assistant measurably erodes
exactly the skills this repo exists to build. So:
- Write the first version yourself, always. Even if it's bad.
- Ask for concepts, API semantics, and "why does this behave this way" freely.
- Do NOT ask for the implementation before you've attempted it.
- If you paste code and ask "fix this", you've skipped the part that teaches you.

**Definition of done for a milestone:**
1. It compiles and runs.
2. You can explain every line you wrote without looking it up.
3. Code review passed.
4. Teach-back passed.

## Curriculum

### Phase 1 — Concurrency & Networking (weeks 1–4)
Goal: move from *using* async primitives to *understanding the execution model*.

- `01-raw-sockets` — Blocking TCP echo server + client. Plain POSIX sockets. No libraries.
- `02-asio-coroutines` — Rebuild it with Boost.Asio + C++20 coroutines.
- `03-concurrent-server` — Handle many clients at once. Where the real design problems live.
- `04-senders-writeup` — Explore `std::execution` (senders/receivers). Written comparison
  against the Asio model. The writeup *is* the deliverable.

### Phase 2 — Architecture (weeks 5–8)
Goal: practice structuring a nontrivial system, and living with your own decisions.

- `05-simulator-design` — Design doc **before** any code. Event-driven simulator.
- `06-simulator-core` — Build the simulation core. No I/O, no UI, testable in isolation.
- `07-simulator-io` — Add the boundary layer. Then compare against the design doc and
  write down where you were wrong. That comparison is the actual lesson.

### Phase 3 — Tooling (weeks 9–12)
Goal: the invisible skills. Starting from an empty directory, not from a refinement.

- `08-cmake-from-scratch` — What every line does. Built up, not copy-pasted.
- `09-testing` — Catch2 or GTest. Including the awkward part: testing async code.
- `10-sanitizers` — ASan / UBSan / TSan. TSan especially, given the concurrency work.
- `11-ci` — GitHub Actions. Clean clone → build → test → green.

### Ongoing
Modern C++ features get pulled in *where they naturally fit* — `std::expected`, ranges,
deducing `this` — not studied as a separate track.

## Build

Milestone 01 is deliberately built by hand with a single compiler invocation.
You'll build a real build system in Phase 3, and you'll appreciate why.
