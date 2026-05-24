# Distributed WebSocket Chat with Horizontal Scaling Support

A fault-tolerant, real-time chat application built on WebSockets, featuring horizontal scale-out capabilities for the backend instances.

## Architecture Overview

To ensure accurate message routing across multiple isolated WebSocket server instances, the system implements a **Publish/Subscribe (Pub/Sub)** pattern powered by Redis. Inbound HTTP and WebSocket traffic is balanced and reverse-proxied by Nginx.

- **Client (Frontend):** Clean, Native JavaScript (ES6+), HTML5, and CSS3. Served as static content directly by Nginx.
- **Backend Cluster:** Multiple independent Node.js instances compiled from TypeScript, synchronizing state via Redis Pub/Sub.
- **Database Layer:** PostgreSQL managed via Prisma ORM for persistent message history storage.

---

## Tech Stack

- **Runtime:** Node.js (v22)
- **Language:** TypeScript
- **Database:** PostgreSQL (v15)
- **ORM:** Prisma
- **Pub/Sub & Cache:** Redis (v7)
- **Proxy & Web Server:** Nginx (v1.25)
- **Orchestration:** Docker, Docker Compose

---

## Project Structure

```text
├── .env                  # Local environment variables
├── docker-compose.yml    # Docker multi-container orchestration configuration
├── nginx/
│   └── nginx.conf        # Reverse-proxy and web server routing rules
└── src/
    ├── client/           # Static frontend assets
    │   ├── index.html
    │   ├── index.js
    │   └── styles.css
    └── server/           # Backend source code (Node.js + TS)
        ├── prisma/       # Prisma DB schema and migrations
        ├── src/          # Event handlers, core services, and entry point
        ├── Dockerfile    # Multi-stage production build configuration
        ├── package.json
        └── tsconfig.json
```

## Quick Start (Docker)

### Prerequisites

- Installed and running [Docker Desktop](https://www.docker.com/products/docker-desktop/) with Docker Compose support.

### Deployment Steps

1. Clone the repository:

   ```bash
   git clone https://github.com/aacheblukov/distributed-websocket-chat.git
   cd distributed-websocket-chat
   ```

2. Spin up the infrastructure and scale the backend service horizontally to 2 independent instances:

   ```bash
   docker compose up --build --scale ws_server=2 -d
   ```

3. Verify the operational status of all containers:

   ```bash
   docker compose ps
   ```

   All listed containers (chat_nginx, chat_postgres, chat_redis, websockets-ws_server-1, websockets-ws_server-2) must display a status of Up / Healthy.

4. Launch the application in your browser:
   ```text
   http://localhost:8080
   ```

### Teardown and Cleanup

To safely stop application execution and tear down the isolated internal Docker network, run:

```bash
docker compose down
```

To wipe the entire stack along with the persistent PostgreSQL data volumes, append the -v flag:

```bash
docker compose down -v
```

## Core Engineering Highlights

- **Exponential Backoff Reconnection:** The frontend client implements a native progressive backoff routine to handle connection drops gracefully, preventing server flooding during re-establishment.
- **DOM Rendering Optimization:** Appending historical chat logs mitigates costly layout reflows by utilizing `insertAdjacentHTML` instead of volatile `innerHTML` rewrites.
- **Multi-stage Docker Builds:** The server production image is separated into an isolated build pipeline. The final runtime execution layer strips out all non-essential development configurations and `devDependencies`, ensuring a minimal attack surface and small image footprint.

## Known Limitations & Constraints

### 1. Environment Variables Synchronization

- **Issue:** Environment variables configured in the root `.env` file or within the `docker-compose.yml` stack are strictly evaluated at container runtime.
- **Constraint:** If changes are made to the database credentials, Redis network aliases, or server ports, a standard runtime restart (`docker compose restart`) will not apply the updates. A full teardown and configuration rebuild is required:
  ```bash
  docker compose down && docker compose up --build -d
  ```

### 2. Redis Stampede (Cache Stampede) Mitigation

- **Issue:** The application does not currently implement an active locking mechanism (e.g., Redlock) or probabilistic early expiration (XFetch algorithm) to prevent cache stampede.
- **Constraint:** Under heavy concurrent load, if the historical message cache expires or is invalidated in Redis, multiple scaled backend instances (`ws_server`) will simultaneously query the PostgreSQL database via Prisma. This can lead to temporary database connection pool exhaustion and increased latency.

### 3. Bare-Metal Execution Dependency

- **Issue:** Running the backend cluster locally on the host machine (e.g., via `npm start` or `npm run dev`) will immediately crash with a `connect ECONNREFUSED 127.0.0.1:6379` error if no local Redis instance is active.
- **Constraint:** The application does not bundle an embedded in-memory database. To develop or debug outside of full Docker containerization, you **must** have a Redis server running locally on your machine (either via native OS installation or by spinning up just the broker container using `docker compose up chat_redis -d`).
