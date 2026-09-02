# cpp-lab — Learning App Design Doc

**Status:** v2 built (2026-09-02) — cloud sync + mentor chat (Gemini free tier or
Claude). Code in `app/`, how-to in `app/README.md`.
**Type:** installable PWA (Progressive Web App) — runs in the browser, "Add to Home
Screen" on iPhone gives it a full-screen icon, offline support, and a native-ish feel.
No Mac, Xcode, App Store, or developer account required.

> **On "I want an iOS app":** asked and answered — there's no Mac, so native SwiftUI
> was never actually on the table (no Xcode, no simulator, no signing, and nothing on
> the Linux box could even compile it). React Native and Capacitor both hit the same
> wall for a permanent install. The PWA is the only path that produces a real
> home-screen app on that hardware, and on iOS it genuinely gets full-screen launch,
> offline, and its own icon. What it does not get: the App Store, and storage iOS
> promises to keep — hence the export in §3.5, which is load-bearing rather than nice
> to have.

**Owner of content:** this repo. The app is a *delivery vehicle* for the C++
curriculum in `milestones/` — it does not contain the learning; it presents it.

---

## 1. Purpose & principles

One-line goal: **open your phone, land on today's C++ session, finish it in 20–30
minutes, keep the streak.** Zero friction, no "what should I do today" tax.

Principles, in priority order:

1. **Zero-friction start.** App opens directly to today's session with one primary
   button. No menus to navigate to begin.
2. **One session = one day.** The daily unit is Theory → Quiz → Task, sized to
   ~20–30 min. The app never pressures more than one session a day — the goal is
   consistency, not grinding.
3. **The mentor's voice.** Copy throughout uses the mentor persona from `CLAUDE.md`:
   opinionated, a little informal, precise on the technical bits, real trivia. Not a
   childish gamified toy, not a dry textbook.
4. **Offline-first.** Loaded weeks work with no network (metro, plane). Network is
   only needed to *fetch new weeks* and (v2) to chat.
5. **No dark patterns.** Streaks and XP motivate; they never guilt-trip or
   manufacture urgency. A missed day is a missed day, not a crisis.
6. **Honest about what it is.** The in-app mentor is Claude, presented as Claude. No
   pretending to be a human tutor.

---

## 2. Division of labor: app vs. Claude Code sessions

These two coexist and do different jobs. Worth being explicit so we don't duplicate.

| | **The app (phone, solo, daily)** | **Claude Code (laptop, this repo)** |
|---|---|---|
| Theory | Read the day's lesson | Ask deeper "why" follow-ups live |
| Quiz | Self-contained, instant feedback | (n/a — app owns this) |
| Task | Read the spec, jot notes, mark done | **Write the actual C++ here** |
| Code review | — | Senior-style review of your code |
| Teach-back | Graded conversation, step 4 of every session | Examiner prompt probes the answer, then rules solid/gaps |
| Chat (v2) | Quick mentor questions in-context | Full mentoring, code, debugging |

The app is the **daily driver and reference**; the laptop repo is where real code and
real review happen. The app's Task screen is a *briefing*, not an IDE — you still open
the laptop to write `server.cpp`.

---

## 3. Screens & flows

Six screens. Wireframes are rough — they're about layout and hierarchy, not final
pixels.

### 3.1 Today (home / launch screen)

The default screen. Answers "what am I doing right now" in under a second.

```
┌─────────────────────────────┐
│  🔥 4        cpp-lab     ⚙︎  │   streak · title · settings
│                             │
│   Week 1 · Raw Sockets      │
│   ╭───────────────────────╮ │
│   │  DAY 3                 │ │   ← today's card (the hero)
│   │  bind() and listen()   │ │
│   │  ~25 min               │ │
│   │                        │ │
│   │  ●●○  theory·quiz·task │ │   ← 3-segment day progress ring
│   │                        │ │
│   │     ┌───────────────┐  │ │
│   │     │   Continue →   │  │ │   ← single primary CTA
│   │     └───────────────┘  │ │
│   ╰───────────────────────╯ │
│                             │
│   Week 1  ▓▓▓░░░░  3/7       │   ← week progress bar
│                             │
│  [ Today ] [ Map ] [ Stats ]│   ← bottom tab bar (+ Mentor in v2)
└─────────────────────────────┘
```

