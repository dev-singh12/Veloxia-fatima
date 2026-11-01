# Fatima Veloxia 2K26 — Live House Scoreboard

Live house scoreboard for **Fatima, Carmel, Lourdes and Velankani** houses.

- **Offline-first.** Points are saved on the device instantly and the app opens with no internet after the first visit.
- **Online sync.** When there is internet, changes go to Supabase and every screen updates live.
- **Admin login.** Anyone with the link can view; only admins (Supabase email + password) can add, edit or delete points.
- **Big-screen display.** Open `/?display=1` on the projector for a clean, read-only view.
- **No Supabase settings?** The app runs in local-only offline mode, exactly like the original single-file scoreboard.

## Project layout

```
public/                  ← the website Vercel serves
  index.html             page (design from fatima_veloxia_2k26_offline_scoreboard.html)
  css/styles.css         design styles
  js/app.js              scoreboard logic, offline queue, Supabase sync, admin login
  js/vendor/supabase.js  Supabase client 2.117.2 (bundled so it works offline)
  js/config.js           GENERATED at build time from env vars (not committed)
  sw.js                  offline support (service worker)
  manifest.webmanifest   "Install app" support
  assets/, icons/        logo, header art, app icons
scripts/write-config.mjs builds js/config.js from SUPABASE_URL + SUPABASE_PUBLISHABLE_KEY
scripts/serve.mjs        local test server (no dependencies)
supabase/migrations/     database table, admin-only write rules, realtime
vercel.json              Vercel build + headers
```

## 1. Run it locally

Needs Node.js 18+.

```bash
npm run dev
```

Open http://localhost:3000. Without a `.env.local` file it runs in local-only offline mode.

To connect Supabase locally:

```bash
cp .env.example .env.local     # then put your project URL and publishable key in it
npm run dev
```

## 2. Supabase

```bash
npx supabase login
npx supabase link --project-ref YOUR_PROJECT_REF
npx supabase db push
```

Then create the admin login in **Authentication → Users → Add user** (tick **Auto Confirm User**), using the email listed in the migration (`ptadmin@fatimaschool.in`), and turn off **Allow new users to sign up**.

More admins: create the user, then run in the SQL Editor:

```sql
insert into public.admins (email) values ('teacher@example.com');
```

## 3. Vercel

Import the GitHub repo at vercel.com/new and add two environment variables before deploying:

| Name | Value |
| --- | --- |
| `SUPABASE_URL` | `https://YOUR_PROJECT_REF.supabase.co` |
| `SUPABASE_PUBLISHABLE_KEY` | publishable key (`sb_publishable_…`) or legacy anon key |

`vercel.json` already sets the build (`npm run build`) and output folder (`public`). The build refuses to run if a secret / service_role key is supplied by mistake.

## How offline sync works

1. An admin logs in once while online. The login stays on that device.
2. Every change is written to the device first (`localStorage`), so the scoreboard updates instantly with or without internet.
3. Waiting changes are sent to Supabase in order as soon as the connection returns. The status line shows how many are waiting.
4. Other devices see offline changes only after the admin’s device reconnects. For an event with no internet at all, connect the admin laptop to the projector.

Don’t clear browser data or use private/incognito mode on the admin device while changes are waiting.
