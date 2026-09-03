# cpp-lab

A deliberate-practice curriculum for the layer underneath the C++ you already write:
sockets, concurrency, build systems, testing, CI. Not a tutorial collection — every
milestone produces something that runs, and you write all of it yourself.

**Who it's for.** You're comfortable in C++ and want the systems knowledge that usually
gets absorbed by osmosis, or never. You don't need prior socket, CMake or CI
experience; that's the point. Linux (or WSL/macOS) and a C++20 compiler are assumed.

**How it's structured.** Milestones live in `milestones/NN-name/`, each with a spec in
its `README.md` and a set of daily lessons in `lessons/`. A lesson is roughly 20–30
minutes: theory, a five-question quiz, a small coding task, and a teach-back where you
explain the mechanism back in your own words. A milestone is 4–6 hours spread over
those sessions, and ends with a code review and a teach-back.

Lessons are written a milestone at a time, so all of a milestone's days are available at
once; later milestones get written as the earlier ones land. `PROGRESS.md` is the running
log — what got done, and what was confusing.

## The app

The curriculum is also an installable PWA that serves one day at a time, tracks streaks
and progress, and syncs between devices through a private GitHub gist:

```bash
cd app
npm install
npm run dev        # http://localhost:5173
```

`app/README.md` covers deploying it to GitHub Pages and installing it on a phone.
The lesson files in `milestones/` are the source of truth — `npm run content` compiles
them into the app's JSON, so editing a lesson and rebuilding is all it takes to change
what the app serves.

The app also has an optional in-app mentor and an examiner that grades the teach-back,
both of which call a model API directly from the device with your own key (Gemini's free
tier or an Anthropic key — Settings explains the cost of each). It works without a key;
you just lose those two features.

## Operating rules

**On getting stuck:**
- Genuinely new territory → direct explanation up front, then build.
- Territory you already partly know → guiding questions first. Answers only after you're
  actually stuck, not after you're mildly uncomfortable.

**On AI use (this matters):**
The research on this is consistent: delegating the struggle to an assistant measurably
erodes exactly the skills this repo exists to build. The in-app mentor is built to
refuse the implementation for this reason. So:
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