- The button reads **Start** for a fresh day, **Continue** if the day is partway done,
  **Done today ✓ — see you tomorrow** once complete (with a soft option to peek ahead
  or review a past day).
- Streak flame top-left. Tapping it goes to Stats.

### 3.2 Session player (the core flow)

A three-step stepper: **Theory → Quiz → Task**. One step per screen, a progress bar
pinned to the top showing position in the day. This is the "current lesson menu" —
linear by default, because a daily learner shouldn't have to decide what's next.

```
┌─────────────────────────────┐
│ ‹ Day 3      ▓▓▓░░░░░  1/3   │   step progress
│─────────────────────────────│
│                             │
│  # bind() and listen()      │
│                             │
│  Theory prose, rendered      │
│  markdown, with real code    │
│  blocks:                     │
│  ┌─────────────────────────┐│
│  │ bind(fd, (sockaddr*)&a, ││   ← syntax-highlighted, mono font
│  │      sizeof a);          ││
│  └─────────────────────────┘│
│                             │
│  …trivia / war-story asides  │
│  in a subtly tinted callout. │
│                             │
│        ┌───────────────┐    │
│        │  Take the quiz →│   │
│        └───────────────┘    │
└─────────────────────────────┘
```

**Quiz step** — one question per card, mirrors the multiple-choice style already used
in Claude Code sessions. Wrong options are *real misconceptions*. After you answer:
the choice turns green/red, and a **"why"** explanation expands for both the right
answer and the wrong one you might have picked.

```
┌─────────────────────────────┐
│ ‹ Day 3      ▓▓▓▓▓░░░  2/3   │
│─────────────────────────────│
│  Question 2 of 3            │
│                             │
│  Restarting the server fast  │
│  fails with "Address already │
│  in use." Why?               │
│                             │
│  ┌─────────────────────────┐│
│  │ ○ The port is destroyed  ││
│  ├─────────────────────────┤│
│  │ ● TIME_WAIT holds the    ││ ← selected, correct → green
│  │   port briefly            ││
│  ├─────────────────────────┤│
│  │ ○ Another process stole  ││
│  │   it                      ││
│  └─────────────────────────┘│
│  ╭─ why ─────────────────╮   │
│  │ TCP keeps the old       │   │  ← expands after answering
│  │ connection in TIME_WAIT…│   │
│  ╰─────────────────────────╯  │
│        [  Next →  ]          │
└─────────────────────────────┘
```

**Task step** — the day's coding brief. Description, target file(s), the exact compile
command (copyable), and a checklist. A notes field captures "what confused me" — the
honest third column of `PROGRESS.md`. Buttons: **Mark attempted** / **Mark done**.

```
┌─────────────────────────────┐
│ ‹ Day 3      ▓▓▓▓▓▓▓▓  3/3   │
│─────────────────────────────│
│  ## Your task                │
│  Extend Day 2 to bind() and  │
│  listen(). Reproduce         │
│  "Address already in use",   │
│  then fix it.                │
│                             │
│  📄 src/main.cpp             │
│  $ g++ -std=c++20 -Wall …  ⧉ │  ← tap to copy
│                             │
│  ☐ every syscall checked     │
│  ☐ reused-addr fixed         │
│  ☐ zero warnings             │
│                             │
│  ✎ What confused me…         │  ← notes (feeds PROGRESS.md)
│                             │
│  [ Mark attempted ] [ Done ✓]│
└─────────────────────────────┘
```

Finishing the Task completes the day → confetti-lite celebration, streak/XP update,
back to Today.

### 3.3 Week map (the path)

