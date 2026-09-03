# cpp-lab app

The installable PWA that delivers this repo's curriculum one day at a time.
Design and rationale live in [`DESIGN.md`](./DESIGN.md); this file is how to run it.

The app is a **delivery vehicle**, not the learning. The C++ still gets written on the
laptop — the Task screen is a briefing, not an IDE.

## Run it

```bash
cd app
npm install
npm run dev        # http://localhost:5173
```

Other scripts:

| | |
|---|---|
| `npm run content` | Compile `milestones/*/lessons/` → `public/content/` |
| `npm run build` | Content, then production build into `dist/` |
| `npm run preview` | Serve `dist/` (add `--host` to open it from your phone on the same wifi) |
| `npm test` | Streak, merge and markdown-escaping tests — the bits that fail silently |
| `npm run check` | `svelte-check` type pass |
| `npm run icons` | Re-render the icon set; only needed if the mark changes |

## Getting it onto the iPhone

1. Push to `main`. `.github/workflows/deploy-app.yml` builds and publishes to GitHub
   Pages. **One-time setup:** repo → Settings → Pages → Source: **GitHub Actions**.
2. Open `https://<user>.github.io/cpp-lab/` **in Safari** — Chrome on iOS cannot
   install PWAs, only Safari can.
3. Share → **Add to Home Screen**.

That gives a home-screen icon, full-screen launch with no browser chrome, and offline
use. To try it before deploying, `npm run preview -- --host` and open the LAN address
from the phone — everything works except installing, which needs HTTPS.

## Sync it across devices

Settings → **Sync**. The app keeps your progress in a **secret GitHub gist**, so the
phone and the laptop stay in step without exporting JSON by hand.

1. [github.com/settings/personal-access-tokens/new](https://github.com/settings/personal-access-tokens/new)
2. **Account permissions** → **Gists: Read and write**. Nothing else.
3. Generate, copy, paste into Settings → Connect.

That token can read and write your gists and nothing else — no repo access, no push,
revocable from the same page. It's stored on the device only and is never included in
the synced payload.

Connecting a second device with the same token finds the existing gist and **merges**
rather than overwriting: every completed day, note and badge from both sides survives.
Settings, and which weeks are downloaded, deliberately stay per-device. See
`DESIGN.md` §8.5 for why the streak is the one field that gets chosen instead of
merged.

**Reset all progress** switches sync off as part of the wipe, so it can't push the
empty record over your backup. Reconnecting pulls the gist back.

The JSON export is still there. It's the copy that doesn't depend on GitHub.

## Turn on the mentor chat

Settings → **Mentor chat**. Two providers; **Gemini is the default because its free
tier is actually free** — rate-limited rather than metered, no card, no credits.

**Gemini (free)**

1. [aistudio.google.com/apikey](https://aistudio.google.com/apikey), sign in with a
   Google account.
2. **Create API key** — accept whatever project it offers, or let it make one.
3. Copy it (newer keys start with `AQ.`, older ones with `AIza`), paste into
   Settings → Save key.

**Why not just "Sign in with Google"?** It's the obvious question and the answer is
no, for three separate reasons, any one of which is fatal:

- The free Gemini Developer API (`generativelanguage.googleapis.com`) authenticates
  `generateContent` with an API key. OAuth on that host exists, but its scopes cover
  tuned models and semantic retrieval — not ordinary generation.
- The endpoint that *does* take OAuth access tokens for generation is Vertex AI, which
  needs a Google Cloud project with billing enabled. That's strictly more setup than
  pasting a key, and it isn't free.
- Google OAuth requires a client ID with **pre-registered redirect URIs**. This app is
  static and self-hosted, so everyone's copy lives at a different origin — each person
  would have to register their own OAuth client and redirect URI, which is more work
  than creating an API key, not less. A shared client ID can't work, and there's no
  backend to hold a secret or proxy the calls.

The design that would give you a real "sign in with Google" button is a hosted service:
one operator runs a backend (Firebase AI Logic is purpose-built for this — it keeps the
key server-side), users sign in, and **the operator pays for everyone's tokens**. That's
a different product with a bill attached, not a change to this one. Bring-your-own-key
is what keeps this app free, serverless, and yours.

Saving fetches the model list straight from Google, which doubles as the cheapest
possible check that the key works. Pick a **Flash** model: on the free tier the limit
that bites is requests-per-minute, and Flash gets several times Pro's allowance.

**Claude (prepaid)**

Switch the provider toggle and paste a key from
[console.anthropic.com](https://console.anthropic.com/settings/keys). Note that **the
Anthropic API is prepaid and completely separate from a Claude subscription** — a key
alone won't work until the account has credit. Roughly ½–2¢ per question depending on
the model; set a spend limit while you're in there.

Either way the key lives on the device, never in the repo, and never in the synced
progress — `npm test` asserts the last one. The mentor knows which day you're on, what
today's theory said, and what the task is, and it will not write that task for you, by
construction of its system prompt.

## Adding a day

Two files per day, and the app is a build artifact of them:

```
milestones/<milestone>/lessons/
  week.yaml                     week roster: titles, teasers, order, teach-back
  day-NN-<slug>.md              theory + task     (## Theory, ## Task, ## Quiz)
  day-NN-<slug>.quiz.yaml       the answer key    (kept out of the .md on purpose)
```

The `.md` stays greppable and reviewable in git and never contains a correct answer.
Write the options in whatever order is natural — the build shuffles them
deterministically per question, so authoring the right answer first (which is what
everyone does) can't turn into a pattern the learner spots instead of thinking.
`## Task` is parsed by convention — `- File: \`path\``, `- Compile: \`cmd\``, and a
`### Checklist` of `- [ ]` items become structured UI; everything else stays prose.

A day listed in `week.yaml` with no `.md` yet shows on the map as a locked, titled
step, so the path reads whole while lessons are still written one at a time.

Then:

```bash
npm run content   # regenerate; warns about missing "why" text, bad option counts, drift
git commit && git push
```

The app notices the new `contentHash` on its next launch. New weeks are offered with a
**Load week** button; a changed hash on a week you already hold refreshes silently and
keeps your progress, because that's a typo fix, not new work.

## Shape of it

```
src/
  lib/      types · storage (IndexedDB) · content fetch · streak · xp · badges
            markdown (marked + highlight.js) · router · app.svelte.ts (the store)
            cloud (gist sync) · merge · mentor (Anthropic stream) · chat.svelte.ts
  screens/  Today · Session (Theory→Quiz→Task) · WeekMap · Stats · Mentor · Settings
  components/
scripts/    build-content.mjs · gen-icons.mjs · test-{streak,merge,markdown}.mjs
public/content/   generated — never hand-edit
```

Svelte 5 + Vite + `vite-plugin-pwa`. No backend, and none of the three network
dependencies needs one: content is static files on the same origin, sync is the GitHub
API, and the mentor is the Anthropic API — all called straight from the browser.

Progress lives in IndexedDB, which iOS will evict from a web app it decides is idle.
Sync is the answer to that; the export button is the answer to sync being off.
