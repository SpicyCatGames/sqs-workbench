# AWS Workbench

A **browser-only** web console for managing AWS services (SQS queues, SNS topics, subscriptions, SMS and S3 buckets) on local
emulators or real AWS. There is no backend: the app talks to the AWS HTTP APIs directly from your browser, so it can
be hosted as plain static files anywhere.

The S3 console covers the full object workflow: bucket CRUD, folder navigation, uploads with progress (multipart for
large files), downloads, copy/rename, delete (single and batch), object preview, object tags and ACLs, object
versioning, bucket properties (versioning, encryption, tags) and permissions (access policy, CORS, block public access).

## Build

```bash
cd frontend
npm install
npm run build
```

This outputs the entire app as plain static files in `frontend/dist/` — `index.html` plus hashed assets. The app uses
hash-based routing, so deep links and refreshes work on any static host without rewrite rules.

## Run the static build

Serve `frontend/dist` with the bundled zero-dependency server:

```bash
node scripts/serve-static.mjs
# -> http://localhost:8080
```

Options:

```bash
node scripts/serve-static.mjs 3000        # serve on a specific port
node scripts/serve-static.mjs 8080 dist   # custom port and directory
PORT=8080 node scripts/serve-static.mjs
```

Open the printed URL, then click the **Settings** gear in the top right and point the app at your AWS endpoint
(default: `http://localhost:4566`).

Any other static file server works too (e.g. `npx serve dist`), since the build uses relative asset paths and hash
routing.

## Development

```bash
cd frontend
npm install
npm run dev
# dev server on http://localhost:3000 with hot reload
```

## Project layout

```
frontend/                 React + TypeScript + Vite app (the entire product)
frontend/dist/            Static build output — host this anywhere
scripts/serve-static.mjs  Tiny zero-dependency static file server for frontend/dist
scripts/cors-proxy.mjs    Optional CORS bridge for emulators without CORS support
docker-compose.yml        Local emulator + optional CORS bridge for local testing
```