The whole week as a vertical path — done / current / locked. Lets you jump back to a
finished day to re-read or re-drill its quiz (spaced repetition). Days ahead are
locked to preserve the one-a-day rhythm (unlockable via a small "peek ahead" if you
insist — no nanny state, just a gentle default).

```
┌─────────────────────────────┐
│  Week 1 · Raw Sockets        │
│                             │
│     ✓ Day 1  socket = fd     │
│     │                        │
│     ✓ Day 2  addresses       │
│     │                        │
│    ◉  Day 3  bind/listen  ←  │  ← current, pulsing
│     │                        │
│     🔒 Day 4  accept()       │
│     │                        │
│     🔒 Day 5  recv/send      │
│        …                     │
│                             │
│  ── next week ──             │
│   ✨ Week 2 available         │  ← appears when I push it
│      [ Load week ]           │
└─────────────────────────────┘
```

### 3.4 Stats / progress

Streak, total days done, XP, badges, and a small honesty panel: "days you flagged as
confusing" so the app reflects the real struggle, not just green checkmarks.

Badges (examples): First Socket (Day 1), Byte-Order Boss (Day 2), Week 1 Complete,
7-Day Streak, Milestone 01 Reviewed, Teach-back Passed. Earned in the mentor's voice,
not "You're a superstar!!!" filler.

### 3.5 Settings

