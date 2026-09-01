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
| `npm test` | Streak-rule tests — the one bit of logic subtle enough to earn them |
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

## Adding a day

Two files per day, and the app is a build artifact of them:

```
milestones/<milestone>/lessons/
  week.yaml                     week roster: titles, teasers, order, teach-back
  day-NN-<slug>.md              theory + task     (## Theory, ## Task, ## Quiz)
  day-NN-<slug>.quiz.yaml       the answer key    (kept out of the .md on purpose)
```

The `.md` stays greppable and reviewable in git and never contains a correct answer.
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
  screens/  Today · Session (Theory→Quiz→Task) · WeekMap · Stats · Settings
  components/
scripts/    build-content.mjs · gen-icons.mjs · test-streak.mjs
public/content/   generated — never hand-edit
```

Svelte 5 + Vite + `vite-plugin-pwa`. No backend. Progress lives in IndexedDB on the
one device, which is why Settings has an export button — iOS evicts storage from web
apps it decides are idle, and that export is the only real safety net.
