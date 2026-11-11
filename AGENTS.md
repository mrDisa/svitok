# AGENTS.md

## Tech Stack

- Static SPA: HTML5, CSS, browser JavaScript (ES2020); no framework, bundler, `package.json`, or lockfile.
- Hosting: GitHub Pages. PWA: `sw.js` + `manifest.webmanifest`.
- Data: local JSON (`data/`); PT Serif WOFF2; local art assets.
- Backend: Supabase Postgres/Auth/Storage/Edge Functions; SQL migrations in `supabase/migrations/`.
- Client library: local `vendor/supabase-2.45.4.js` (supabase-js 2.45.4).
- Edge runtime: Deno TypeScript; `jsr:@supabase/supabase-js@2`; notify also `npm:web-push@3.6.7`.
- Integrations: Telegram WebApp SDK loaded at runtime; Telegram bot Edge Function.

## Project Map

```text
index.html                 landing + SPA shell; script order
app.js                     app state, feed, Bible reader, UI routing
styles.css                 all landing/app/responsive styles
comments.js                verse discussions UI
social.js                  Supabase auth/profile/friends/state sync
tg.js                      Telegram Mini App bridge
reminders.js               notification UI
search.js | plans.js | onboarding.js
sw.js                      PWA cache/versioning
config.js                  public Supabase/VAPID config
data/                      feed, books, Bible JSON, paintings metadata
img/ | icons/ | fonts/     static assets
supabase/migrations/       Postgres schema, RLS, functions/triggers
supabase/functions/        `telegram/`, `notify/` Deno Edge Functions
tools/build_data.py        Bible data generator
README.md                  product/backend setup notes
```

## Commands

```bash
# Dev server (no build step)
python3 -m http.server 8321
# Open: http://localhost:8321/#app

# Client JavaScript syntax checks
node --check app.js
node --check comments.js
node --check social.js

# Whitespace/conflict check
git diff --check
```

- No configured build, linter, unit-test, or E2E-test command.
- Deploy static files by pushing `main`; apply Supabase migrations separately in Supabase SQL Editor/CLI.

## Code Conventions

- Plain global scripts; retain `index.html` script order. `comments.js` loads before `app.js` and calls app helpers only after startup.
- UI strings and comments are Russian; use `const` by default, `let` only for reassignment.
- Escape interpolated HTML with `esc()`; use `textContent` for asynchronously loaded text when practical.
- Persist device-only preferences through `store`/`S`; authenticated cross-device state belongs in `social.js`/Supabase.
- Use existing helpers (`$`, `$$`, `toast`, `openSheet`, `openTab`) instead of parallel UI primitives.

## Gotchas

- Bump `VERSION` in `sw.js` for every client release; add new shell files to `SHELL` or offline installs miss them.
- Static app deploy does **not** run SQL. Add ordered migration files; apply them after prerequisite migrations. Comments require `20261111120000_comments.sql` after social schema.
- Keep RLS, constraints, rate limits, moderation and notification generation server-side; client checks are UX only.
- `config.js` has public anon/VAPID values only. Never add Supabase service-role keys, Telegram tokens, webhook secrets, or VAPID private keys.
- Bible IDs use zero-based book indexes in UI, but persisted/comment `verse_key` book numbers are one-based (`book.chapter.verse`).
- Preserve `data/bible/*.json`, `data/feed.json`, and `img/art/` unless intentionally regenerating/replacing data/assets.
