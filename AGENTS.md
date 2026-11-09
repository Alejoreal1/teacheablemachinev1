# AGENTS.md

## Project overview

**Vigía** is a single-screen kiosk app: the browser webcam runs a Teachable Machine image model
(`https://teachablemachine.withgoogle.com/models/GLcHeZx-M/`, labels `Alejo`, `Tigre`, `Nadie`),
greets the recognized person on screen and by voice, and logs each detection to a Google Sheet with
the columns `Fecha | Estación | Clase | Confianza | Modo | Foto`. UI copy is in Spanish.

Stack: TanStack Start + React 19, Tailwind 4 (theme vars in `src/styles.css`, dark only),
shadcn/ui components in `src/components/ui`, TensorFlow.js, Netlify Blobs, Google Apps Script.

## Architecture / key files

- `src/routes/index.tsx` — the whole kiosk screen: camera start, prediction loop (rAF throttled to
  150 ms, 50/50 smoothing), auto-registration logic (stable ≥ 1.2 s above threshold, per-class
  cooldown, never logs `Nadie`), manual button, voice greeting, session log. Settings persist in
  `localStorage` under `vigia:settings` (read inside `useEffect` to avoid hydration mismatch).
- `src/lib/classifier.ts` — loads the model with `tf.loadLayersModel` (no `@teachablemachine/image`
  dependency; it pins tfjs 1.x). Preprocessing mirrors Teachable Machine: horizontal flip, center
  square crop, resize to `imageSize`, normalize to [-1, 1]. `@tensorflow/tfjs` is imported
  dynamically so it never loads during SSR. Change `MODEL_URL` to swap models.
- `src/lib/apps-script.ts` — the Apps Script source the user pastes into their sheet. It creates
  the `Registros` tab + headers, appends rows, formats date/percent, and writes `=IMAGE(url)`.
- `src/components/sheets-setup-dialog.tsx` — step-by-step setup and connection test.
- `src/routes/api.registro.ts` — `POST` validates the row (zod), stores the JPEG in Blobs store
  `fotos`, then forwards the row to the Apps Script web app. `GET` reports whether
  `GOOGLE_SHEETS_WEBHOOK_URL` is set and (with `?url=`) tests a webhook via the script's `doGet`.
  Webhook URLs are restricted to `https://script.google.com` (env var wins over client value).
- `src/routes/api.foto.$id.ts` — serves stored photos publicly (UUID keys) so Google Sheets'
  `IMAGE()` can fetch them.

## Conventions

- Use theme variable classes, not raw colors; fonts: `font-display` (Bricolage Grotesque),
  `font-data` (IBM Plex Mono), body IBM Plex Sans (loaded in `__root.tsx`).
- Import from `src` via `@/`. TypeScript is strict; remove unused locals.
- No database: the Google Sheet is the system of record; Blobs only holds photo files.
- `src/routeTree.gen.ts` is generated; don't edit it.
