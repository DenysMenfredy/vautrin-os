import { Module } from '@nestjs/common';
import { InvitationService } from './invitation.service.js';
import { InvitationsController } from './invitations.controller.js';
import { TenantService } from './tenant.service.js';

@Module({
  controllers: [InvitationsController],
  providers: [TenantService, InvitationService],
  exports: [TenantService, InvitationService],
})
export class TenantModule {}
