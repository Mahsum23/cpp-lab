# Progress Log

Format: what you built, what broke, what you learned that wasn't in the spec.
The third column is the valuable one. Be honest in it.

| Milestone | Started | Done | Review | Teach-back | Notes |
|---|---|---|---|---|---|
| 01-raw-sockets | 2026-09-01 | | | | Day 2/8 in progress (see log) |

## Log

### 01-raw-sockets

**Day 1 — a socket is a file descriptor (2026-09-01):**
- Theory covered: socket = kernel-side object, the `int` is just a handle/ticket into
  the fd table; `socket(AF_INET, SOCK_STREAM, 0)` args; `-1`+`errno` failure pattern;
  still how everything (Asio/Go/Node) works underneath today.
- Quiz: 3/3 (failure-return vs valid fd; what's missing before bind/listen/connect;
  SOCK_DGRAM = UDP guarantees).
- Task attempted: `src/main.cpp` calls `socket()`, checks it, prints the fd. Compiles
  clean under `-Wall -Wextra`, prints `fd = 3`.
- **Code review — pending fixes (not yet applied):**
  1. Never calls `close(fd)` — the task's other half; build the open/close-pairing
     habit now.
  2. Failure branch prints the error but still falls off `main()` returning 0 — a
     shell checking `$?` would see success. Needs a non-zero exit on failure.
- Next session (after the fix): Day 2 — addresses and byte order.

_(write here as you go — what you tried, what confused you, what you got wrong)_

**Side track — the phone app (2026-09-01):** built. Installable PWA in `app/` that
delivers this curriculum a day at a time: Today screen, Theory → Quiz → Task player,
week map, streak/XP/badges, offline, light + dark. The five open decisions in
`app/DESIGN.md` §11 are settled and the doc is locked — PWA (no Mac, so native was
never really an option), Svelte, gamification as designed, chat held to v2, and lessons
authored as `.md` + `.quiz.yaml` compiled into the app's JSON.

Day 1 is loaded; Days 2–8 show as locked steps on the map and fill in as they're
written. Deploy: push to `main` → GitHub Actions → Pages → open in **Safari** → Share →
Add to Home Screen. (Needs a one-time repo setting: Settings → Pages → Source: GitHub
Actions.)

This is Claude's build, not practice; it doesn't replace writing C++. The Task screen
is a briefing — `src/main.cpp` still gets written on the laptop.

**Side track — app v2 (2026-09-02):** sync, mentor chat, and a quiz-content fix.

- **Sync.** Passing JSON between devices was too much friction to survive as a daily
  habit. Progress now lives in a **secret GitHub gist**, written straight from the
  phone with a fine-grained token scoped to Gists only. Telegram was considered on
  request and rejected: its bots can't read their own chat history, so restoring onto
  a wiped phone has no clean path. Two devices **merge** rather than overwrite — see
  `app/DESIGN.md` §8.5 for what happens to XP (derived from the day records) and the
  streak (chosen, never max'd, so a phone in a drawer can't resurrect a broken run).
  Setup is in `app/README.md`.
- **Mentor chat.** Fifth tab. Carries this repo's persona and prime directive plus
  today's theory and task, so it answers in context and still refuses to write the
  milestone code. Anthropic key pasted in Settings, on-device only; Haiku/Sonnet/Opus
  switchable. It's the one part of the app that costs money.
- **Quiz content.** Every correct answer was option A, because that's how you author a
  key. `build-content.mjs` now shuffles deterministically per question, so authoring
  order carries no information. Day 1 also gained two questions (fd exhaustion; what
  Asio actually does over `recv()`), making it 5.
- Verified end to end in a phone-sized browser with the GitHub and Anthropic APIs
  stubbed: 24 UI checks, plus streak/merge/markdown unit tests. Three bugs found and
  fixed on the way, one of them a self-retriggering Svelte effect that reloaded the
  chat thread hundreds of times a second and ate the message being sent.

