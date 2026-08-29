# Setup

Everything here needs a browser and your accounts, so these are the steps I
can't do for you. They're in dependency order — each one unblocks the next.

Times are rough. The whole thing is about 30 minutes.

---

## 1. Check your Spotify account is Premium (1 min)

Under Spotify's current Developer Mode rules, the endpoints this app uses won't
work on a free account. Open <https://www.spotify.com/account/overview/> and
confirm it says Premium.

If it doesn't, everything except the Spotify import still works — manual album
entry, comparisons, the leaderboard. You'd just be typing albums in by hand.

---

## 2. Create the Firebase project (5 min)

1. Go to <https://console.firebase.google.com/> → **Add project**. Name it
   whatever you like. Google Analytics is not needed — turn it off.
2. In the left sidebar: **Build → Firestore Database → Create database**.
   - Start in **production mode**. (We're replacing the rules in step 5 anyway,
     and test mode would leave the database world-writable in the meantime.)
   - Pick the region closest to you. This can't be changed later.
3. **Build → Authentication → Get started → Google → Enable**. Set yourself as
   the support email. Save.
4. **Project settings** (the gear, top left) → scroll to **Your apps** → click
   the web icon `</>`. Register the app with any nickname. Do **not** check
   "Firebase Hosting" — we're deploying to GitHub Pages.
5. You'll be shown a `firebaseConfig` object. Keep that tab open for step 4.

---

## 3. Create the GitHub repo (2 min)

If you haven't already — this code is currently on the branch
`claude/album-ranker-app-32nqxq` in `Tarik122/albumrankings`, so the repo likely
exists. If so, skip ahead.

Otherwise create it at <https://github.com/new>, public or private (Pages works
either way on a paid plan; public is required on free).

---

## 4. Wire up local config (2 min)

In the project directory:

```bash
cp .env.example .env.local
```

Fill in the Firebase values from the config object in step 2.5. Leave
`VITE_OWNER_UID` and `VITE_SPOTIFY_CLIENT_ID` blank for now.

Then:

```bash
npm install
npm run dev
```

Open <http://127.0.0.1:5173/albumrankings/> — note **127.0.0.1**, not
`localhost`. Spotify requires the loopback IP, so the dev server binds there to
keep the redirect URI consistent.

You should see the sign-in screen. Sign in with Google.

---

## 5. Lock the database to your account (5 min) — **do this before adding real data**

Right now anyone with a Google account could read and write your database. The
app shows a banner saying so.

1. In the running app, go to the **Settings** tab. Copy the **Firebase UID**
   shown there.
2. Paste it into `.env.local` as `VITE_OWNER_UID=...`
3. Open `firestore.rules` and replace `OWNER_UID_HERE` with the same UID.
4. Publish the rules. Either paste the file's contents into the Firebase console
   (**Firestore Database → Rules → Publish**), or from the CLI:

   ```bash
   npx firebase-tools login
   npx firebase-tools deploy --only firestore:rules --project <your-project-id>
   ```

5. Restart `npm run dev` so the new env var is picked up. The Settings tab
   should now say the database is locked to your account.

**Verify the lock actually works.** In the Firebase console, open
**Firestore → Rules → Rules Playground**, simulate a `get` on
`/databases/(default)/documents/albums/anything` while authenticated as some
other UID, and confirm it's **denied**. If it's allowed, the rules didn't
publish.

The rules also make the comparison log append-only — `update` and `delete` are
refused outright. That's deliberate: ratings are recomputed from that log, so a
silently edited entry would rewrite history.

---

## 6. Register the Spotify app (5 min)

1. Go to <https://developer.spotify.com/dashboard> → **Create app**.
2. Name and description: anything.
3. **Redirect URIs** — add *both* of these, exactly:
   - `http://127.0.0.1:5173/albumrankings/` (local development)
   - `https://<your-github-username>.github.io/albumrankings/` (deployed)

   These must match character for character, trailing slash included. Spotify
   rejects `localhost` — it has to be the loopback IP. The Settings tab in the
   app shows you the exact URI it will send, if you want to check.
4. **Which API/SDKs are you planning to use?** → Web API.
5. Save. Then **Settings → Basic Information** → copy the **Client ID** into
   `.env.local` as `VITE_SPOTIFY_CLIENT_ID=...`
6. **Settings → User Management** → add your own Spotify account (the email on
   the account, and your display name). Under Developer Mode, an app can only be
   used by accounts explicitly listed here — without this you'll get a 403.

Restart `npm run dev`. The Library tab should now offer "Connect Spotify".

---

## 7. Deploy to GitHub Pages (5 min)

The workflow in `.github/workflows/deploy.yml` builds and publishes on every
push to `main`.

1. **Repo Settings → Pages → Build and deployment → Source: GitHub Actions.**
2. **Repo Settings → Secrets and variables → Actions → Variables tab** → add
   each of these as a **repository variable** (not a secret — they're public
   values, and secrets aren't available to the build in the way we need):

   | Variable | Value |
   |---|---|
   | `VITE_FIREBASE_API_KEY` | from step 2.5 |
   | `VITE_FIREBASE_AUTH_DOMAIN` | from step 2.5 |
   | `VITE_FIREBASE_PROJECT_ID` | from step 2.5 |
   | `VITE_FIREBASE_STORAGE_BUCKET` | from step 2.5 |
   | `VITE_FIREBASE_MESSAGING_SENDER_ID` | from step 2.5 |
   | `VITE_FIREBASE_APP_ID` | from step 2.5 |
   | `VITE_OWNER_UID` | from step 5.1 |
   | `VITE_SPOTIFY_CLIENT_ID` | from step 6.5 |

   Calling these public isn't a shortcut — the built bundle contains them, and
   anyone can read it. The protection is the Firestore rule from step 5, which
   is why that step comes first.

3. Push to `main`. Watch the run under the **Actions** tab.
4. **Firebase console → Authentication → Settings → Authorized domains** → add
   `<your-github-username>.github.io`. Google sign-in will fail on the deployed
   site until you do.

Your app is at `https://<your-github-username>.github.io/albumrankings/`.

### If you use a custom domain

Add a repository variable `VITE_BASE` with the value `/`, and update the Spotify
redirect URI and Firebase authorized domain to match.

---

## Troubleshooting

**"Missing or insufficient permissions"** — the rules didn't publish, or the UID
in them doesn't match the account you're signed in as. Check both.

**Spotify 403** — your account isn't in the app's User Management list (step
6.6), or it isn't Premium (step 1).

**`INVALID_CLIENT: Invalid redirect URI`** — the URI doesn't match what's
registered, exactly. Check the Settings tab for the URI the app actually sends.
Trailing slashes count. `localhost` is not `127.0.0.1`.

**Google sign-in popup closes immediately on the deployed site** — the domain
isn't in Firebase's authorized domains (step 7.4).

**Blank page after deploying** — `base` in `vite.config.ts` doesn't match the
Pages path. It defaults to `/albumrankings/`; if your repo has a different name,
set the `VITE_BASE` repository variable to `/<repo-name>/`.
