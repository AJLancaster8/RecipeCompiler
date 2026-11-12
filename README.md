# Recipe Compiler

An Expo app for saving recipes and compiling several into one timed cooking plan. Recipes live on a small Node server; plans stay on the device.

## Run it

```bash
npm install
npm run server   # recipe server on port 3000 (needs Node 22.5+), data in server/data
npm start        # Expo dev server
```

The app looks for the server on the same computer as the Expo dev server. To use another server, set `EXPO_PUBLIC_API_URL=http://<host>:3000` in a `.env` file.

The first account to register becomes an admin (admins can edit or delete any recipe). Promote another account with:

```bash
npm run make-admin -- <username>
```