**Mentor: Gemini added as the default provider (2026-09-02).** Shipping Anthropic-only
was wrong — the API is prepaid and separate from a Claude subscription, so "paste a
key" hit a $0 balance. The mentor is now provider-agnostic with Google's free tier as
the default and Claude as a switch. Gemini's model list is fetched from the API rather
than hardcoded, because Google retires model names faster than this repo gets touched;
a stored choice that disappears heals itself to a working one. `scripts/test-mentor.mjs`
asserts both wire formats, since every difference between them fails as a runtime 400.

**Once sync is on, the phone is usually the more current record.** If this file and
the app disagree about what's done, this file is the one that's behind.

**Mentor: the Gemini tab never actually worked, and here is why (2026-09-02).** Three
separate faults stacked on top of each other, which is why it looked so mysterious.

1. **The SSE parser could not read a single real Gemini frame.** It split frames on
   `"\n\n"`, but `generativelanguage.googleapis.com` separates them with `"\r\n\r\n"`,
   and `"\r\n\r\n".split("\n\n")` matches nothing. Every frame therefore accumulated in
   the buffer instead of being emitted, and the whole response was discarded at end of
   stream — no text, no error, cursor blinking forever. Deterministic, not flaky: it
   had never worked against the real API. The unit tests passed throughout because the
   stub framed its fake stream with `"\n\n"`, so the suite was testing a stream shape
   that does not exist in production. Anthropic really does send `"\n\n"`, which is why
   only Gemini broke. Both framings are legal per the SSE spec; the parser now handles
   CRLF, LF and CR, and no longer drops a final frame that arrives without a trailing
   blank line.
2. **The app auto-selected a retired model.** Both seeds (`gemini-2.5-flash`,
   `gemini-2.5-pro`) now 404 with "no longer available to new users", and the sort put
   the retired `gemini-2.5-flash` first, so the self-heal chose it. Retired models stay
   in `models.list` looking perfectly healthy — nothing in the metadata marks them —
   so the "is it still in the list?" heal could never catch this. Seeds are now the
   `-latest` aliases, which track whatever Google currently ships, and ranking prefers
   aliases, then newer generations, Flash over Pro (Pro's free-tier quota is spent in a
   few questions). A 404 is now typed as `ModelGoneError` and retires the stored model,
   since that is the only reliable evidence a model is dead.
3. **The 404 copy blamed the wrong thing.** Google's 404 body names the replacement
   model outright; the handler was throwing that away and paraphrasing it into a guess
   about API-key types. It passes Google's own words through now.

Verified against the live API with a real key, not stubs: `listModels` ranks
`gemini-flash-latest` first, and a real question streams back a real answer. Also note
Google intermittently 503s its newest models (`-latest`, `3.8`) while older ones serve
fine; that path is transient and already reported as such.

