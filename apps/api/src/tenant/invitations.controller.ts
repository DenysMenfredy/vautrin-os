import {
  Body,
  Controller,
  ForbiddenException,
  Header,
  HttpCode,
  HttpStatus,
  Post,
} from '@nestjs/common';
import { ApiCreatedResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { InvitationResponse } from '@vautrin/contracts';

import {
  ActiveTenant,
  type AuthenticatedRequestContext,
  CurrentAuth,
} from '../auth/decorators/current-auth.decorator.js';
import { RequireCapability } from '../authz/capability.decorator.js';
import { CreateInvitationDto } from './dto/invitation.dto.js';
import { InvitationService } from './invitation.service.js';

@ApiTags('tenant-invitations')
@Controller('tenant/invitations')
export class InvitationsController {
  constructor(private readonly invitations: InvitationService) {}

  @Post()
  @RequireCapability('member.manage')
  @Header('Cache-Control', 'no-store')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({
    summary: 'Issue a one-time invitation to the active tenant',
    description: 'The token appears only in this response. Deliver it privately to the invitee.',
  })
  @ApiCreatedResponse({
    description: 'One-time token; this response must be delivered privately and is not cached.',
    schema: {
      type: 'object',
      required: ['invitationId', 'token', 'expiresAt'],
      properties: {
        invitationId: { type: 'string', format: 'uuid' },
        token: { type: 'string', description: '43-character base64url bearer secret' },
        expiresAt: { type: 'string', format: 'date-time' },
      },
    },
  })
  invite(
    @ActiveTenant() tenantId: string,
    @CurrentAuth() actor: AuthenticatedRequestContext,
    @Body() dto: CreateInvitationDto,
  ): Promise<InvitationResponse> {
    if (!actor.role) throw new ForbiddenException('No active tenant role.');
    return this.invitations.invite({
      tenantId,
      actorUserId: actor.userId,
      actorRole: actor.role,
      email: dto.email,
      role: dto.role,
    });
  }
}
