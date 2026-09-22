import { Module } from '@nestjs/common';

import { AuthController } from './auth.controller.js';
import { AuthService } from './auth.service.js';
import { AuthRateLimitService } from './auth-rate-limit.service.js';
import { RefreshTokenService } from './refresh-token.service.js';

@Module({
  controllers: [AuthController],
  providers: [AuthService, AuthRateLimitService, RefreshTokenService],
  exports: [AuthService],
})
export class AuthModule {}
