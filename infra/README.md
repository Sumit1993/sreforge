# Todo App Operations

Infrastructure and monitoring configurations for the **Todo App testing workspace**, designed to support incident response and monitoring system validation. This setup provides comprehensive alerting, metrics collection, and observability for testing automated incident response workflows.

## Purpose
This operations directory contains all the infrastructure and monitoring configurations needed to run a **realistic testing environment** for validating incident response systems, monitoring tools, and observability platforms through automated alerting and metrics collection.

## Directory Structure
```
todo-app-ops/
├── helm/                    # Kubernetes configurations
│   └── ingress/            # Ingress controller configurations  
├── prometheus/             # Complete monitoring stack
│   ├── prometheus.yml      # Prometheus server configuration
│   ├── alertmanager.yml    # Alert routing and notification config
│   └── rules/              # Comprehensive alert rules
│       └── todo-app-rules.yml  # Production-ready alert definitions
└── README.md
```

## Key Features
- **Production-grade Alert Rules**: Comprehensive alerting for error rates, latency, memory usage, and service availability
- **Realistic Monitoring Setup**: Local Prometheus + Alertmanager stack for testing incident workflows  
- **Webhook Integration**: Ready for integration with incident response systems
- **Cloud Monitoring Support**: Compatible with remote monitoring platforms
- **Kubernetes Deployment**: Full containerized application deployment

## Prerequisites
1. [Rancher Desktop](https://rancherdesktop.io/) for local Kubernetes
2. [Prometheus](https://prometheus.io/download/) for metrics collection
3. [Alertmanager](https://prometheus.io/download/#alertmanager) for alert management

## Kubernetes Setup

### 1. NGINX Ingress Controller
```bash
helm repo add ingress-nginx https://kubernetes.github.io/ingress-nginx
helm repo update

helm install ingress-nginx ingress-nginx/ingress-nginx \
  --namespace ingress-nginx \
  --create-namespace \
  --set controller.watchIngressWithoutClass=true
```

### 2. Application Deployment
```bash
# Add to hosts file (C:\Windows\System32\drivers\etc\hosts):
# 127.0.0.1 nextjs.local

helm install todo-app ./helm/todo-app --namespace todo-app --create-namespace
```

## Alert Rules Overview

The monitoring setup includes comprehensive alert rules designed to trigger realistic incidents:

### Error Rate Alerts
- **HighTodoAppErrorRate**: Triggers when 5xx error rate > 1% for 1+ minute
- **ServiceDown**: Detects when the API service stops responding

### Performance Alerts  
- **HighRequestLatency**: Monitors average response time > 500ms for 1+ minute
- **SlowResponseTime**: Tracks 95th percentile response time > 2s for 5+ minutes

### Resource Alerts
- **HighMemoryUsage**: Alerts when memory usage > 200MB for 2+ minutes  
- **LowRequestRate**: Detects abnormally low traffic (< 0.1 req/sec for 5+ minutes)

## Monitoring Setup

### 1. Prometheus Configuration
1. Extract Prometheus to `prometheus/` directory
2. Start Prometheus:
```bash
cd prometheus
prometheus --config.file=prometheus.yml
```
**Note**: The prometheus.yml is already configured to scrape the deployed todo-app-api on Render.

### 2. Alertmanager Setup
1. Extract Alertmanager to `prometheus/` directory
2. Configure webhook endpoints in `alertmanager.yml` (if integrating with incident response systems)
3. Start Alertmanager:
```bash
cd prometheus
alertmanager --config.file=alertmanager.yml
```

### 3. Testing Incident Workflows
The setup enables comprehensive incident testing:
- **UI-Triggered Incidents**: Use the Issue Simulator to trigger specific alerts
- **Burst Mode Testing**: Rapidly generate errors to trigger rate-based alerts
- **Memory Pressure**: Controllable memory leaks to test resource alerting
- **Realistic Timing**: Alert thresholds match real-world monitoring scenarios

## Accessing Services
- **Local Application**: http://nextjs.local (when running locally)
- **Cloud Application**: https://todo-app-ui.vercel.app (production deployment)
- **API Endpoint**: https://todo-app-api-yns4.onrender.com
- **Prometheus**: http://localhost:9090
- **Alertmanager**: http://localhost:9093

## Common Commands

### Kubernetes
```bash
# Update application
helm upgrade todo-app ./helm/todo-app -n todo-app

# Uninstall application
helm uninstall todo-app -n todo-app

# Check ingress status
kubectl get ingress -n todo-app
```

### Monitoring
```powershell
# Reload Prometheus config
Invoke-RestMethod -Method POST http://localhost:9090/-/reload

# Reload Alertmanager config
Invoke-RestMethod -Method POST http://localhost:9093/-/reload

# View Prometheus targets
Start-Process "http://localhost:9090/targets"

# View active alerts
Start-Process "http://localhost:9090/alerts"
```

## Integration with Incident Response Systems

### Webhook Configuration
To integrate with incident response systems, configure alertmanager.yml:

```yaml
route:
  receiver: 'incident-response-webhook'
  
receivers:
- name: 'incident-response-webhook'
  webhook_configs:
  - url: 'http://your-incident-system:8000/api/webhooks/prometheus'
    send_resolved: true
```

### Alert Payload Structure
Alerts are sent with rich context including:
- **Alert metadata**: severity, service, alert name
- **Metrics data**: current values, thresholds, duration
- **Service information**: deployment info, error context
- **Timing data**: alert start time, resolution time

## Security Notes
- Keep webhook URLs and credentials secure
- Use HTTPS for all external communications  
- For production integrations, use proper secrets management
- Monitor alert webhook delivery for security anomalies

## Troubleshooting
- If ingress is not working, check NGINX controller:
  ```bash
  kubectl get pods -n ingress-nginx
  ```
- If metrics are missing, verify Prometheus targets:
  ```bash
  curl http://localhost:9090/api/v1/targets
  ```
- For alert issues, check Alertmanager status:
  ```bash
  curl http://localhost:9093/api/v1/status
  ```