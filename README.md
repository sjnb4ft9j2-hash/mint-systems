# Mint Systems app — setup

## 1. Create the Firebase project
1. Go to console.firebase.google.com and tap **Create a project** (name it e.g. `mint-systems`). Google Analytics is not needed.
2. **Build → Firestore Database → Create database.** Pick a location close to you (e.g. `nam5` / us-east) and start in **production mode**.
3. **Build → Authentication → Get started → Email/Password → Enable → Save.**
4. **Authentication → Users → Add user**: add an email + password for yourself and each staff member.

## 2. Lock down the data
**Firestore Database → Rules**: replace everything with the contents of `firestore.rules`, put your staff emails in the list (lowercase), and tap **Publish**.

## 3. Get your config
**Project settings (gear icon) → General → Your apps → Web (`</>`)** → register an app (no hosting needed). Copy the `firebaseConfig = { ... }` block.
Either paste it into `app.js` where it says `const FIREBASE_CONFIG = null;` (replace `null` with the `{ ... }` part), or paste it into the app's setup screen the first time it opens (that only saves it on that one device).

## 4. Put the app online (free, from your phone) — GitHub Pages
1. Unzip `mint-systems-app.zip` in the Files app (tap it).
2. On github.com (sign up free): **New repository** → name `mint-systems` → **Public** → Create.
3. **Add file → Upload files** → select every file from the unzipped folder → **Commit changes**.
4. **Settings → Pages → Branch: main, folder: / (root) → Save.** After a minute your app is at `https://YOUR-USERNAME.github.io/mint-systems/`.
5. Back in Firebase: **Authentication → Settings → Authorized domains → Add domain** → `YOUR-USERNAME.github.io`.

The code being public is fine: nobody can see or change sales without a staff login.

## 5. Install on each iPhone
Open the link in **Safari** → **Share** → **Add to Home Screen**. Sign in once.

## Updating later
Upload the changed files to GitHub again. In `sw.js`, bump `mint-v1` to `mint-v2` etc. so phones pick up the new version.

## Files
- `index.html`, `app.js` — the app
- `sw.js`, `manifest.json`, icons — home-screen + offline support
- `firestore.rules` — who's allowed in
