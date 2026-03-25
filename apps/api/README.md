# Todo App API

A NestJS backend service for managing todo items with external API integration.

## Features

- Todo CRUD operations
- Prometheus metrics & health checks
- Structured logging with correlation IDs
- Security middleware (rate limiting, CSRF protection)

## Prerequisites

Ensure you have the following installed:

- [Node.js](https://nodejs.org/) (v18+)
- [npm](https://www.npmjs.com/)

## Getting Started

### Install Dependencies

```bash
cd todo-app-api
npm install
```

### Environment Setup

Copy the example environment file and configure as needed:

```bash
cp .env.example .env
```

### Run Locally

```bash
# Development mode with hot reload
npm run start:dev

# Production mode
npm run start:prod
```

## API Endpoints

### Todo Operations

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/todos` | Fetch all todos |
| POST | `/todos` | Create a new todo |
| PATCH | `/todos/:id` | Update a todo's status |
| DELETE | `/todos/:id` | Delete a todo |

### System Endpoints

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/health` | Health check with memory stats |
| GET | `/metrics` | Prometheus metrics |

## Configuration

Environment variables:

| Variable | Description | Default |
|----------|-------------|---------|
| `NODE_ENV` | Environment mode | `development` |
| `PORT` | Server port | `3000` |
| `METRICS_PROVIDER` | Metrics backend (`local`/`grafana`) | `local` |
| `LOCAL_PUSHGATEWAY_URL` | Prometheus pushgateway URL | - |
| `FRONTEND_URL` | Frontend URL for CORS | - |

## Architecture

The API uses a layered architecture:

```
Controllers -> Services -> External API (dummyjson.com)
      |
      v
   Middleware (Metrics, Security)
```

## Logging

Structured JSON logging with:

- Correlation IDs for request tracing
- Memory usage stats on warnings/errors
- Separate error log file

## Deployment

### Local Kubernetes (DevSpace)

```bash
devspace dev
```

### Cloud (Render)

See [CLOUD_DEPLOYMENT.md](CLOUD_DEPLOYMENT.md) for cloud deployment instructions.