**Day 2 written (2026-09-02): addresses and byte order.** `sockaddr_in`, why
`sin_zero` exists (padding to match the generic `sockaddr` bind()/connect()/accept()
actually take — C's answer to polymorphism without inheritance), why network byte
order is a fixed convention rather than "whatever the CPU prefers," and the classic
footgun where `htons()` is a no-op on a big-endian machine so a missing conversion can
pass testing on the wrong architecture. Task has him dump a filled `sockaddr_in`
byte-by-byte and find `9000`'s two bytes (`23 28`) sitting in the struct by hand, plus
a two-line host-endianness check. Verified the reference program compiles clean under
`-Wall -Wextra` and every claim in the lesson against its actual output before writing
it down.

**Days 3-8 written, and the pacing rule changed (2026-09-02).** Lessons are no longer
written one per request: every day of a milestone now lands up front, because being
blocked on asking for the next lesson is friction the app exists to remove. Milestone
*specs* are still written one at a time — the calibration worth keeping is between
milestones, not between days whose shape the milestone README already fixed.

This also fixes the "Unlock days ahead" / "Let me jump ahead" toggles, which appeared
broken. They weren't: `stateOf()` returns `upcoming` for any day without a lesson file
*before* it consults `peekAhead`, and with only two days written there was never a
single day in the `locked` state for the toggle to act on. Six days now flip between
locked and unlocked.

Day 3 was corrected against measured behaviour rather than folklore, and the folklore
was wrong twice. "Start the server, kill it, restart it, and bind fails" does not
reproduce `EADDRINUSE` at all — a listener with no connections through it releases its
port immediately. It needs a connection the server closed. And `SO_REUSEADDR` alone
doesn't fix it either: on Linux both the lingering `TIME_WAIT` socket and the new one
need the flag, and the accepted socket inherits it from the listener, so the flag only
takes effect from the *next* run onward. Verified with a controlled A/B — first server
without the option, restart with it: still refused; first server with it: binds
immediately. The naive lesson would have had him add the option, still fail, and
conclude the material was broken. `MSG_PEEK` returning identical bytes twice and
`SIGPIPE` killing a process with exit status 141 were both verified on the box too.

**Made the shipped content public-facing (2026-09-03).** The curriculum and the app are
something anyone can clone and install, so nothing shipped assumes one particular
reader's job any more. The app's mentor and examiner prompts hard-coded a conveyor
control system, Boost and Qt6, and told the model to skip the coroutine mental model —
wrong for any other user, and silently so. Both now describe the audience instead: a
developer fluent in C++ and new to the layer underneath it, with an instruction to
calibrate if the learner volunteers their background. Milestone 01's "you already await
async I/O at work" opening, which was in three places, is gone the same way.

CLAUDE.md and PROGRESS.md stay personal — they're the private half, and CLAUDE.md now
records the boundary explicitly so lessons don't drift back into being addressed to one
person.

Also applied Day 2's signature rule to the rest of the week: every function a lesson
teaches now shows its real declaration alongside a snippet calling it — socket, close,
strerror, fcntl, bind, listen, setsockopt, accept, accept4, inet_ntop, recv, send,
signal, connect, inet_pton, shutdown. Verified the lot compiles clean under
`-Wall -Wextra` rather than trusting it by eye, which also confirmed inet_pton's
return-value trap (1 on success, so a `< 0` check silently accepts malformed input).

**Day 8 thickened, experiments added to 5-7, and the OAuth question answered
(2026-09-03).** Day 8's strace listing was fabricated and wrong: it showed `close(4)`
under `-e trace=network`, but `close` isn't a network syscall so that filter never
prints it. Replaced with a real capture, which also shows `recv`/`send` appearing as
`recvfrom`/`sendto` (the plain names are library wrappers passing NULL for the address
args). Added `strace -T`, where a real run shows `accept(3, NULL, NULL) = 4 <1.997963>`
against `recvfrom` at 28 microseconds — Day 4's "blocking is a sleep, not a spin" as a
measurement. Added `strace -c` and a `/proc/net/tcp` decoding table.

The best find was an experiment that carries Days 5 and 6 at once: send 200,000 bytes to
a server that accepts and never reads. The server's rx_queue holds 0x1E800 (124,928) and
the client's tx_queue holds 0x12540 (75,072) — which sum to exactly 200,000. Every byte
is in one kernel queue or the other and none of it has reached application code. Day 5
gets the receive half, Day 6 the backpressure half, Day 8 the arithmetic.

Day 6's backpressure experiment was corrected after running it: with the peer frozen the
server's send queue reached ~3 MB, but no short write appeared, because a **blocking**
socket's `send()` blocks rather than returning partial. The lesson now says so instead of
promising a short write that won't show up.

**Google login for Gemini: no, and worth writing down why.** Three independent blockers.
generateContent on the free Gemini Developer API authenticates by API key; OAuth on that
host is scoped to tuned models and semantic retrieval. The endpoint that does take OAuth
for generation is Vertex AI, which needs a billed Cloud project. And Google OAuth needs
pre-registered redirect URIs, so a static self-hosted app would make every user register
their own OAuth client — more work than an API key, not less. A real "sign in with
Google" needs a hosted backend (Firebase AI Logic is built for it) where the operator
pays everyone's token bill. Documented in app/README.md. What *was* possible: pasted
keys are now normalised, since a phone paste arrives with newlines, smart quotes or a
`GEMINI_API_KEY=` prefix, all of which 400 and read as "my key is wrong".

**Mentor reachable from the theory screen (2026-09-04).** Asking a question used to mean
leaving the lesson for the Mentor tab and losing your place mid-paragraph. There's now a
floating "Ask" pill on the Theory step that opens a bottom sheet with the mentor in it.

The design decision worth recording: the sheet drives the *same* `chat` store and the
same per-day thread key the Mentor tab uses, rather than owning its own conversation. A
question asked while reading is the same thread you find later under Mentor — no second
transcript that quietly disagrees with the first. Verified end to end in a real browser:
saved a key through the Settings UI, tapped a starter on Day 1, watched the reply stream
into the sheet, then opened the Mentor tab and found the same exchange there.

The sheet is capped at 70vh rather than filling the screen, because the question is
usually about the paragraph you were just reading and you want to be able to refer back
to it.

**Mentor on the task screen too (2026-09-04).** Same sheet, same per-day thread — a
question asked mid-attempt is the same conversation as one asked while reading the
theory, verified by asking from the Task step and finding it in the Theory step's sheet.

The starters needed a new mode to be worth anything here. "I'm stuck. Here's what I
tried:" auto-sent is useless, so `MentorSheet` now takes starters as
`{ text, send }` and a `send: false` one drops the text into the composer with the
cursor after it instead of firing. Marked with a ✎ so the difference is visible before
you tap. None of the three ask for the implementation — the mentor refuses that anyway,
and a starter that invited it would teach the wrong habit.

**Sync was broken on any device adopting an existing gist (2026-09-04).** Paste a token
on a second device and it reported "Synced just now" while showing none of the other
device's progress. Three linked faults:

1. `syncNow()`'s re-entrancy guard read `cloud.status === 'syncing'` — *display* state
   the caller sets. `connectCloud()` set status to 'syncing' and then called
   `syncNow()`, which saw its own caller's flag and returned instantly having done
   nothing. **Adopting an existing gist never pulled.** A/B confirmed in a browser: the
   old code made exactly one GitHub call (`GET /gists?per_page=100`) and never fetched
   the gist; the fix makes list → pull → push and carries the merged day through.
2. Status then stayed 'syncing' forever in the adopted branch (only the *created*
   branch set 'ok'), so every later `syncNow()` hit the same guard. Sync stayed dead
   until a reload, which is why it appeared to fix itself.
3. Worst: `pushNow()` had no such guard, so a device that had never pulled would PATCH
   its blank progress over a populated gist and then report success — data loss
   presented as "Synced just now".

Guard is now a private `syncing` flag (re-entrancy is a property of the object, not of
what the UI is showing), and a `reconciled` flag blocks pushing until this device has
merged the remote at least once. A device that creates the gist is authoritative from
the start; one that adopts is not.

Worth noting why this shipped: `test-merge.mjs` covers the pure merge function
thoroughly, and nothing at all covered the orchestration around it.

**Code mode in the mentor composer (2026-09-04).** Pasting C++ for review used to arrive
as a paragraph: proportional font, indentation reflowed away, and the phone keyboard
capitalising `int` and "correcting" `->` on the way in.

Both composers (Mentor tab and the in-lesson sheet) now carry `autocomplete`,
`autocapitalize` and `autocorrect` off unconditionally — those actively corrupt source —
and a `</>` toggle for code mode. In code mode the field is monospace with `white-space:
pre`, Tab indents four spaces instead of leaving the field (multi-line selections indent
every line), spellcheck is off, and the message is fenced as ```cpp on the way out. The
fence does double duty: the model is told it's source rather than guessing, and the
transcript renders it through the existing highlighter instead of reflowing it.

Code mode auto-enables on a paste that looks like source, since that's the actual moment
of use. The heuristic is deliberately conservative — a single line is never code, so
"why does recv() return 0?" stays a question. Its first version missed flush-left C++
whose only signal is lines ending in `;` (exactly what the Day 2 task produces), caught
by a test rather than in use.

Logic lives in `lib/compose.ts` rather than inside the components, because there are two
composers and because logic that only exists in a `.svelte` file is logic nothing can
unit-test — which is the same seam the sync bugs sat in. `test-compose.mjs` covers it and
is wired into `npm test`.

**Day 2 — addresses and byte order (2026-09-06/07):**
- Task attempted: `src/main.cpp` (commit `8172890`) extends Day 1 with a `sockaddr_in`
  for port 9000/`INADDR_ANY`, prints `sin_port` raw vs. `ntohs()`, dumps the struct
  byte-by-byte in hex, and detects host endianness at runtime with the 1-byte trick.
  Compiles clean under `-Wall -Wextra`; ran it — byte dump correctly shows the port at
  offset 2–3 as `23 28` (big-endian 9000), matching the raw/`ntohs()` printout.
- Day 1's two pending review fixes are both applied: `close(fd)` added, and the
  failure branch now `return 1;`s instead of falling off `main()` as success.
- **Code review — pending fixes (not yet applied):**
  1. `uint16_t`/`uint8_t` used with no `#include <cstdint>` — compiles only because
     `<netinet/in.h>`/`<arpa/inet.h>` happen to pull it in transitively. Confirmed by
     removing them in isolation: it stops compiling. Include what you use.
  2. `addr.sin_addr.s_addr = INADDR_ANY;` set directly rather than through `htonl()` —
     harmless since `INADDR_ANY` is `0`, but the task specifically asked for the
     conversion as habit-building for the next literal address that isn't 0.
  - Minor style, non-blocking: `is_little_endian` mixes a C-style cast with the
    `reinterpret_cast` used one function below it; returns `int` used as a `bool`;
    a couple of redundant leading `struct` keywords (C habit, not needed in C++).
- Open question put to him rather than answered: which two byte offsets hold the
  port, and why does `0x23` land before `0x28` in memory — needs his answer before
  Day 3.
- Next session: apply the two fixes above, answer the byte-order question, then
  Day 3 — bind and listen.

**The review deck (2026-09-07).** The complaint it answers: theory and quiz get done on
the phone, the task waits for a laptop that isn't there, and meanwhile the earlier days
quietly fade. Nothing in the app ever asked about a day again once it was finished.

Every finished day now leaves cards behind — its quiz questions (replayed from the bank,
so they work with no key and no signal), its `teachBack` prompt, and a challenge the
model writes fresh from that day's theory. The forged ones are the point: a question
provably never seen, so it can't be answered from recognition.

Scheduling is SM-2 with the intervals deliberately scattered by up to 20%. Without the
jitter a day's five cards come due on the same morning forever, which teaches you to
recognise a batch rather than recall the material. On top of the schedule: due cards are
dealt shuffled, a not-yet-due card is spliced in 15% of the time, and on a day when
nothing is due there's a 20% chance of being asked anyway — the schedule decides what
you owe, not what you can be asked.

Delivery is an ambush when the app opens, once a day at most, above the lesson rather
than under it. Deliberately *not* a notification: there is no scheduled local
notification for a PWA (Notification Triggers never shipped) and push needs something
running to send it. The second surface is the actual gap — when the task is parked
waiting for a compiler, the phone offers review instead of nothing. It never gates a new
day.

`review.ts` is pure and takes its randomness as an argument, because a scheduler you
can't run twice with the same result is a scheduler you can't test; `test-review.mjs`
covers the ladder, the miss path, jitter bounds, deck derivation, selection, the ambush
and the two-device merge. Verified in a browser against a seeded finished day: 7 cards
built, all three kinds dealt in mixed order, schedules persisted, and the three Today
states (ambush / parked / silent) each behave.

Still to build: real push, from a scheduled Action reading the subscription out of the
sync gist.

**Practice on demand + Parsons cards (2026-09-07).** The deck answered "what have I
forgotten" but dead-ended on *Deck's clear*, which is useless when the complaint is "I
have free time, the next day is locked, and I don't want to burn tomorrow's lesson".
Went to the literature rather than guessing; the two things built are the two with the
best evidence-to-fit ratio.

**Parsons cards** — a real code block from that day's theory, shuffled, tapped back into
order. Ericson et al.'s randomised comparisons found solving Parsons problems produced
learning equal to writing the equivalent code in significantly less time, with no
retention difference a week later. The reason it fits *here* is mechanical: no compiler,
no typing, so it's the only real code practice that works on a phone. Blocks come from
lesson markdown the app already ships, so these work offline with no key.

**Practice on demand** — with the rule that answering early can hurt your schedule but
not flatter it. A correct answer on a card that wasn't due records the attempt and
leaves the interval alone; a miss still pulls it all the way back. Without that
asymmetry an idle evening would push everything months out and hollow the deck.

Two bugs, both caught by the browser rather than the unit tests:
1. `codeBlocksFor` used one regex, which paired a *closing* fence with the next
   *opening* one — so the first Parsons card it ever dealt was three sentences and a
   `###` heading. Now scans line by line, pairing fences properly.
2. Grid items default to `min-width: auto`, so a long code line pushed the whole row
   past the card edge instead of scrolling inside it.

Next, and the one with the strongest evidence still unbuilt: **productive failure**.
Sinha & Kapur's meta-analysis (53 studies, 166 comparisons, 12k+ participants) finds
problem-solving *before* instruction beats instruction-first for conceptual
understanding and transfer. The app currently forbids exactly that — tomorrow's task is
locked behind tomorrow's theory. Letting the task of a locked day be attempted without
unlocking its theory is both what the evidence supports and what was asked for.

**A second track: SQL (2026-09-07).** The content pipeline turned out to already be
generic — any `milestones/*/lessons/week.yaml` becomes a week — so adding a subject was
almost entirely a matter of finding the five places that said "cpp" out loud.

`track:` in `week.yaml` is the whole mechanism. Everything downstream keys off it: which
day the app offers next, which cards the review deck deals, which language a fence is
highlighted and Parsons-shuffled as, and how the mentor and examiner describe who
they're talking to (one `SUBJECTS` table; the persona and the prime directive are the
same job whatever the subject, and duplicating them per track is how two prompts drift).
A segmented switcher appears on Today only when a second track actually has content.

