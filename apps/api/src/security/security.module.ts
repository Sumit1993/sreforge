import { Module } from '@nestjs/common';
import { SecurityMiddleware } from './security.middleware';

@Module({
  providers: [SecurityMiddleware],
  exports: [SecurityMiddleware],
})
export class SecurityModule {} 