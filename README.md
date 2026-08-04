# SQS Workbench

A self-hosted web console for managing [Amazon SQS](https://aws.amazon.com/sqs/) queues — on local emulators
([floci](https://hub.docker.com/r/floci/floci), LocalStack, ElasticMQ) or real AWS.

- **Backend**: ASP.NET Core Web API (`.NET 10`) using the AWS SDK for .NET (`AWSSDK.SQS` 4.x).
- **Frontend**: React + TypeScript + Vite, built into `Api/wwwroot` and served as static files by the API — **no node server needed** in production.
- **Publishing**: multi-stage `Dockerfile` + GitHub Actions workflow that pushes to Docker Hub.

![stack](https://img.shields.io/badge/.NET-10-512BD4) ![stack](https://img.shields.io/badge/React-19-61DAFB) ![stack](https://img.shields.io/badge/AWS%20SDK%20for%20.NET-v4-FF9900)

## Features

- **Homepage** — lists every queue on the configured endpoint with live message counts, type (Standard/FIFO),
  visibility timeout and creation time. Row actions: **send message**, **purge**, **delete**; a search box filters by name.
- **Create queue dialog** — Standard or **FIFO queue** (with name validation), plus configurable visibility timeout,
  retention period, delivery delay, max message size, receive wait time and content-based deduplication.
- **Queue console (AWS-style)** — click any queue to open its detail page with tabs:
  - **Overview** — ARN, URL, timestamps, message metrics, redrive policy summary and more.
  - **Configuration** — edit visibility timeout, retention, delay, max size, wait time, content-based dedup, and
    configure a **dead-letter queue (redrive policy)** by picking an existing queue + max receive count, or remove it.
  - **Permissions** — view/edit the resource-based access policy (JSON).
  - **Tags** — add, edit and remove tags.
  - **Send / Receive messages** — send with message attributes, delay, and FIFO group/deduplication IDs; receive with
    polling controls, inspect system/message attributes, and delete (acknowledge) messages.
- **Settings** — the gear icon opens connection settings (AWS endpoint URL, region, access key, secret access key)
  with a **test connection** button. Settings are persisted server-side and take effect immediately.

## Quick start (from dockerhub)

```bash
docker run -d -p 5072:8080  spicycatgames/sqs-workbench:latest
```
Open <http://localhost:5072>.
In the top right corner, from the settings button, you can set the credentials.
If you're on windows, and emulator is running on another container, endpoint should be `host.docker.internal` instead of `localhost`.

## Quick start (with the floci emulator)

```bash
# one-command stack: floci (SQS) + the sqs workbench app on http://localhost:5072
docker compose up --build
```

Open <http://localhost:5072>.

## Run locally without Docker

Prerequisites: .NET 10 SDK, Node.js 20+.

```bash
# 1. Start an SQS emulator (optional) — e.g. floci
docker run -p 4566:4566 floci/floci:latest

# 2. Build the frontend into Api/wwwroot (only needed once / after UI changes)
cd frontend && npm install && npm run build && cd ..

# 3. Run the API (serves the SPA + the REST API)
cd Api && dotnet run
```

Open <http://localhost:5072>.

### Frontend development (hot reload)

```bash
cd frontend && npm run dev
```

Vite dev server runs on <http://localhost:5173> and proxies `/api` to the .NET API on `http://localhost:5072`.

## Configuration

Connection settings are resolved in this order (first wins):

1. Settings saved through the UI (stored in `Api/App_Data/settings.json` — never commit this file)
2. Environment variables: `AWS_ENDPOINT_URL`, `AWS_DEFAULT_REGION`/`AWS_REGION`, `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`
3. Defaults in `Api/appsettings.json` (`SqsSettings` section)

For local emulators any credentials work (e.g. `test` / `test`); for AWS use a real key pair with SQS permissions.

## REST API

| Method | Path | Description |
| --- | --- | --- |
| GET / PUT | `/api/settings` | Read / update connection settings |
| POST | `/api/settings/test` | Verify the connection (lists queues) |
| GET | `/api/queues?prefix=` | List queues with attributes |
| GET | `/api/queues/detail?name=` | Queue detail (URL, ARN, attributes) |
| POST | `/api/queues` | Create queue (Standard or FIFO) |
| DELETE | `/api/queues?url=` | Delete queue |
| POST | `/api/queues/purge` | Purge queue |
| GET / PUT | `/api/queues/attributes?url=` | Get / set queue attributes (visibility, redrive policy, policy, ...) |
| POST | `/api/queues/send-message` | Send a message |
| POST | `/api/queues/receive` | Receive messages |
| POST | `/api/queues/delete-message` | Delete (acknowledge) a message |
| GET / PUT | `/api/queues/tags?url=` | List / set tags |
| POST | `/api/queues/untag` | Remove tags |
| GET | `/api/health` | Liveness probe |

## Project layout

```
Api/                 ASP.NET Core Web API (endpoints, SQS service, settings store)
Api/wwwroot/         Built SPA (static files served by the API)
frontend/            React + TypeScript + Vite source
Dockerfile           Multi-stage build (Node → .NET publish → runtime)
docker-compose.yml   floci + sqs workbench app for local testing
.github/workflows/   Docker Hub publish pipeline
```
