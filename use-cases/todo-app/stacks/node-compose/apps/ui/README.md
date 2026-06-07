# Todo App UI

A modern Next.js frontend application designed for **testing incident response and monitoring systems**. This UI provides an intuitive interface for managing todos and a comprehensive **Incident Simulation Dashboard** to trigger realistic alerts and errors for validating observability platforms.

## Purpose
This frontend serves as the **user interface for a todo application testing workspace** that enables operators to simulate real-world incidents, trigger monitoring alerts, and test automated incident response workflows through an easy-to-use web interface.

## Features
- **Modern Next.js Architecture**: Built with Next.js App Router and TypeScript
- **Incident Simulation Dashboard**: Interactive UI for triggering various error conditions
- **Burst Mode Testing**: Rapid-fire API calls to quickly trigger rate-based alerts
- **Real-time Feedback**: Live display of API responses, memory stats, and error details  
- **Responsive Design**: Built with Chakra UI for modern, accessible interface
- **Production Deployment**: Deployed on Vercel with realistic cloud hosting
- **Memory Leak Testing**: Visual interface for controllable memory allocation/deallocation

## Prerequisites
Ensure you have the following installed:
- [Node.js](https://nodejs.org/)
- [Docker](https://www.docker.com/)
- [Rancher Desktop](https://rancherdesktop.io/)
- [Kubectl](https://kubernetes.io/docs/tasks/tools/)
- [Helm](https://helm.sh/)
- [DevSpace](https://devspace.sh/)

## Getting Started

### Install Dependencies
```
cd todo-app-ui
npm install
```

### Run Locally
```
npm run dev
```

### Deploy to Local Kubernetes (with DevSpace)
```
cd todo-app-ui
devspace dev
```

### Access the Application
Once deployed, the application is accessible via the Nginx Ingress Controller at:

```
http://localhost/
```

## Incident Simulation Features

### Issue Simulator Dashboard
The application includes a comprehensive incident simulation interface:

- **Error Simulation**: Trigger 500 errors, 404s, timeouts, and other HTTP error conditions
- **Memory Leak Testing**: Allocate/deallocate memory to test memory-based alerts
- **Latency Simulation**: Introduce artificial delays to test performance monitoring
- **Burst Mode**: Make 20 rapid API calls to quickly trigger rate-based Prometheus alerts

### Burst Mode Capabilities
- **Rapid Testing**: Makes 20 API calls in ~4 seconds with 200ms intervals
- **Progress Tracking**: Real-time progress bar and status updates
- **Alert Triggering**: Designed to quickly trigger Prometheus alerts for:
  - High error rate (>1% for 1+ minute)  
  - Request latency (>500ms average)
  - Memory usage thresholds

### Real-time Feedback
- **Live Response Display**: Shows HTTP status, response messages, and error details
- **Memory Statistics**: Displays heap usage, total memory, and arrays allocated
- **Correlation IDs**: Tracks requests for incident correlation and debugging

## Monitoring & Integration
- **Prometheus Metrics**: Frontend performance and user interaction tracking
- **Error Tracking**: Comprehensive error logging and reporting
- **Cloud Deployment**: Production deployment on Vercel for realistic testing
- **API Integration**: Seamless connection to todo-app-api for end-to-end testing

## Development Notes
- The application runs in **Kubernetes** using **DevSpace** for local development
- Ingress is managed via **NGINX** 
- Cloud deployment handled via **Vercel**
- Backend API integration via environment variables
