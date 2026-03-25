# Local Monitoring Setup

This guide explains how to set up and use local monitoring for the Todo App API during development.

## Overview

The Todo App uses Prometheus for monitoring metrics during both local development and when deployed to the cloud. For logging, we use file-based logs locally and Grafana Loki when deployed to the cloud.

## Prerequisites

- Docker and Docker Compose installed
- The todo-app-ops repository cloned (contains the monitoring setup)

## Setting Up Local Monitoring

1. Navigate to the todo-app-ops repository:
   ```
   cd ../todo-app-ops/docker/local-monitoring
   ```

2. Start the local monitoring stack:
   ```
   docker-compose up -d
   ```

This starts:
- **Prometheus** - Metrics database (accessible at http://localhost:9090)
- **Grafana** - Visualization platform (accessible at http://localhost:3030)
- **Loki** - Log aggregator (can be used for local log viewing)

## Configuring Prometheus to Scrape the API

Prometheus needs to be configured to scrape metrics from the Todo API's `/metrics` endpoint. The API exposes a metrics endpoint at:

- Local development: `http://localhost:3000/api/metrics`
- When using Docker: `http://todo-api:3000/api/metrics` 

Update your Prometheus configuration in the todo-app-ops repository:

1. Edit the Prometheus configuration file:
   ```
   cd ../todo-app-ops/helm/monitoring
   ```

2. Make sure your scrape_configs section includes a job for the todo-api:
   ```yaml
   scrape_configs:
     - job_name: 'todo-api'
       metrics_path: '/api/metrics'
       scrape_interval: 15s
       static_configs:
         - targets: ['localhost:3000']  # For local development
   ```

3. For Kubernetes, use appropriate service discovery:
   ```yaml
   scrape_configs:
     - job_name: 'todo-api'
       metrics_path: '/api/metrics'
       kubernetes_sd_configs:
         - role: endpoints
       relabel_configs:
         - source_labels: [__meta_kubernetes_service_name]
           action: keep
           regex: todo-app-api
   ```

## Configuring the Todo App API

1. Copy the example environment file in the todo-app-api directory:
   ```
   cp .env.example .env
   ```

2. Start the API service:
   ```
   npm run start:dev
   ```

3. Verify the metrics endpoint is accessible at:
   ```
   http://localhost:3000/api/metrics
   ```

## Accessing Monitoring Dashboards

1. **Grafana Dashboard**: Open http://localhost:3030 in your browser
   - Default credentials: admin/admin
   - The Todo App dashboard should be available in the dashboard list

2. **Prometheus**: Open http://localhost:9090 in your browser to directly query metrics
   - You can use the Explorer view to check metrics like `http_request_duration_seconds`

## Troubleshooting

- **Metrics not showing up?** Check:
  - Is Prometheus configured to scrape your API's metrics endpoint?
  - Is the API service running and exposing the `/api/metrics` endpoint?
  - Check the API logs for any errors related to metrics

- **Logs not appearing?** Local monitoring uses file-based logs:
  - Check the `logs/application.log` file in the API service directory

## Cloud Deployment

When deploying to Render, you'll need to:

1. Ensure your external Prometheus can reach the API's metrics endpoint
2. Configure Prometheus to scrape the deployed API at: `https://your-render-api-url/api/metrics`
3. The API uses Grafana Loki for centralized logging (requires GRAFANA_LOKI_URL and GRAFANA_API_KEY) 