Three lessons written: a table is a file of pages; an index is a sorted copy; NULL is not
a value. All of it runs in sqlite3 — one binary, no server — which incidentally solves
the environment problem that keeps stalling the C++ tasks.

Every claim was run before it was written down, and that caught two of my own errors:
1. Day 1 said the page count jumps on the first insert. It doesn't — it jumps at
   `CREATE TABLE` (schema page + table root) and then sits still for hundreds of rows.
2. Day 2's example table had two columns, one of them `INTEGER PRIMARY KEY`. That makes
   the index cover `SELECT *` (the rowid *is* the id), so the quoted plan said
   `COVERING INDEX` three sections before the lesson introduces the term. Fixed by
   giving the table a third column.

Also found while writing Day 2, and now the day's "worth knowing": SQLite's `LIKE` is
case-insensitive by default while indexes sort case-sensitively, so `LIKE 'x%'` scans
even though a prefix match is exactly what a sorted index is for. `PRAGMA
case_sensitive_like=ON` or `COLLATE NOCASE` on the index restores the range scan.

Two bugs in the switch itself, found in a browser: switching to a track whose week had
never been downloaded showed "Week clear" (the auto-download rule was "first week
overall" rather than "first week of this track"), and Today's header fell back to
`weeks[0]` regardless of track.

**Track separation bugs (2026-09-07).** Adding SQL shipped with a bad one: both weeks
declared their days as `day-01`, `day-02`, …, and `Progress.days` is a flat map keyed by
day id alone. So SQL Day 1 *was* C++ Day 1 — same completion, same quiz answers, same
notes, same review cards, same mentor thread. Finishing one finished the other.

Fixed by prefixing the SQL ids (`sql-day-01`) rather than renamespacing the C++ ones,
which would have orphaned real progress. The actual fix is the guard: `build-content.mjs`
now fails the build on a duplicate day id across weeks, because this has no partial
version — it silently merges two learners' days in every direction at once.

Note for anyone who used the SQL track before this: answers given there were written into
the C++ Day 1/2 records (quiz keys are `q1`..`q5` on both), so those C++ days may show
verdicts that aren't yours. Re-drilling them from the map is the clean way out.

Two more found while sweeping for the same class of problem:
- The week map listed every week regardless of track, and offered to download the other
  subject's weeks from inside this one's path.
- `completedToday` was global, so finishing a C++ day made the SQL tab say "Done today,
  see you tomorrow" on a track that had never been opened. Now track-scoped — unlike the
  streak, which stays global on purpose: it's one daily habit, and a day of either
  subject keeps it alive.

Checked and found fine: the streak can't double-count two days finished on one date
(`completeDay` guards on `lastActiveDate === date`), and the C++-specific badges not
firing on SQL is correct rather than broken. One copy fix — the generic seven-day streak
badge said "the C++ is downstream of it" on both tracks.

**"Google is having a moment" (2026-09-08).** A 503 from Gemini went straight to the
screen as a dead end you had to tap through. `post()` did exactly one fetch, so every
transient blip cost a manual retry.

Three changes, in increasing order of how much they help:

1. **`post()` retries what is the far end's problem** — 500/502/503/504, and dropped
   connections — up to three attempts with exponential backoff and jitter. Safe at that
   layer specifically because it returns *before* the body is read, so a retry can never
   duplicate text already on screen. `Retry-After` is honoured when sent, capped at 8s
   so the UI never sits still for a server-suggested minute. A bare 429 is deliberately
   *not* retried: on the free tier that's a quota, and retrying into a quota is how you
   stay in it — it only comes back if the server itself named a delay.

2. **A busy model falls through to another.** Google overloads its newest models
   noticeably more than its older ones (noted here weeks ago), so `BusyError` is now its
   own type and `streamReply` walks a ranked chain: chosen model, then up to two
   alternates. Only ever before the first character reaches the screen — half a reply
   followed by a second model starting over would be worse than the error. A retired
   model (404) falls through the same way.

3. **The message admits it already tried**, so "try again" isn't the only advice on
   offer when it does surface.

Verified in a browser against a stubbed provider, three scenarios: a single 503 clears
invisibly (2 attempts, answer, no error); an overloaded model falls to the next one
(3 attempts, then the alternate answers, no error); a total outage retries 6 times
across 2 models and then says so.

**Replies were being cut off mid-sentence, silently (2026-09-08).** Reported with a
screenshot: an answer that ended on "…but here is how" and simply stopped. Two bugs
stacked.

1. **The finish reason was ignored the moment any text arrived.** `streamGemini` did
   `if (sawText) return;` before looking at it, so a reply the model had abandoned —
   `MAX_TOKENS`, `SAFETY`, anything — was indistinguishable from one it had finished.
   The note is appended to the reply rather than thrown, because the text that did
   arrive is worth keeping and an error would replace it with nothing.
2. **Why it was being cut at all:** on Gemini 2.5+ thinking tokens are billed against
   `maxOutputTokens` — they share one ceiling, contrary to how the docs read. The cap
   was 1600, so the model could spend most of it reasoning and emit two sentences before
   being cut off. Raised to 4096, and Flash models now get an explicit
   `thinkingConfig.thinkingBudget` of 640 so reasoning can't eat the whole thing.

The thinking budget is sent only to Flash models on purpose: other families either
reject the field or enforce their own floor, and a 400 there would break the chat
outright rather than merely truncate it.

**Ask about a highlighted passage (2026-09-08).** Highlight anything in the theory or
the task, and a small "Explain this" pill appears above the selection; tapping it opens
the mentor with that passage already asked about in detail.

Deliberately not built on `contextmenu` alone. Right-click is the desktop gesture and it
is handled, but this is read mostly on a phone, where the equivalent is a long-press
raising the *system* selection menu — which a web page cannot add an item to. So the
trigger is the selection itself, via `selectionchange`: one mechanism covering
mouse-drag, double-click, long-press and shift-arrow. The native menu is suppressed only
when there is actually a selection inside the lesson to ask about, so right-clicking a
link, or long-pressing with nothing selected, still behaves normally.

The passage is quoted into a framed prompt rather than sent bare — a stray fragment of a
sentence reads like an instruction otherwise. On the task screen the framing also says
"do not write it for me", so the prime directive survives someone highlighting a
checklist item.

`MentorSheet` gained an `ask` prop for this: starters couldn't do the job because they
only render on an empty thread, and asking about a passage has to work on the tenth
question as readily as the first. It awaits `chat.open()` before sending, so the
question lands in that day's thread rather than racing whichever was last loaded.

Verified in a browser: pill appears on selection and is positioned inside the viewport;
right-click with a selection shows it and suppresses the native menu; right-click with
no selection leaves the native menu alone; selecting the page heading (outside the
watched element) offers nothing; a two-character selection offers nothing; the question
is really sent and the reply renders.
