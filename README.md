# AWS Workbench

A **browser-only** web console for managing AWS services (SQS queues, SNS topics, subscriptions, SMS, S3 buckets,
DynamoDB tables, Secrets Manager and Lambda functions) on local emulators or real AWS. There is no backend: the app
talks to the AWS HTTP APIs directly from your browser, so it can be hosted as plain static files anywhere.

The S3 console covers the full object workflow: bucket CRUD, folder navigation, uploads with progress (multipart for
large files), downloads, copy/rename, delete (single and batch), object preview, object tags and ACLs, object
versioning, bucket properties (versioning, encryption, tags) and permissions (access policy, CORS, block public access).

The Lambda console covers the function lifecycle: create functions from inline code (packaged to a .zip in the
browser), uploaded .zip files or S3 packages, deploy code updates, invoke tests with JSON events (RequestResponse /
Event / DryRun), edit configuration and environment variables, manage event source mappings, resource-based
permissions, published versions and aliases, and tags.

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

### Stopping / restarting the server

The server runs in the foreground, so press **`Ctrl+C`** in the terminal where it's running to stop it. Run the
`node scripts/serve-static.mjs` command again to restart it.

If the terminal is gone and the server is still running, kill it by port instead (bash on Windows):

```bash
netstat -ano | grep 8080          # find the PID listening on 8080
kill $(netstat -ano | grep 8080 | awk '{print $5}')  # or on Windows: taskkill //PID <pid> //F
```

> Note: the server does not watch the build directory — after rebuilding, restart it to pick up the new assets.

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
