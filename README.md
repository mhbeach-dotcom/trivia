# Arena Trivia

Mobile-friendly Hunger Games trivia across all five books (spoilers included).

- **Single player:** Quick Play, Survival, Marathon and a Daily Reaping, with lifelines, streaks and speed bonuses.
- **Multiplayer:** create a room, share the 4-character code (or invite link), and race friends on the same questions in real time (2-8 players). The host picks the question count, time limit and books; faster correct answers score more, with a live scoreboard and podium.
- Works in portrait and landscape, installs to the home screen, and saves scores on the device.

## Run locally

```bash
npm install
npm run build
npm start            # game + multiplayer server on http://localhost:4000
```

For development with hot reload, run the server and the Vite dev server together:

```bash
npm run dev:server   # terminal 1: multiplayer server on :4000
npm run dev          # terminal 2: Vite on :5173 (proxies /api and /socket.io to :4000)
```

To try multiplayer on one machine, open the game in separate browser profiles or private windows (each tab keeps its own player identity, so two tabs also work). To test with phones, open `http://<your-computer-ip>:4000` on each.

`npm test` runs the unit tests (game engine, scoring and the multiplayer room logic).

## How multiplayer works

Same pattern as Dinner Tinder: a small Node server (`server/`) with Express for lobby actions and Socket.IO for live events. Rooms live in memory (they're ephemeral; a restart ends them), and the server is the referee: it owns the timer, hides the answer until everyone has locked in or time runs out, and scores each round, so nobody can cheat from the client.

- `server/src/room.js`: pure game state for one room (tested in `tests/multiplayer.test.ts`)
- `server/src/controller.js`: rooms, timers and broadcasts
- `server/src/routes.js` / `index.js`: HTTP API and Socket.IO wiring; also serves the built game
- `src/mp/`: the client (network layer and screens)

The server reads the same `src/data/*.json` question files the game bundles.

## Deploying multiplayer

Multiplayer needs the Node server running somewhere; GitHub Pages alone can host single player only.

**Easiest: one Render service serves both the game and the server** (like Dinner Tinder). In Render choose **New > Blueprint**, point it at this repo, and apply (`render.yaml` is included). You get a URL such as `https://arena-trivia.onrender.com`; share that. Free tier notes: it sleeps after ~15 minutes idle, so the first request can take 30-60 seconds (the game shows "Waking the server up…"), and any live rooms are lost when it restarts.

**Keep the game on GitHub Pages and only run the server on Render:** deploy the Render service as above, then in this repo add an Actions variable named `MP_URL` (Settings > Secrets and variables > Actions > Variables) set to the Render URL, and re-run the Pages deploy. The Pages build then points its multiplayer at that server. Without `MP_URL`, the Multiplayer button on Pages explains that it isn't set up yet.
