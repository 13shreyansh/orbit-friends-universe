# Orbit — A universe of us

A prepared Friends memory universe built for the GPT-6 Astra Hackathon in Singapore.

Enter as any of six friends. Your perspective becomes the sun; the other friends appear as planets. Select a relationship, travel through the universe, and open a photo book curated for that pair. All fifteen pairs have distinct story collections.

## Run locally

```sh
npm install
python3 -m venv .venv
.venv/bin/pip install -e ./backend
PYTHONPATH=backend .venv/bin/python -m app.seed_friends
npm run dev
```

Seed the prepared demo from the project root with `PYTHONPATH=backend .venv/bin/python -m app.seed_friends`. The frontend and FastAPI backend run together through `npm run dev`. See backend/README.md for backend configuration. Real AI features require your own server-side API key; no credentials are included.

## Validation

`npm run build` and `node scripts/verify-friends-stories.mjs` pass for the demo. Browser verification covered entering as Ross, visiting Monica, turning photo-book pages, returning, and visiting Rachel.

## Credits

Adapted from [Distance](https://github.com/Yiyi-philosophy/distance), preserving its graph, planet-rendering, and comet-travel foundation. Astra in Codex was used to adapt the experience, simplify the demo flow, curate and correct relationship books, and test the journey. Original MIT license retained. Friends stills are demonstration reference material; source records are included with the photo assets.

This repository contains the prepared demo and backend source. Shared photo contribution is a further product direction, not represented as completed by the recording flow.
