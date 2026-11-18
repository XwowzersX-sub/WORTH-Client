# WORTH Client

The standalone browser client for **WORTH**, a 3D arena-sport prototype built with Three.js.

## Play

After enabling GitHub Pages with the included Actions workflow:

https://xwowzersx-sub.github.io/WORTH-Client/

## Deploy to GitHub Pages

1. In this repository, open **Settings → Pages**.
2. Set the build and deployment source to **GitHub Actions**.
3. Push to `main`; `.github/workflows/pages.yml` publishes the repository root.

## Configure the multiplayer server

Edit `config.js` and set `serverUrl` to the base HTTPS URL for the WORTH Render service, without a trailing slash or `/ws`. For example:

```js
serverUrl: "https://your-worth-server.onrender.com"
```

The client converts that base URL to a secure WebSocket URL automatically and checks `/health` first to wake a sleeping Render service. The initial value is blank, so online matchmaking will remain disabled until you deploy WORTH-Server and put its HTTPS URL here. Two players must choose the same arena and mode to be matched.

The Supabase URL and publishable key in `config.js` are public browser settings. **Never put a Supabase secret/service-role key in this repository.**

## Controls

- **WASD**: Move
- **Mouse**: Captured on entering the Atrium; move to turn the shoulder camera
- **Hold right mouse button**: Switch to the helmet-mounted focus camera; match simulation slows to 38% speed for both players
- **Shift**: Sprint while moving; stamina drains while sprinting and regenerates when released
- **Space**: Jump
- **Ctrl while moving**: Forward roll with a speed boost
- **Ctrl while standing still**: Crouch
- **E**: Interact with the contract board or a PvP pad
- **Esc**: Open settings; press Esc again to close them

## Features

- Animated character movement, idle breathing, jump/fall, landing and roll poses
- Helmet-mounted focus camera, shoulder-follow camera and focus reticle
- WORTH Atrium lobby, contract board and five arena maps
- Loadout and Addition match presets
- Local practice and WebSocket matchmaking
- Supabase account sign-in and persistent player progress

WORTH is a nonviolent arena sport focused on checkpoint racing and central-zone control.
