import { Module } from '@nestjs/common';

import { AuthController } from './auth.controller.js';
import { AuthService } from './auth.service.js';
import { RefreshTokenService } from './refresh-token.service.js';

@Module({
  controllers: [AuthController],
  providers: [AuthService, RefreshTokenService],
  exports: [AuthService],
})
export class AuthModule {}
