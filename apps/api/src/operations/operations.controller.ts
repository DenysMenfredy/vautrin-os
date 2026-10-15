import { Controller, Get, Param, ParseUUIDPipe, Post, Query } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import {
  ActiveTenant,
  type AuthenticatedRequestContext,
  CurrentAuth,
} from '../auth/decorators/current-auth.decorator.js';
import { RequireCapability } from '../authz/capability.decorator.js';
import { OperationsListDto } from './operations.dto.js';
import { OperationsService } from './operations.service.js';
@ApiTags('operations')
@Controller('operations')
export class OperationsController {
  constructor(private readonly operations: OperationsService) {}
  @Get('summary')
  @RequireCapability('workflow.read')
  @ApiOperation({ summary: 'Active-tenant automation, handoff and usage counters' })
  summary(@ActiveTenant() tenantId: string) {
    return this.operations.summary(tenantId);
  }
  @Get('runs')
  @RequireCapability('workflow.read')
  @ApiOperation({ summary: 'Paginated tenant workflow execution history' })
  list(@ActiveTenant() tenantId: string, @Query() query: OperationsListDto) {
    return this.operations.list(tenantId, query);
  }
  @Get('runs/:id')
  @RequireCapability('workflow.read')
  @ApiOperation({ summary: 'Explain a workflow using persisted step and agent telemetry' })
  detail(@ActiveTenant() tenantId: string, @Param('id', ParseUUIDPipe) id: string) {
    return this.operations.detail(tenantId, id);
  }
  @Post('runs/:id/cancel')
  @RequireCapability('workflow.manage')
  @ApiOperation({ summary: 'Cancel actionable work and prevent delayed wake-up execution' })
  cancel(
    @ActiveTenant() tenantId: string,
    @CurrentAuth() auth: AuthenticatedRequestContext,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.operations.cancel(tenantId, auth.userId, id);
  }
}
