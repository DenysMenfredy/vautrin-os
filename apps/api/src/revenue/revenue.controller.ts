import { Body, Controller, Headers, Post } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import {
  ActiveTenant,
  type AuthenticatedRequestContext,
  CurrentAuth,
} from '../auth/decorators/current-auth.decorator.js';
import { RequireCapability } from '../authz/capability.decorator.js';
import { MissedCallDto, RemodelingTemplateDto } from './revenue.dto.js';
import { RevenueService } from './revenue.service.js';

@ApiTags('revenue')
@Controller()
export class RevenueController {
  constructor(private readonly revenue: RevenueService) {}
  @Post('intake/missed-calls')
  @RequireCapability('contact.write', 'lead.write', 'conversation.write')
  @ApiOperation({
    summary:
      'Authenticated controlled missed-call signal; resolves contact, lead, conversation and durable event idempotently',
  })
  missedCall(
    @ActiveTenant() tenantId: string,
    @CurrentAuth() auth: AuthenticatedRequestContext,
    @Body() input: MissedCallDto,
    @Headers('x-correlation-id') correlationId?: string,
  ) {
    return this.revenue.missedCall(tenantId, auth.userId, input, correlationId);
  }
  @Post('templates/remodeling')
  @RequireCapability('business.manage', 'workflow.manage')
  @ApiOperation({
    summary:
      'Install remodeling v1 configuration, receptionist and bounded missed-call/reply workflows',
  })
  template(
    @ActiveTenant() tenantId: string,
    @CurrentAuth() auth: AuthenticatedRequestContext,
    @Body() input: RemodelingTemplateDto,
  ) {
    return this.revenue.installTemplate(tenantId, auth.userId, input);
  }
}
