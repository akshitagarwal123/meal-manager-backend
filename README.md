# Meal Manager Backend

This is a Node.js backend for the Meal Manager app using Express.js.

## Getting Started

1. Install dependencies:
   ```bash
   npm install
   ```
2. Start the server:
   ```bash
   npm start
   ```
3. For development with auto-reload:
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

- `GET /` - Health check
- `GET /meals` - Returns a list of meals (currently empty)

## Project Structure
- `index.js` - Main server file
- `package.json` - Project metadata and dependencies

## License
ISC
