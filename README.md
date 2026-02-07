# AI Summarizer

React + Vite frontend with a Node/Express API and MongoDB for storing saved summaries.

## Prerequisites

- Docker 24+
- Docker Compose v2 (`docker compose` CLI)
- Google Gemini API key for client-side summarization requests

## Quick Start (Docker)

1. Duplicate `.env.example` to `.env` and fill in:
	 - `VITE_GEMINI_API_KEY` – Gemini API key exposed to the browser
	 - `JWT_SECRET` – strong secret used by the backend for JWT signing
	 - Optional: adjust `VITE_API_URL` (defaults to `http://localhost:5000/api`) or `CORS_ORIGINS`
2. Build and start the stack:
	 ```bash
	 docker compose --env-file .env up --build
	 ```
3. Open the app at http://localhost:4173 (frontend) and the API at http://localhost:5000/api/health.

## Services

- **frontend** – static bundle served by Nginx (port 4173)
- **backend** – Express API using the provided JWT secret (port 5000)
- **mongo** – MongoDB 7 with a persisted `mongo-data` volume

## Common Tasks

- Rebuild after dependency changes:
	```bash
	docker compose --env-file .env up --build --force-recreate frontend backend
	```
- Stop and remove containers:
	```bash
	docker compose down
	```
- Wipe persisted Mongo data:
	```bash
	docker compose down -v
	```

## Local Development Without Docker

Install dependencies and run the services as usual:

```bash
npm install
npm run dev

cd backend
npm install
npm run dev
```

Ensure MongoDB is running locally and `VITE_API_URL` points at your backend.
