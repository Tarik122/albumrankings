# Setup

Everything here needs a browser and your accounts, so these are the steps I
can't do for you.

**You do not need a computer.** All four dashboards (Firebase, Spotify, GitHub,
and the app itself) work in Safari on an iPad, and GitHub Actions does the build
— nothing is compiled locally. Follow **Part A**. Part B is optional and only
matters if you later want to run the app on a laptop.

About 30 minutes.

---

# Part A — the browser-only path

The ordering here matters, and it's different from what you might expect. You
need your Firebase UID to lock the database, but you can only see that UID by
signing in to the deployed app. So the app gets deployed *first*, in a state
where it can't read anything, and gets locked down in step 6.

That gap is safe: Firestore in production mode denies every request until you
publish a rule saying otherwise. The app will show a permissions error until
step 6, and that error is the database working correctly.

## 1. Check your Spotify account is Premium (1 min)

Under Spotify's current Developer Mode rules, the endpoints this app uses won't
work on a free account. Open <https://www.spotify.com/account/overview/> and
confirm it says Premium.

If it doesn't, everything except the Spotify import still works — manual album
entry, comparisons, the leaderboard. You'd just be typing albums in by hand.

## 2. Create the Firebase project (5 min)

At <https://console.firebase.google.com/> — the console is usable on an iPad,
though it's cramped; landscape helps.

1. **Add project.** Name it anything. Turn Google Analytics off; it's not used.
2. **Build → Firestore Database → Create database.**
   - **Start in production mode.** This is what makes the deploy-first ordering
     safe — production mode denies everything until you publish your own rules.
   - Pick the region closest to you. This cannot be changed later.
3. **Build → Authentication → Get started → Google → Enable.** Set yourself as
   the support email. Save.
4. **Project settings** (gear icon) **→ Your apps →** the web icon `</>`.
   Register with any nickname. Do **not** check "Firebase Hosting" — this
   deploys to GitHub Pages.
5. You'll be shown a `firebaseConfig` block with six values. You need these in
   step 4. On an iPad, screenshot it or leave the tab open — they're also always
   available again from this same Project settings page.

## 3. Get the code onto `main` (2 min)

The code is on the branch `claude/album-ranker-app-32nqxq`. The deploy workflow
only runs on `main`, so it needs merging.

On github.com in Safari: open the repo → **Pull requests → New pull request** →
base `main`, compare `claude/album-ranker-app-32nqxq` → **Create** → **Merge**.

Or just ask me to do it and skip this step.

## 4. Configure and deploy (5 min)

All on github.com.

1. **Settings → Pages → Build and deployment → Source: GitHub Actions.**
2. **Settings → Secrets and variables → Actions →** the **Variables** tab →
   **New repository variable**, once for each:

   | Variable | Value |
   |---|---|
   | `VITE_FIREBASE_API_KEY` | from step 2.5 |
   | `VITE_FIREBASE_AUTH_DOMAIN` | from step 2.5 |
   | `VITE_FIREBASE_PROJECT_ID` | from step 2.5 |
   | `VITE_FIREBASE_STORAGE_BUCKET` | from step 2.5 |
   | `VITE_FIREBASE_MESSAGING_SENDER_ID` | from step 2.5 |
   | `VITE_FIREBASE_APP_ID` | from step 2.5 |

   Leave `VITE_OWNER_UID` and `VITE_SPOTIFY_CLIENT_ID` for later — you don't
   have those values yet.

   These are **variables, not secrets**. That isn't a shortcut: the built
   bundle contains them and anyone can read it. The protection is the Firestore
   rule in step 6, which is why that step exists.

3. **Actions** tab → the "Deploy to GitHub Pages" workflow → **Run workflow**.
   (Merging in step 3 may have already started one.) Wait for green.
4. **Firebase console → Authentication → Settings → Authorized domains → Add
   domain** → `<your-github-username>.github.io`. Google sign-in fails on the
   deployed site until this is done.

Your app is now at `https://<your-github-username>.github.io/albumrankings/`.

## 5. Sign in and get your UID (2 min)

Open the app on your iPad and tap **Sign in with Google**.

> **If Safari blocks the sign-in window**, that's iOS blocking popups.
> **Settings → Apps → Safari → Block Pop-ups → off**, then try again. The app
> uses a popup rather than a redirect deliberately — Safari's tracking
> prevention breaks Firebase's redirect flow when the app and the auth domain
> are different origins, which they always are on GitHub Pages.

