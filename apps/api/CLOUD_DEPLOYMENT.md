# Cloud Deployment Guide

This guide explains how to deploy the Todo application to cloud services using free tiers.

## Architecture Overview

The application has been restructured to use the following cloud services:

- **Frontend**: Vercel (free tier)
- **Backend API**: Render (free tier)
- **Logging**: Grafana Cloud Loki (free tier)
- **Metrics Monitoring**: Self-hosted Prometheus and Grafana (via Kubernetes using Helm)

This approach gives you more control over your metrics monitoring while still using managed services for deployment.

## Security Measures

The Todo application includes several security measures for cloud deployment:

1. **Security Headers**:
   - Content-Security-Policy
   - X-Content-Type-Options
   - X-XSS-Protection
   - X-Frame-Options
   - Strict-Transport-Security

2. **Input Validation and Sanitization**:
   - Query parameters are sanitized to prevent injection attacks
   - API endpoints validate input before processing

3. **Rate Limiting**:
   - Basic rate limiting to prevent abuse
   - Configurable limits per endpoint

4. **CSRF Protection**:
   - Verifies origin/referer headers in production
   - Checks for CSRF tokens in state-changing requests

5. **Error Handling**:
   - Proper HTTP status codes for different error scenarios
   - Controlled error responses that don't leak sensitive information

6. **Health Monitoring**:
   - Dedicated `/health` endpoint for uptime monitoring
   - Returns server status, uptime, and resource utilization

## Deployment Steps

### 1. Frontend Deployment (Vercel)

1. Create a Vercel account at https://vercel.com
2. Connect your GitHub repository
3. Import the `todo-app-ui` directory
4. Set the following environment variables:
   - `NEXT_PUBLIC_API_URL`: URL of your Render API (e.g., https://todo-app-api.onrender.com/api)
5. Deploy with default settings

### 2. Backend Deployment (Render)

1. Create a Render account at https://render.com
2. Connect your GitHub repository
3. Create a new Web Service pointing to the `todo-app-api` directory
4. Set the following environment variables:
   - `NODE_ENV`: production
   - `GRAFANA_LOKI_URL`: Your Grafana Loki API endpoint
   - `GRAFANA_API_KEY`: Your Grafana API key (for Loki access)
   - `FRONTEND_URL`: Your Vercel frontend URL (for CSRF protection)
5. Deploy with the following settings:
   - Build Command: `npm install && npm run build`
   - Start Command: `npm run start:prod`
6. Set up health check monitoring:
   - Path: `/health`
   - Expected status code: 200
   - Check interval: 60 seconds

### 3. Grafana Loki Setup (for Logging)

1. Create a free Grafana Cloud account at https://grafana.com/products/cloud/
2. Set up Loki for logging:
   - Navigate to Grafana Loki section and get your Loki URL endpoint
   - Generate an API key with the "Editor" role that has access to Loki
   - Set the following environment variables in Render:
     - `GRAFANA_LOKI_URL`: Your Loki push endpoint (typically ends with /loki/api/v1/push)
     - `GRAFANA_API_KEY`: Your API key for Loki access

### 4. Prometheus and Grafana Setup (for Metrics)

Deploy the monitoring stack using Helm:

1. Ensure you have a Kubernetes cluster available (or use minikube for local testing)
2. Create a monitoring namespace:
   ```bash
   kubectl create namespace monitoring
   ```
3. Navigate to the Helm chart directory:
   ```bash
   cd todo-app-ops/helm/monitoring
   ```
4. Update the `values.yaml` file to set your API hostname:
   ```yaml
   externalTodoApi:
     host: "your-todo-app-api.onrender.com"
   ```
5. Install the Helm chart:
   ```bash
   helm install todo-monitoring . -n monitoring
   ```
6. Access Grafana (default password is in values.yaml):
   ```bash
   kubectl port-forward svc/todo-monitoring-grafana 3000:80 -n monitoring
   ```
7. The monitoring stack includes:
   - Pre-configured dashboards for the Todo App
   - Alert rules for errors, latency, and availability
   - Health check monitoring for the API
   - Loki data source configuration for logs

## Verification

After deployment:

1. Verify the frontend is accessible via the Vercel URL
2. Check that API endpoints are responding at the Render URL
3. Test security headers using a tool like [Security Headers](https://securityheaders.com/)
4. Verify metrics and logs:
   - Check that logs are appearing in Grafana Cloud Loki
   - Check that metrics are appearing in your Prometheus instance
   - Use the included dashboards to monitor your application
5. Test the health endpoint: `curl https://todo-app-api.onrender.com/health`

## Monitoring Dashboards

The Helm chart includes two pre-configured dashboards:

1. **Todo App Overview**: Basic dashboard with request rate metrics
2. **Todo App Dashboard**: Comprehensive dashboard with:
   - HTTP Request Rate by method and path
   - HTTP Response Time by path
   - Application Logs (from Loki)
   - API Health Status
   - HTTP Status Codes
   - Error Rate (%)

## Alert Rules

The monitoring stack includes the following alert rules:

- **HighTodoAppErrorRate**: Triggers when error rate is above 1% for more than 1 minute
- **HighMemoryUsage**: Triggers when memory usage is above 200MB for more than 2 minutes
- **HighRequestLatency**: Triggers when average request latency is above 0.5 seconds for more than 1 minute
- **LowRequestRate**: Triggers when request rate is below 0.1 requests per second for more than 5 minutes
- **ServiceDown**: Triggers when the Todo API service is down for more than 1 minute
- **HealthCheckFailing**: Triggers when the health check endpoint is not responding for more than 1 minute
- **ApiUnavailable**: Triggers when the metrics endpoint is down for more than 2 minutes
- **SlowResponseTime**: Triggers when 95th percentile of response time is above 2 seconds for more than 5 minutes

## Resource Limitations

Be aware of the following limitations on free tiers:

- **Vercel**: Limited to 100GB bandwidth per month
- **Render**: Free web services spin down after 15 minutes of inactivity
- **Grafana Cloud**: 50GB of logs with 14-day retention for Loki 