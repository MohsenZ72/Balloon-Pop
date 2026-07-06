# Balloon Pop

WebAR balloon-popping game in the browser — no app install, no API key.
Built with React, Vite, TypeScript, Three.js, [8th Wall XR8](https://8thwall.org) face tracking, and MediaPipe hand tracking.

**Live demo:** [https://mohsenz72.github.io/Balloon-Pop/](https://mohsenz72.github.io/Balloon-Pop/)

## Play locally

```bash
npm install
npm run dev
```

Open the printed URL, allow camera access, tap **Start**, and pop balloons with your **index fingertip**. Avoid the dynamite.

## How it works

- Balloons and dynamite fall from above the screen.
- Touch balloons with your fingertip to pop them; touching dynamite ends the game.
- `src/hooks/useXR8Face.ts` runs the XR8 camera pipeline.
- `src/lib/arObjectModule.ts` handles balloons, physics, pops, and game flow.
- `src/components/FaceTracking.tsx` provides the start screen, score, and game-over UI.

## Deploy

Pushes to `main` deploy automatically to GitHub Pages via `.github/workflows/deploy.yml`.

```bash
npm run build
```

## Docs

- [docs/03-needle-pop-game-upgrade.md](docs/03-needle-pop-game-upgrade.md) — game feature plan
- [docs/02-how-it-works.md](docs/02-how-it-works.md) — architecture overview
- [docs/01-8thwall-face-tracking-plan.md](docs/01-8thwall-face-tracking-plan.md) — original AR setup plan
