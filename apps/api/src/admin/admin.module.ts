import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module.js';
import { AdminController } from './admin.controller.js';
import { AdminService } from './admin.service.js';
import { PlatformGuard } from './platform.guard.js';
import { PlatformRepository } from './platform.repository.js';
import { PlatformAuthService } from './platform-auth.service.js';

@Module({
  imports: [AuthModule],
  controllers: [AdminController],
  providers: [PlatformRepository, PlatformAuthService, PlatformGuard, AdminService],
})
export class AdminModule {}
