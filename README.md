# Count Wise Backend (Mobile App)

Node.js (Express) + PostgreSQL backend for the **Count Wise** Expo app (student + mess manager).

## Getting Started

1. Install dependencies:
   ```bash
   npm install
   ```
2. Apply DB migrations (Postgres):
   ```bash
   psql "$DATABASE_URL" -f migrations/20251226_app_only_schema_updates.sql
   ```
3. Start the server:
   ```bash
   npm start
   ```
4. For development with auto-reload:
   ```bash
   npm run dev
   ```

## Using With Expo Go (Physical Phone)

If your mobile app runs in Expo Go on a real device, it cannot reach your backend via `http://localhost:3000`.

1. Start the backend bound to all interfaces:
   ```bash
   HOST=0.0.0.0 PORT=3000 npm start
   ```
2. In the mobile app, set the API base URL to your Mac's LAN IP:
   - Example: `http://192.168.1.23:3000`
   - Find your Mac IP (common): `ipconfig getifaddr en0`

## API Endpoints

- See `docs/API.md`

## What This Backend Supports (for now)
- Student OTP login + profile
- Hostel enrollment request + manager approval
- Weekly menu set by mess manager (`breakfast|lunch|snacks|dinner` + `holiday`)
- QR scan attendance + manager stats

## Project Structure
- `index.js` - Main server file
- `routes/` - Express route handlers
- `migrations/` - SQL migrations (manual apply)

## License
ISC
