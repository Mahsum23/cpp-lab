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

Settings → **Mentor chat** → paste an Anthropic API key
([console.anthropic.com](https://console.anthropic.com/settings/keys)). The Mentor tab
then answers in context: it knows which day you're on, what today's theory said, and
what the task is — and it will not write that task for you, by construction of its
system prompt. Model is switchable (Haiku / Sonnet / Opus) in the same section.

This is the one part of the app that isn't free: fractions of a cent per question,
billed to your own key. The key lives on the device; there's no server in between,
which is both why it's free to host and why the key has to be there.

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
