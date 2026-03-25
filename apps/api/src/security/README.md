# Security Module

This module provides security enhancements for the Todo App API, implementing several best practices for web application security.

## Features

### Security Headers

The middleware automatically sets the following security headers on all responses:

- `X-Content-Type-Options: nosniff` - Prevents MIME type sniffing
- `X-XSS-Protection: 1; mode=block` - Enables browser's XSS protection
- `X-Frame-Options: SAMEORIGIN` - Prevents clickjacking by limiting iframe usage
- `Strict-Transport-Security: max-age=31536000; includeSubDomains` - Enforces HTTPS
- `Content-Security-Policy` - Restricts resource loading in production

### Input Sanitization

All query parameters are automatically sanitized to prevent injection attacks:
- HTML entity encoding for potentially dangerous characters (`<`, `>`, `"`, `'`, `/`, `\`, `` ` ``)
- Applied to all string query parameters

### Rate Limiting

A basic in-memory rate limiting implementation that:
- Tracks requests per IP address and endpoint
- Default limit of 100 requests per minute per IP
- Returns 429 Too Many Requests when limits are exceeded

### CSRF Protection

Simple CSRF protection for state-changing operations:
- Verifies Origin and Referer headers match configured frontend URLs
- Checks for CSRF tokens in request headers
- Applied to all non-GET requests to API endpoints

## Usage

### Module Setup

The security module is already imported in the `AppModule`:

```typescript
import { Module } from '@nestjs/common';
import { SecurityModule } from './security/security.module';

@Module({
  imports: [/* other modules */, SecurityModule],
})
export class AppModule {}
```

The middleware is applied globally to all routes:

```typescript
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer) {
    consumer.apply(MetricsMiddleware, SecurityMiddleware).forRoutes('*');
  }
}
```

### Configuration

The security features adapt based on the environment:

- In development, CSP headers are not applied and CORS is permissive
- In production, full security is enabled with strict CORS and CSP

Required environment variables:

- `NODE_ENV`: Set to 'production' for full security features
- `FRONTEND_URL`: Your frontend domain for CSRF validation

### Custom Configuration

To customize rate limits or other security features, modify the `SecurityMiddleware` class.

## Implementation Details

- The middleware is injected through NestJS's middleware system
- Rate limiting uses a simple in-memory implementation (consider using Redis for production)
- CSRF protection is simplified and should be enhanced with token validation for production 