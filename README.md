# Inkbound PDF Editor + Firebase

## What this package adds
- Email/password sign-in and sign-up pages
- Firebase Auth session persistence
- Per-user PDF export uploads to Firebase Storage
- Per-user metadata saved in Cloud Firestore
- Realtime community chat using Firestore listeners
- Responsive layout improvements for mobile

## Files to update in Firebase
1. Replace the placeholders in `firebase-config.js`
2. Turn on Email/Password authentication
3. Add your GitHub Pages domain to Firebase Auth authorized domains
4. Publish the Firestore and Storage rules in Firebase console

## How the data is stored
- `users/{uid}`: profile and last login data
- `users/{uid}/documents/{docId}`: PDF export metadata
- `communityMessages`: chat feed documents
- `users/{uid}/pdfs/...`: exported PDF binaries in Storage

## How it works
- Sign up or sign in from `signup.html` / `signin.html`
- After sign-in, the app redirects to `index.html`
- Exporting a PDF downloads it locally and also uploads it to Firebase when the user is signed in
- Community messages stream live for signed-in users

## Important note
Firebase Auth stores the signed-in session using auth state persistence on the device. That is the right approach for a GitHub Pages front end; you do not need your own server for login state.
