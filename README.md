# JustPoint

A content change request tool for the MammaCare site. Site owners browse a
live page inside the app, right-click an element, and file a request for the
new copy; developers see it instantly with numbered pins on the page, and
reply or mark it done/closed. Everything syncs live through Firebase.

It's a static site — no build step, no bundler. Open `index.html` directly or
serve the folder with any static file server.

## Project structure

```
index.html              Markup shell — login screen + app layout
css/
  styles.css            All styles
js/
  app.js                App logic: auth, Firestore sync, rendering, page loading
  firebase-config.js    Firebase project config + the email→name/role user map
  inspector.js          Script injected into every loaded page (pins, right-click capture)
test/
  inspector.test.mjs    Playwright regression test for the injected inspector
  fixture.html          Static page the test drives
```

> **inspector.js authoring note:** the inspector is written as a real
> function and serialized to source with `Function.prototype.toString()` at
> the bottom of the file, then injected into the sandboxed iframe as inline
> script text. Keep it self-contained (no imports, no closure over module
> scope) and don't add a minifier without revisiting how it's injected.

## Setup

1. Create a Firebase project (or reuse one) with **Authentication →
   Email/Password** enabled and **Firestore** created.
2. Open `js/firebase-config.js` and paste your project's config into
   `FIREBASE_CONFIG` (Firebase console → Project settings → Your apps → Web
   app → Config).
3. In the same file, add each teammate's login email to `USERS`, with a
   display name and a role:
   - `"owner"` — files change requests (site owners/content editors)
   - `"dev"` — implements them, can mark requests done/closed, and manages
     the list of pages shown in the dropdown
   - Anyone signed in but not listed here defaults to `"owner"`.
4. Create accounts for those emails in Firebase Authentication (Email/Password
   sign-in). Accounts aren't self-service — an admin creates them in the
   Firebase console.
5. Firestore holds two collections, both created automatically on first use:
   - `requests` — the change requests
   - `pages` — the list of pages shown in the dropdown (seeded once from a
     default list the first time a signed-in user loads the app)

## Tests

The app itself has no build step, but the injected inspector has a
Playwright regression test (it runs the real inspector inside a sandboxed
iframe and drives it through its message protocol):

```
npm install
npx playwright install chromium
npm test
```

## Deploying

Push `index.html`, `css/`, and `js/` to any static host (GitHub Pages,
Netlify, Firebase Hosting, etc.) — no build step required.
