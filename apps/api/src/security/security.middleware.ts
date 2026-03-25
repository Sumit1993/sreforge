import { Injectable, NestMiddleware, Logger } from '@nestjs/common';
import { Request, Response, NextFunction } from 'express';

@Injectable()
export class SecurityMiddleware implements NestMiddleware {
  private readonly logger = new Logger(SecurityMiddleware.name);
  private readonly isProduction = process.env.NODE_ENV === 'production';

  use(req: Request, res: Response, next: NextFunction) {
    // Set security headers
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-XSS-Protection', '1; mode=block');
    res.setHeader('X-Frame-Options', 'SAMEORIGIN');
    res.setHeader(
      'Strict-Transport-Security',
      'max-age=31536000; includeSubDomains',
    );

    // Content Security Policy
    if (this.isProduction) {
      res.setHeader(
        'Content-Security-Policy',
        "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; font-src 'self' data:; connect-src 'self'",
      );
    }

    // Protect from rate limiting if in production
    if (this.isProduction) {
      const ipAddress =
        req.ip ||
        req.connection.remoteAddress ||
        (req.headers['x-forwarded-for'] as string);

      // In a real app, you would implement a proper rate limiter here
      // This is a placeholder for demonstration
      if (this.shouldRateLimit(ipAddress, req.path)) {
        this.logger.warn(
          `Rate limit exceeded for IP: ${ipAddress}, path: ${req.path}`,
        );
        res.status(429).json({
          status: 'error',
          message: 'Too many requests, please try again later',
        });
        return;
      }
    }

    // Sanitize input parameters to prevent injection attacks
    if (req.query) {
      Object.keys(req.query).forEach((key) => {
        if (typeof req.query[key] === 'string') {
          req.query[key] = this.sanitizeInput(req.query[key]);
        }
      });
    }

    // For API requests, simple validation
    if (req.path.startsWith('/api/') && req.method !== 'GET') {
      // Add CSRF protection for state-changing operations in production
      if (this.isProduction && !this.isValidCSRF(req)) {
        this.logger.warn(`Potential CSRF attack detected from IP: ${req.ip}`);
        res.status(403).json({
          status: 'error',
          message: 'Invalid or missing CSRF token',
        });
        return;
      }
    }

    next();
  }

  // Simple sanitization to prevent common injection attempts
  private sanitizeInput(input: string): string {
    if (!input) return input;

    // Basic XSS prevention
    return input
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#x27;')
      .replace(/\//g, '&#x2F;')
      .replace(/\\/g, '&#x5C;')
      .replace(/`/g, '&#96;');
  }

  // Simple in-memory rate limiting (placeholder for demo)
  // In production, use a proper rate limiting solution like Redis
  private requestCounts: Record<string, { count: number; timestamp: number }> =
    {};

  private shouldRateLimit(ip: string, path: string): boolean {
    const key = `${ip}:${path}`;
    const now = Date.now();
    const windowMs = 60 * 1000; // 1 minute window
    const maxRequests = 100; // requests per minute per IP

    if (!this.requestCounts[key]) {
      this.requestCounts[key] = { count: 1, timestamp: now };
      return false;
    }

    // Reset count if window expired
    if (now - this.requestCounts[key].timestamp > windowMs) {
      this.requestCounts[key] = { count: 1, timestamp: now };
      return false;
    }

    // Increment and check
    this.requestCounts[key].count++;
    return this.requestCounts[key].count > maxRequests;
  }

  // Simplified CSRF protection
  // In a real app, use a proper CSRF library or token validation
  private isValidCSRF(req: Request): boolean {
    const csrfToken =
      req.headers['x-csrf-token'] || req.headers['x-xsrf-token'];
    const origin = req.headers.origin || '';
    const referer = req.headers.referer || '';

    // For demo, we'll just check if the origin or referer is from our app
    // In production, implement proper CSRF token validation
    const validDomains = [
      process.env.FRONTEND_URL || '',
      'https://todo-app.vercel.app',
    ];

    return (
      !!csrfToken ||
      validDomains.some(
        (domain) =>
          domain && (origin.includes(domain) || referer.includes(domain)),
      )
    );
  }
}