Once in, expect a red error saying Firestore refused the request. **That is
correct** — you haven't granted yourself access yet.

Go to the **Settings** tab. Your **Firebase UID** is there. Tap **Copy UID**, or
tap the UID itself to select it.

## 6. Lock the database to your UID (5 min) — do this before adding any data

Two places need the UID.

**a. The Firestore rules.** Firebase console → **Firestore Database → Rules**.
The editor works fine on an iPad. Find this line:

```
return request.auth != null && request.auth.uid == 'OWNER_UID_HERE';
```

Replace `OWNER_UID_HERE` with your UID, keeping the quotes. **Publish.**

If the rules editor shows something other than the rules in this repo (a fresh
project starts with a deny-all default), copy the full contents of
`firestore.rules` from the repo on github.com and paste them in, then replace
the UID.

**b. The build.** github.com → **Settings → Secrets and variables → Actions →
Variables → New repository variable** → `VITE_OWNER_UID` = your UID. Then
**Actions → Deploy to GitHub Pages → Run workflow** to rebuild with it.

When the deploy finishes, reload the app. The error should be gone and the
Settings tab should say the database is locked to your account.

**Verify the lock actually holds.** Firebase console → **Firestore → Rules →
Rules Playground**. Simulate a `get` on
`/databases/(default)/documents/albums/anything`, authenticated, with a UID of
anything other than yours. It must come back **denied**. If it's allowed, the
rules didn't publish.

The rules also make the comparison log append-only — `update` and `delete` are
refused outright. That's deliberate: ratings are recomputed from that log, so a
silently edited entry would rewrite your history.

## 7. Register the Spotify app (5 min)

1. <https://developer.spotify.com/dashboard> → **Create app**.
2. Name and description: anything.
3. **Redirect URI** — add exactly:
   `https://<your-github-username>.github.io/albumrankings/`

   Character for character, trailing slash included. The app's **Settings** tab
   prints the exact URI it will send, and that value selects in one tap — check
   it against what you typed if you hit an `INVALID_CLIENT` error.
4. **Which API/SDKs are you planning to use?** → Web API.
5. Save, then **Settings → Basic Information** → copy the **Client ID**.
6. github.com → repository variable `VITE_SPOTIFY_CLIENT_ID` = that Client ID.
   Re-run the deploy workflow.
7. Back in the Spotify dashboard: **Settings → User Management** → add your own
   Spotify account (its email, and your display name). Under Developer Mode an
   app only works for accounts listed here — without this you get a 403.

Reload the app. The **Library** tab now offers **Connect Spotify**.

## 8. Done

Add a few albums (Library tab → search Spotify, or import your top albums), then
go to **Compare**. The ranking starts moving from the first vote.

---

# Part B — running it locally (optional)

Only if you want the app on a laptop as well. Skip entirely if you're on iPad.

```bash
npm install
cp .env.example .env.local   # fill in the same values as the repo variables
npm run dev
```

Open <http://127.0.0.1:5173/albumrankings/> — **127.0.0.1**, not `localhost`.
Spotify rejects `localhost` as a redirect URI, so the dev server binds to the
loopback IP to keep the two consistent.

To use Spotify locally, add a second redirect URI in the Spotify dashboard:
`http://127.0.0.1:5173/albumrankings/`

Run the tests with `npm test`.

---

# Troubleshooting

**"Missing or insufficient permissions"** — before step 6, this is expected.
After step 6, it means the rules didn't publish or the UID in them doesn't match
the account you're signed in as. Compare the Settings tab's UID against the
rules, character for character.

**Sign-in window blocked on iPad** — Settings → Apps → Safari → Block Pop-ups →
off.

**Google sign-in fails on the deployed site** — the domain isn't in Firebase's
authorized domains (step 4.4).

**Spotify 403** — your account isn't in the app's User Management list (step
7.7), or it isn't Premium (step 1).

**`INVALID_CLIENT: Invalid redirect URI`** — it doesn't match what's registered,
exactly. Trailing slashes count. Check the app's Settings tab for the URI it
actually sends.

**Blank page after deploying** — `base` in `vite.config.ts` doesn't match the
Pages path. It defaults to `/albumrankings/`; if your repo has a different name,
add a `VITE_BASE` repository variable set to `/<repo-name>/`.

**Using a custom domain** — set repository variable `VITE_BASE` to `/`, and
update both the Spotify redirect URI and the Firebase authorized domain.
