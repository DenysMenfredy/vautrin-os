import { Controller, Get } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import type { LeadDashboardResponse } from '@vautrin/contracts';

import { ActiveTenant } from '../auth/decorators/current-auth.decorator.js';
import { RequireCapability } from '../authz/capability.decorator.js';
import { LeadsService } from './leads.service.js';

@ApiTags('crm')
@Controller('crm')
export class CrmDashboardController {
  constructor(private readonly leads: LeadsService) {}

  @Get('dashboard')
  @RequireCapability('lead.read')
  @ApiOperation({ summary: 'Return lead counts for the active-tenant pipeline' })
  dashboard(@ActiveTenant() tenantId: string): Promise<LeadDashboardResponse> {
    return this.leads.dashboard(tenantId);
  }
}
