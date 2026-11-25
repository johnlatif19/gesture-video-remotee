# Gesture Remote

## Structure
public/{camera,remote,login,dashboard,sign-in}.html + css/ + js/, server.js, package.json, vercel.json, .env

## Pages
- /sign-in create account → /login → /dashboard (upload and manage videos)
- /remote plays video and shows a 6-digit code.
- /camera pairs with code and opens camera.
- Gestures: fist = play, index up = rewind 5s, swipe right = forward 5s, open palm = pause.

## Setup
1. Firebase project (Spark) → Firestore (Native, production) → Project settings → Service accounts → Generate new private key. Put the JSON as a single line in FIREBASE_CONFIG.
2. Cloudinary free account → Cloud name, API Key, API Secret into CLOUDINRAY_* variables.
3. JWT_SECRET: long random string.
4. Deploy with `npx vercel --prod`, set the five env vars in Vercel.
5. Local: npm install, npm start, open http://localhost:3000.
6. Tests: npm test.

## Security
- User keys are stored as SHA-256 hashes of lowercased usernames.
- Passwords hashed with bcrypt, minimum 5 characters.
- JWT HS256 in an httpOnly cookie.
- Origin check on non-GET requests.
- CSP and security headers.
- Firestore rules: deny all browser access.
- Pairing code protected against brute force with DB-backed counters.