Theme (system / light / dark), reset progress, export/import progress JSON (backup,
since it's a single device), and — greyed until v2 — **Anthropic API key** for chat.

### 3.6 Mentor chat — see §8. Built.

---

## 4. Gamification & motivation (tasteful, evidence-based)

Pulled from what actually works in Duolingo/Brilliant/etc., minus the manipulative
parts:

- **Streak** — daily. One session keeps it alive. Optional single "streak freeze" you
  earn (not buy) every 7 days, so one busy day doesn't nuke a month of work. No paid
  freezes, no panic notifications.
- **Day progress ring** — 3 segments (Theory/Quiz/Task). Visible, satisfying to close.
- **Week progress bar** — the medium horizon.
- **XP** — small amount per completed session, a bit more for a clean quiz sweep.
  XP is flavor/feedback, not a currency for anything.
- **Badges/milestones** — punctuate real achievements (a milestone done, a streak, a
  teach-back passed), in the mentor voice.
- **Spaced repetition** — finished days' quizzes are re-offerable from the map; the
  app can surface a "quick review" of an earlier day's quiz occasionally. Retention >
  novelty.
- **Daily goal = 1 session.** Explicitly capped ambition. The win condition is
  *showing up*, matching the 20–30 min/day reality.

Deliberately **excluded**: leaderboards (single user), guilt notifications, streak
loss shaming, anything that turns a bad week into a reason to quit.

---

## 5. Visual design

- **UI font:** the system stack (`-apple-system`), which on iPhone renders as **SF
  Pro** — native, gorgeous, zero download, perfectly at home on the device. Falls back
  to Inter/Segoe elsewhere.
- **Code font:** **JetBrains Mono** (bundled `.woff2` for offline). Ligatures make C++
  operators (`->`, `::`, `<=`, `>>`) read cleanly. This is a C++ app; code typography
  is not optional.
- **Optional display face:** one characterful face for big numbers (streak, XP) only —
  everything else stays SF Pro. Kept restrained.
- **Color:** dark-mode-first (it's for developers), full light mode too, honoring
  `prefers-color-scheme` plus a manual toggle. Calm base, one confident accent for
  primary actions and the streak flame. Semantic green/red only for quiz correctness.
- **Code highlighting:** proper C++ syntax highlighting in theory blocks (bundled
  highlighter, offline). Non-negotiable — unhighlighted C is hostile to read on a
  phone.
- **Motion:** restrained. A progress ring closing, a gentle completion celebration.
  No bouncing mascots.
- **Layout:** card-based, generous spacing, one primary action per screen, thumb-
  reachable buttons (bottom-anchored CTAs).

---

## 6. Content data model

The contract between the curriculum (repo) and the app. Two JSON shapes.

### 6.1 Curriculum manifest — `content/curriculum.json`

The index the app checks for what weeks exist.

```json
{
  "schemaVersion": 1,
  "title": "cpp-lab",
  "weeks": [
    {
      "id": "week-01",
      "title": "Raw Sockets I",
      "milestone": "01-raw-sockets",
      "days": 7,
      "url": "content/weeks/week-01.json",
      "contentHash": "sha256:…",
      "available": true
    }
  ]
}
```

### 6.2 Week — `content/weeks/week-01.json`

```json
{
  "id": "week-01",
  "title": "Raw Sockets I",
  "milestone": "01-raw-sockets",
  "intro": "You already await async I/O at work. Build the black box first…",
  "days": [
    {
      "id": "day-01",
      "day": 1,
      "title": "A socket is a file descriptor",
      "estMinutes": 25,
      "theoryMarkdown": "## What a socket actually is …",
      "quiz": [
        {
          "id": "q1",
          "prompt": "What does socket() returning -1 vs 3 mean?",
          "options": [
            { "text": "-1 = failure, check errno", "correct": true,
              "why": "Sentinel-return + errno is the universal POSIX pattern." },
            { "text": "-1 = no client yet", "correct": false,
              "why": "socket() hasn't touched the network; it can't know about clients." }
          ]
        }
      ],
      "task": {
        "markdown": "Call socket(), check it, print the fd, close() it.",
        "files": ["src/main.cpp"],
        "compile": "g++ -std=c++20 -Wall -Wextra -o day1 src/main.cpp",
        "checklist": ["socket() return checked", "close() called", "zero warnings"]
      },
      "teachBack": null
    }
  ]
}
```

The quiz `options[].correct/why` maps exactly to how quizzes already run in Claude
Code sessions (real misconceptions as distractors, explain why each is wrong).

### 6.3 Authoring pipeline (single source of truth)

Problem: the theory/task should stay human-readable in the repo (`milestones/*/lessons/
day-NN-*.md`), but the quiz **answer keys** shouldn't sit in the obvious file the
learner might open.

**Recommended approach:** author two files per day, compiled into the week JSON by a
small build script:

- `milestones/<m>/lessons/day-NN-<slug>.md` — theory + task, greppable, no answer keys
  (quiz shows question text only, as today).
- `milestones/<m>/lessons/day-NN-<slug>.quiz.yaml` — the quiz answer key (options,
  `correct`, `why`).

A script (`app/scripts/build-content.mjs`) parses both, emits
`content/weeks/week-NN.json` + updates `curriculum.json` with a fresh `contentHash`.
So the repo stays the single source of truth; the app JSON is a build artifact, never
hand-edited. Alternative considered — one JSON per day as source, generate the `.md`
from it — rejected because hand-writing JSON prose is miserable and the `.md` is nicer
to review in git. **Open for your call (§11).**

---

## 7. Update mechanism

1. Content JSON is hosted at a stable URL — the same host as the PWA (GitHub Pages /
   Vercel / Netlify), so no CORS or extra infra.
2. On launch (and on pull-to-refresh), the app fetches `curriculum.json`.
3. It compares against the cached manifest:
   - **New week** (`available: true`, not seen before) → "✨ Week N available" card on
     the map with a **Load week** button. Tapping it downloads + caches that week.
   - **Changed existing week** (different `contentHash` — e.g. I fixed a Day 3 typo) →
     silently refreshes that week's cache, preserving your progress (keyed by day id).
4. Downloaded weeks live in the Cache API / IndexedDB → full offline use afterward.
5. `schemaVersion` guards against an app too old to parse new content (prompts a
   refresh of the app shell itself, which the service worker handles).

**Weekly cadence for me:** write next week's `.md` + `.quiz.yaml` → run the build
script → commit/push → the hosted content updates → your app shows "Week N available."
No app rebuild, no redeploy of the shell for content-only changes.

---

## 8. Chat with the mentor (built 2026-09-02)

Goal: ask the mentor a quick question *in context* without leaving the app —
"why does TIME_WAIT exist again?" while sitting on Day 3.

**Behaviour as built**
- A **Mentor** tab, fifth in the bar.
- Every message carries a system prompt = the mentor persona distilled from
  `CLAUDE.md` (tone, calibration to his actual baseline, and the prime directive:
  *never write the milestone implementation; answer "why" freely; guiding questions
  when he's stuck*) **plus** the current day's title, theory and task, and the titles
  of the days still ahead so it can't get in front of the curriculum.
- Responses stream token by token. One thread per day, stored locally, resumed on
  return.
- The in-app mentor obeys the same prime directive as the CLI, by construction of its
  system prompt. This is a feature: the app cannot become a cheat button.

**Transport**
- Direct client → provider API with a key pasted into Settings, stored on-device only
  and never included in the synced payload. Both endpoints' CORS preflights were
  verified before the code was written: Anthropic allows the
  `anthropic-dangerous-direct-browser-access` opt-in header, and Google echoes the
  origin and accepts the key in `x-goog-api-key` — which keeps it out of the URL, and
  therefore out of anything that logs URLs.
- No proxy, no serverless function. `src/lib/mentor.ts` is two `fetch` calls behind
  one interface; swapping in a proxy later is a change to that file alone.

### 8.0 Two providers, because the bills are different

Shipping only Anthropic was a design mistake, and it surfaced the moment the key was
pasted in: **the Anthropic API is prepaid and entirely separate from a Claude
subscription.** "Get a key" is not sufficient instruction — the account needs credit,
and a Max subscription grants none. For a tab whose job is answering "why is it like
this" three times a session, a paywall is a bad trade.

So the mentor is provider-agnostic, with **Gemini as the default**:

| | Gemini | Claude |
|---|---|---|
| Cost | Free tier — rate-limited, not metered. No card. | Prepaid credits, ~½–2¢ a question. |
| Getting a key | AI Studio, sign in with Google, one tap. | Console, plus a top-up. |
| Answer quality | Good enough for concept questions. | Better, particularly on C++ specifics. |

Both share the persona, the prime directive, the day context, the history window and
the markdown rendering. What differs is genuinely only the wire format — Gemini calls
the assistant `model`, puts the system prompt in `systemInstruction`, wraps text in
`parts[]`, and hides streamed tokens in `candidates[0].content.parts[].text`. Every one
of those differences fails as a runtime 400 rather than a type error, which is why
`scripts/test-mentor.mjs` asserts the shape of both requests rather than trusting them.

**Gemini's model list is fetched, not hardcoded.** Google retires and renames models
often enough that a list pinned today 404s within a year, and that failure reaches the
user as "model not available" with no route to one that is. On key save the app calls
`ListModels`, keeps the entries that support `generateContent`, drops embeddings and
image/audio models, sorts Flash first (its free-tier limits are the generous ones), and
**heals the stored choice if it is no longer offered**. `Settings.mentorModel` is
therefore a plain `string`, not a union — the type system should not be more confident
about a model name than Google is.

### 8.1 Security consequence, handled

Model output is rendered as markdown through `{@html}`, in a page whose IndexedDB
holds a GitHub token and an Anthropic key. `src/lib/markdown.ts` therefore escapes raw
HTML from *every* source and filters link and image hrefs to navigational schemes —
one always-safe path rather than a `trusted` flag someone eventually forgets to pass.
`scripts/test-markdown.mjs` asserts it against the obvious payloads and against the
lesson formatting that has to keep working.

---

## 8.5 Progress sync (built 2026-09-02)

Exporting JSON by hand is the kind of friction that quietly ends a daily habit. The
constraint: free, no server, and nothing new to run.

**Chosen: a secret GitHub Gist**, written directly from the phone.

- `api.github.com` sends `Access-Control-Allow-Origin: *` (verified), so a static page
  can `PATCH` it with no proxy.
- Auth is a **fine-grained PAT with one permission: Gists, read and write**. It cannot
  read a repo, push code, or open an issue, and it's revocable from one page. That's
  the trade for having no backend: a narrow credential on the device instead of a
  broad one on a machine you'd have to keep running.
- The gist is secret, versioned, and diffable — and it's readable from the laptop,
  so a session there can see what happened on the phone.

**Rejected**

- *Telegram Bot API.* Also CORS-open, but a bot cannot read its own chat history, so
  "restore onto a wiped phone" has no clean path (the pinned-message trick caps at
  4096 characters and is fragile). The 4 GB of Saved Messages belongs to the user
  account, which bots can't touch. And a bot token is a far broader capability than
  gists-only.
- *Committing `progress.json` to this repo.* Needs `contents: write` — a much wider
  token — and turns a learning log into commit-history noise.
- *A third-party free tier.* Another account, another expiry, dead in two years.

**Merge, not last-write-wins.** There's no server to arbitrate, so `src/lib/merge.ts`
is a pure function both devices would compute identically. Every field takes the
more-advanced of the two values or keeps both; opening the laptop can never erase a
session done on the phone that morning. Specifics worth knowing:

- **XP is derived from the day records, not merged.** An accumulator can't merge:
  summing double-counts a shared session, maxing loses one. The days are the ledger.
- **The streak is chosen, not merged** — it's history neither record stores. The
  device that acted most recently wins the count, so a phone left in a drawer on a
  12-day streak can't resurrect it a week after it broke. `longest` takes the max,
  because that's what a high-water mark means.
- **Settings and `loadedWeeks` stay local.** Syncing theme would flip the laptop when
  he switches the phone to dark at night; syncing `loadedWeeks` would convince a fresh
  install it already holds content it hasn't downloaded.
- **Two different notes on the same day are both kept**, separated by a rule. Dropping
  one silently is the worst outcome available.
- **Reset switches sync off** rather than pushing an empty record over the backup a
  few seconds later. Reconnecting afterwards pulls it back, which makes deleting the
  gist the deliberate act it ought to be.

Sync runs on launch, on returning to the foreground, and a few seconds after any
change; a pending push is flushed when the app is backgrounded, which on iOS is the
last moment it's reliably allowed to run. `scripts/test-merge.mjs` covers it.

The JSON export in §3.5 stays. It's the copy that doesn't depend on GitHub.

---

## 9. Offline & local storage

- **Content cache:** Cache API / IndexedDB — loaded weeks fully offline.
- **Progress store:** local (IndexedDB) — current week/day, per-day state (theory
  read, quiz answers + score, task status, notes), streak (`lastActiveDate`, `count`,
  freezes), XP, badges, settings.
- **No server sync** (single device). Backup via Settings → export/import a progress
  JSON. Nice touch: export a day's note pre-formatted to paste into `PROGRESS.md` on
  the laptop.
- **Service worker** caches the app shell → instant launch, works offline, updates the
  shell when a new app version ships.

---

## 10. Tech stack (my recommendation — object if you want)

- **Svelte + Vite + `vite-plugin-pwa`.** Tiny runtime → fast on a phone, first-class
  PWA support, low ceremony. (You're a C++ dev, not a web dev — I optimized for *me*
  maintaining it cleanly and the bundle staying small, over framework familiarity.)
- **Markdown rendering:** a small bundled renderer; **Shiki or highlight.js** for C++
  syntax highlighting, bundled for offline.
- **Storage:** `idb` (thin IndexedDB wrapper) + localStorage for trivial flags.
- **Hosting:** GitHub Pages or Vercel — free, HTTPS (required for PWA install), content
  + shell same origin.
- **No backend** for v1. Chat (v2) is client-direct as in §8.

If you'd rather it be React (more transferable if you ever poke at it), say so — it's a
clean swap at this stage.

---

## 11. Decisions (settled 2026-09-01, extended 2026-09-02)

1. **Content authoring** — two files per day, `.md` + `.quiz.yaml`, compiled to week
   JSON by `app/scripts/build-content.mjs`. The answer key stays out of the file he'd
   naturally open mid-lesson. Adopted; `week.yaml` was added alongside them to carry
   the week roster so unwritten days can still appear on the map as locked steps.
2. **Tech stack** — Svelte 5 + Vite + `vite-plugin-pwa`. No preference expressed, so
   the §10 recommendation stands: small runtime, and I'm the one maintaining it.
3. **Gamification** — as designed. Streak with earned freezes, 3-segment day ring,
   week bar, XP, badges in the mentor's voice, re-drillable past quizzes.
4. **Peek-ahead** — days ahead locked by default, with an explicit "Let me jump ahead"
   toggle on the map and in Settings. Gentle, not a nanny.
5. **v1 scope** — chat held to v2. Everything in §3.1–3.5 is in and built.
6. **Sync transport (2026-09-02)** — GitHub gist over Telegram, for the reasons in
   §8.5. He raised Telegram explicitly; the blocker is that bots can't read their own
   history, which makes restore-after-wipe unworkable.
7. **Mentor provider (2026-09-02)** — Gemini's free tier is the default; Anthropic is
   kept as a switch rather than removed, since it answers better once an account has
   credit. Driven by a real dead end: a valid Anthropic key with a $0 balance, and app
   copy that said "get a key" without saying "and prepay it".
8. **Quiz option order (2026-09-02)** — decided by the build, not the author. Writing
   the right answer first is the natural way to author a key, and it made every
   correct answer option A. `build-content.mjs` now shuffles deterministically per
   question, re-salting if a whole day lands its answers in the same slot.

### Where the build knowingly departs from this doc

- **Accent colour.** §5 wanted one accent for both primary actions and the flame. Built
  with two: violet for actions, orange kept for the flame only. An orange CTA sat a
  hair away from the wrong-answer red, and a quiz app cannot afford that confusion.
- **Week 1 is 8 days, not 7.** The §6.1 example said 7; milestone 01 actually has
  eight sessions. The content follows the milestone.
- **Locked days show their teaser**, with a single note at the foot of the week
  explaining they're not written yet — rather than stamping "Not written yet" on
  every row.
- **Streak freezes cap at 2** and are earned every 7th day. §4 said "earn one every 7
  days" without a ceiling; uncapped, a long run banks enough freezes to make the
  streak meaningless.
- **The mentor is two providers, not one.** §8 specified Anthropic only. See §8.0 —
  the free tier is what makes the tab usable without a billing decision first.
- **The Mentor tab is always visible**, not revealed once a key is set as §8 said. A
  feature you have to already know about to find is a feature nobody finds; the tab
  shows a setup card explaining what it does, what it refuses to do, and that it's the
  one part of the app that costs money.
- **Test files exist** (`app/scripts/test-*.mjs`, `npm test`). The streak rules
  are the one piece of logic here subtle enough — freezes, gaps, DST-proof date maths
  — to fail silently and only be noticed by losing a real 40-day run. Node's own
  runner, no framework, no new dependencies. Merge and markdown-escaping joined it in
  v2 for the same reason: both fail silently and both fail expensively. It is not a
  general testing setup, and it does not pre-empt milestone 09.

## 12. Build plan

- **v0** — this design doc. ✅
- **v1** — core PWA: Today, session player (theory/quiz/task), week map, progress +
  streak + XP + badges, update mechanism, offline, both themes, installable. ✅ built
  2026-09-01. Week 1 ships with Day 1 written and Days 2–8 rostered as locked steps —
  lessons stay written one at a time, calibrated on how the last one went, per
  `README.md`.
- **v2** — mentor chat (§8, both providers) and progress sync (§8.5). ✅ built
  2026-09-02. ← we are here
- **v3 (optional)** — richer spaced-repetition review, more badges, note→PROGRESS.md
  export polish.
