# Little Paths

Turn a Google Timeline export into a soft, animated map of where you went.

Pick a single day or a range of days, press play, and watch the route draw itself
as a fading trail across a muted hand-restyled map. Built for making quiet,
personal keepsake maps rather than dashboards.

## Privacy

Your Timeline file never leaves your browser. It is read with the File API,
parsed in memory, and drawn locally. There is no backend, no database, no
account, and nothing is uploaded anywhere. The only network requests the page
makes are for map tiles, the map library, and fonts.

This repository contains no location data of any kind.

## Features

- **Day mode** with a time-of-day window, labelled stops, and walk / ride styling
- **Range mode** spanning weeks, months, or years of days at once
- **Comet trail** that fades behind the playhead and resets at each day boundary
- **Equal time per day**, so a densely recorded day does not hog the timeline
- **Per-day camera framing** in range mode, easing once per day rather than
  chasing every point
- **Playback length presets** from 15 seconds to 6 minutes, plus an automatic
  setting that scales with the span
- **Clean view** for screenshots, hiding all controls

## Getting your Timeline file

On Android: Settings, then Location, then Location Services, then Timeline, then
Export Timeline Data. You will get a `Timeline.json`. Import it with the button
in the top right.

Large exports are parsed entirely in memory, so a multi-hundred-megabyte file
may struggle on a phone. Desktop is recommended.

## Running locally

```bash
pnpm install
pnpm dev
```

Then open http://localhost:3000. On Windows, `launch-studio.ps1` does both steps.

## Building

```bash
pnpm build      # static export to out/, used by GitHub Pages
```

The site is fully static. Deployment to GitHub Pages happens automatically on
push to `main` via `.github/workflows/deploy.yml`.

A Cloudflare Workers build is also still wired up via `pnpm build:cloudflare`,
left over from how the project was scaffolded. It is not used by the Pages
deployment.

## Credits

Inspired by [mahlernim/google-timeline-visualizer](https://github.com/mahlernim/google-timeline-visualizer),
an Android app that renders Timeline data as MP4 travel videos. This is a
browser-based reinterpretation with a different emphasis: live playback and
visual styling rather than video export.

Map tiles by [OpenFreeMap](https://openfreemap.org), data by
[OpenStreetMap](https://www.openstreetmap.org/copyright) contributors.
Rendering by [MapLibre GL](https://maplibre.org).
