# Progress Log

Format: what you built, what broke, what you learned that wasn't in the spec.
The third column is the valuable one. Be honest in it.

| Milestone | Started | Done | Review | Teach-back | Notes |
|---|---|---|---|---|---|
| 01-raw-sockets | 2026-09-01 | | | | Day 1/8 in progress (see log) |

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
