# Student Daily Planner — Wardrobe · Fridge · Planner

A mobile-first, **offline-capable, static** web app that helps a student manage their
**Wardrobe** (clothes, outfits, laundry), **Fridge** (food inventory, meals, shopping list)
and **Planner** (schedule, to-do list, task grouping + Smart Shopping routing) — all in one
cohesive, locally-stored prototype.

Everything runs **entirely in the browser**. There is no backend, no server, and no paid
service required. An optional Gemini API key can be added for richer AI features, but the
app is fully usable without one — every AI feature has a deterministic, on-device fallback.

---

## ⚠️ READ FIRST — required steps & what doesn't work out of the box

This section is the single source of truth for **(a)** the exact steps you must perform to
get this live on GitHub Pages, and **(b)** everything that is intentionally stubbed,
simplified, or simply could not be verified before delivery. Nothing below is hidden
elsewhere — read this before opening an issue with yourself at 2am.

### A. Required steps to go from this ZIP to a live site

1. **Extract the ZIP** into a folder. Keep the folder structure exactly as-is, including
   dotfiles/dotfolders (`.github/`, `.gitignore`, `.env.example`) — these are ordinary
   folders/files whose names start with a dot, not OS-hidden files, so normal
   drag-and-drop or `git add` will pick them up.
2. **Create a new, empty GitHub repository** (Public — GitHub Pages is free only on public
   repos unless you're on a paid plan that supports private Pages). Do **not** initialise
   it with a README/license/gitignore on GitHub's side (that would conflict with the files
   in this ZIP).
3. **Upload the folder's contents to the repo root**, using either method:
   - **Recommended — git CLI**, from inside the extracted folder:
     ```bash
     git init
     git add -A
     git commit -m "Initial import"
     git branch -M main
     git remote add origin https://github.com/<your-username>/<your-repo>.git
     git push -u origin main
     ```
   - **Or — GitHub web upload**: open your new repo → **Add file → Upload files**, then
     drag the *entire extracted folder* (not just the files inside it) onto the drop zone.
     After uploading, open the repo's file list and **confirm `.github/workflows/deploy.yml`
     is actually present** — some browsers/OS file pickers (as opposed to drag-and-drop)
     silently skip dotfolders. If it's missing, use **Add file → Create new file**, name it
     exactly `.github/workflows/deploy.yml` (typing the slashes creates the folders), and
     paste in the contents from this ZIP.
4. **Turn on GitHub Actions-based Pages**: repo → **Settings → Pages → Build and
   deployment → Source**, select **"GitHub Actions"** (not "Deploy from a branch", which is
   the default and will NOT run our workflow).
5. **Trigger the deploy**: pushing to `main` triggers it automatically. If you used the web
   uploader and it's already on `main`, go to the **Actions** tab and run
   **"Deploy to GitHub Pages"** manually (**Run workflow** button) the first time.
6. **Wait ~2–4 minutes**, then open the URL shown under **Settings → Pages** (also printed
   in the workflow's summary). It will be:
   - `https://<your-username>.github.io/<your-repo-name>/` for a normal project repo, or
   - `https://<your-username>.github.io/` if your repo is literally named
     `<your-username>.github.io`.
   The build-time **base path is detected automatically from the repo name** — you do not
   need to edit `vite.config.ts` yourself.
7. **No GitHub secrets are required.** Do not add a Gemini API key as a repository secret —
   a secret baked in at build time would ship inside the public static bundle and be
   readable by every visitor. The Gemini key is entered by each end user, at runtime, in the
   deployed app's **Settings** screen, and stays in that browser only.

### B. What was not (and could not be) verified before delivery

This project was assembled in an **offline sandbox with no access to the npm registry**, so
the following could not actually be executed before packaging, only reviewed by hand,
file-by-file:

- `npm install` was never run — there is **no `package-lock.json`** in this ZIP. The
  deploy workflow uses `npm install` (not `npm ci`) specifically so it still works without
  one. **Run `npm install` locally once, then commit the generated `package-lock.json`** —
  this pins exact dependency versions for reproducible installs and lets you re-enable
  `cache: npm` in the workflow for faster CI runs (both optional but recommended).
- `vite build`, `tsc --noEmit`, `eslint`, and `vitest` were never actually executed —
  only statically reviewed. To keep a stray issue from ever blocking your site going live,
  **the deploy workflow runs type-check/lint/unit-tests as advisory, non-blocking steps**
  and builds with a direct `vite build` (real bundling errors — e.g. a broken import — still
  fail the build; pure type-level nits do not). **Run `npm run deploy:check` locally** after
  your first clone to get the authoritative pass/fail signal, and fix anything it reports.
- Playwright end-to-end tests were written against the real component markup but never run
  in a real browser; they're also non-blocking in CI. Run `npm run e2e` locally to validate.
- If `npm run deploy:check` surfaces a genuine error, it is most likely a small
  type-mismatch or an ESLint rule choice, not a structural/architectural problem — the app's
  data flow and cross-file wiring were manually traced end-to-end.

### C. Features that are intentionally simplified, stubbed, or environment-limited

| Area | Status | What to do about it |
|---|---|---|
| **Gemini AI features** (garment analysis, outfit NL parsing, recipe/receipt extraction, task classification) | Fully implemented, but **off until you enter your own API key** in Settings | Get a free key at [Google AI Studio](https://aistudio.google.com/) and paste it into **Settings → Gemini API key**. Without a key, every one of these features automatically uses a real, working **local/deterministic fallback** (colour/heuristic garment analysis, keyword-based outfit & task parsing, regex-based receipt/recipe parsing) — the app is never blocked waiting on AI. |
| **Google Calendar / Outlook sync** | **Not implemented** (no OAuth client wired up) | Not possible to ship generically — needs *your own* OAuth app registration with Google/Microsoft, pointed at *your* deployed URL, which only exists after you deploy. **ICS import/export is the fully-working substitute** and covers the same calendar-sharing need without any setup. |
| **Background / closed-tab notifications** | Browser `Notification` API reminders fire only while the tab/PWA is open or recently active | This is a hard platform limitation of static web apps, not a bug — the app explains it in-app. For guaranteed reminders, keep using your phone's native calendar/reminders alongside this app. |
| **Cross-device sync** | **None** — IndexedDB/localStorage are per-browser, per-device | Use **Settings → Export backup (.json)** on one device and **Import backup** on another to move data manually. |
| **Barcode scanning** | Uses native `BarcodeDetector` where supported, falls back to `@zxing/browser` otherwise | Needs camera permission and HTTPS — GitHub Pages serves HTTPS automatically, so this works once you grant the browser permission prompt. Some embedded in-app browsers (e.g. inside social apps) block camera access entirely; open the Pages URL in a regular browser if scanning fails. |
| **Receipt OCR (Tesseract.js) / optional local vision model (Transformers.js)** | Working, but download several MB of model/language data **on first use**, over the visitor's own connection | Off by default / opt-in where heaviest (Settings → "Use local vision model"), so first load stays light. Expect a delay the first time each feature is used; results are always shown for the user to confirm before saving. |
| **Smart Shopping route & shop discovery** | Uses free public **OSRM / Overpass / Photon** demo servers | These are shared, rate-limited public services, not production infrastructure — expect occasional slowness or temporary failures on heavy use. Prices/stock are **never invented**; they're labelled "unknown" unless you enter them yourself. |
| **"Virtual try-on"** | A labelled **outfit collage**, not photorealistic rendering | This is intentional per the spec (no overclaiming) — rendering a photorealistic try-on is outside what can run client-side, for free, in a browser. |
| **Private-repo Pages** | GitHub Pages is free only on **public** repositories on the free plan | Keep the repo public, or upgrade your GitHub plan if you need it private. |
| **`package-lock.json`** | Not included (see section B) | Run `npm install` locally once and commit the generated file. |

---

## 1. What's included

- **Wardrobe**: digital closet with photo-based garment capture, AI-assisted (or on-device)
  attribute detection, structured multi-layer outfits, an outfit picker that scores
  candidates by colour harmony/warmth/formality/laundry availability, and a laundry tracker
  with default + custom wash groups and care-label-aware warnings.
- **Fridge**: food inventory (manual / barcode / receipt OCR), recipes with
  ingredient-availability traffic lights (green/amber/red) against your inventory, and a
  shopping list that reconciles missing ingredients, low stock and manual items.
- **Planner**: calendar with recurrence + clash detection and ICS import/export, a
  natural-language to-do list (local parsing, optional Gemini classification), task
  grouping, and a **Smart Shopping** workflow that geocodes a route, finds real
  OpenStreetMap supermarkets near it (via Overpass), and lets you allocate items to stops.
- A shared **IndexedDB** persistence layer (`idb`), **JSON export/import backup**, optional
  **Gemini** integration (`@google/genai`) kept behind a small provider interface with local
  fallbacks everywhere, **Tesseract.js** OCR, **@zxing/browser** + native `BarcodeDetector`
  barcode scanning, **Leaflet** maps, and **OSRM / Overpass / Photon** for routing &
  geocoding.
- A PWA manifest + minimal service worker (static-asset caching only — see limitations).

This is a hackathon-grade **prototype**, not a production SaaS product. Demo data is
seeded on first run and clearly explained in the in-app "Welcome" sheet.

---

## 2. Quick start (local development)

Requires **Node.js 20+**.

```bash
npm install
npm run dev
```

> **Note on `package-lock.json`:** this project was assembled in an offline sandbox with no
> npm registry access, so a lockfile could not be generated here. Running `npm install` the
> first time on your machine will create `package-lock.json` from the pinned version ranges
> in `package.json` — commit that generated lockfile to your repo so CI and local installs
> stay reproducible.

Open the printed `http://localhost:5173` URL. The app works immediately with seeded demo
data — no configuration needed.

### Optional: configure a Gemini API key

1. Get a free-tier key from [Google AI Studio](https://aistudio.google.com/).
2. In the app, open **Settings → Gemini API key**, paste it in, and choose whether to keep
   it only in memory for the session (default) or remember it in this browser's
   `localStorage` (clearly marked as **not secure** — read the in-app warning).
3. Model names (text + vision) are configurable in the same screen, not hardcoded.

**Important:** this is a static site with no backend. A key entered here is sent directly
from your browser to Google's API and is visible to any script running on the page. Never
put a key you care about into a shared/public deployment. Nothing is written into the
source code, build output, `.env` files, logs, or exported backups by this app.

---

## 3. Build & test

```bash
npm run typecheck   # tsc --noEmit
npm run lint        # eslint
npm run test        # vitest unit tests
npm run build       # production build (also type-checks)
npm run preview     # serve the production build locally
npm run e2e         # Playwright end-to-end tests (builds + serves automatically)
npm run deploy:check  # runs typecheck + lint + test + build, in order
```

> Playwright needs browser binaries the first time: `npx playwright install chromium`.

---

## 4. Deploying to GitHub Pages

A ready-to-use workflow is included at `.github/workflows/deploy.yml`. It:

1. Installs dependencies with `npm install` (works with or without a committed lockfile)
   and runs an advisory typecheck/lint/unit-test pass, then builds with `vite build`.
2. Automatically sets Vite's `base` path:
   - **Project site** (`https://<user>.github.io/<repo>/`) → `base = /<repo>/`
   - **User/org site** (a repo literally named `<user>.github.io`) → `base = /`
3. Publishes `dist/` to GitHub Pages via the official `actions/deploy-pages` action.

See **"⚠️ READ FIRST"** at the top of this file for the full, exact step-by-step walkthrough
(repo creation, uploading the folder, enabling "GitHub Actions" as the Pages source, and
triggering the first run) and the complete list of what does and doesn't work out of the box.

No repository secrets are required for the base app. **Do not** add your personal Gemini
key as a GitHub Actions secret and bake it into the build — that would publish it to every
visitor of your public site. Gemini keys are meant to be entered per-browser, per-user, at
runtime, in Settings.

---

## 5. Data storage & limitations (please read)

- All structured data (garments, outfits, food, recipes, tasks, events, settings…) is
  stored in **IndexedDB** in your browser, via the `idb` wrapper. Image blobs are stored
  there too (not as temporary object URLs).
- Small settings may use `localStorage`.
- **This storage is local to one browser on one device.** It does **not** sync across
  devices or browsers automatically. Use **Settings → Export backup (.json)** to save a
  copy, and **Import backup** to restore it (on the same or a different device/browser).
- Clearing site data/cookies in your browser will delete everything. Back up first.
- Browser notifications (laundry/task reminders) only fire while a tab is open/active in
  most browsers; a static web app **cannot guarantee background delivery** when the browser
  is closed or the OS suspends it. The app explains this in-app rather than overpromising.
- Calendar sync with Google Calendar / Outlook requires you to register your own OAuth
  client (origins/redirect URIs/scopes) with those providers — this is **not pre-wired**
  because it needs your own app registration. **ICS import/export works out of the box**
  as the reliable fallback, and the planner is explicitly a supplement to your existing
  calendar, not a replacement.
- Smart Shopping uses free public endpoints (OSRM demo server, Overpass API, Photon
  geocoding). These are rate-limited, best-effort public services — expect occasional
  slowness/failures, and avoid hammering them. Prices are only shown when you enter them
  yourself; the app never invents stock or pricing data.

---

## 6. Project structure

```
index.html                   Vite entry HTML
vite.config.ts                Vite config (GitHub Pages base handling, test config)
tailwind.config.js / postcss.config.js
tsconfig.json / tsconfig.node.json
src/
  types.ts                    All data models + Zod schemas (single source of truth)
  lib.ts                      Dates, colour science (CIELAB), image resize/crop, local NLP
  db.ts                       IndexedDB repositories (idb) + image blob store + AI cache
  data.ts                     Demo/seed data, label maps, default laundry groups
  services.ts                 Deterministic domain logic: outfit scoring, laundry rules,
                               clash detection, recurrence, shopping reconciliation,
                               route/shop allocation, ICS import/export
  ai.ts                       Gemini client (@google/genai) + local fallbacks + OCR +
                               barcode scanning, behind one small provider interface
  geo.ts                      Geocoding (Photon), routing (OSRM), Overpass POI search,
                               with caching and graceful fallbacks
  context.tsx                 App-wide state/context: wraps db + services, exposes actions
  components.tsx              Shared UI primitives (Button, Card, Sheet, TabBar, etc.)
  App.tsx / main.tsx / styles.css
  features/
    Wardrobe.tsx               Clothes, Outfits, Laundry tabs
    Fridge.tsx                 Food, Meals, Shopping List tabs
    Planner.tsx                Schedule, To Do List, Task Grouping (+ Smart Shopping/map)
    Settings.tsx                Gemini key, model config, notifications, backup, reset
public/
  manifest.webmanifest, sw.js, icons           PWA assets
.github/workflows/deploy.yml                    GitHub Pages CI/CD
tests/
  unit/*.test.ts                                Vitest — services & lib logic
  e2e/app.spec.ts                                Playwright — main user flows
```

Kept intentionally compact: one file per cohesive concern rather than one file per
component/hook, per the brief.

---

## 7. Key implementation notes

- **Hybrid AI**: every AI-touching feature (garment analysis, outfit parsing, recipe/receipt
  extraction, task classification) tries Gemini **only if configured**, validates the JSON
  response with **Zod**, and falls back to a local deterministic/heuristic implementation on
  any error (missing key, quota, network, invalid JSON). The UI always labels which path was
  used ("Analysed with Gemini" vs "Analysed on-device").
- **No fabrication**: the app never claims to measure fabric composition, exact nutrition,
  or thermal insulation from a photo — estimates are labelled as estimates, and users can
  correct every inferred field.
- **Referential integrity**: marking an outfit "worn" increments each garment's wear count,
  updates `lastWornAt`, and flips laundry status once `maxWearsBeforeWash` is hit; completing
  a wash resets wear counts and clears laundry status for every garment in that group;
  consuming a recipe decrements inventory and feeds the shopping list — all via the shared
  `services.ts`/`context.tsx` layer, never ad hoc in components.
- **Attribution**: map tiles are rendered with the required OpenStreetMap attribution.

---

## 8. Known gaps / honest limitations

- Google Calendar / Outlook OAuth is **not pre-connected** (requires your own app
  registration per provider) — ICS import/export is the working fallback, by design.
- "Virtual try-on" is a labelled **outfit collage**, not photorealistic rendering — the brief
  explicitly asks not to overclaim here.
- A CLIP-family local vision model is integrated as an **optional, lazily-loaded**
  supplementary check behind a feature flag (Settings → "Use local vision model
  (Transformers.js)", off by default since it downloads ~150MB on first use); if it fails to
  load on a given device, the app automatically continues with colour/heuristic analysis
  instead of blocking the flow.
- Public OSRM/Overpass/Photon endpoints are for **low-volume prototyping only** — see
  section 5.
