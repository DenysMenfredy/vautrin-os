import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import type { LeadPageResponse, LeadResponse } from '@vautrin/contracts';

import type { AuthenticatedRequestContext } from '../auth/decorators/current-auth.decorator.js';
import { ActiveTenant, CurrentAuth } from '../auth/decorators/current-auth.decorator.js';
import { RequireCapability } from '../authz/capability.decorator.js';
import {
  AssignLeadDto,
  CreateLeadDto,
  ListLeadsDto,
  TransitionLeadDto,
  UpdateLeadDto,
} from './dto/leads.dto.js';
import { LeadsService } from './leads.service.js';

@ApiTags('leads')
@Controller('leads')
export class LeadsController {
  constructor(private readonly leads: LeadsService) {}

  @Get()
  @RequireCapability('lead.read')
  @ApiOperation({ summary: 'List and filter active-tenant leads' })
  list(@ActiveTenant() tenantId: string, @Query() query: ListLeadsDto): Promise<LeadPageResponse> {
    return this.leads.list(tenantId, query);
  }

  @Post()
  @RequireCapability('lead.write')
  @ApiOperation({ summary: 'Create a lead for an active-tenant contact' })
  create(
    @ActiveTenant() tenantId: string,
    @CurrentAuth() auth: AuthenticatedRequestContext,
    @Body() input: CreateLeadDto,
  ): Promise<LeadResponse> {
    return this.leads.create(tenantId, auth.userId, input);
  }

  @Get(':leadId')
  @RequireCapability('lead.read')
  @ApiOperation({ summary: 'Read a tenant lead' })
  get(
    @ActiveTenant() tenantId: string,
    @Param('leadId', new ParseUUIDPipe()) leadId: string,
  ): Promise<LeadResponse> {
    return this.leads.get(tenantId, leadId);
  }

  @Patch(':leadId')
  @RequireCapability('lead.write')
  @ApiOperation({ summary: 'Update lead details using optimistic concurrency' })
  update(
    @ActiveTenant() tenantId: string,
    @CurrentAuth() auth: AuthenticatedRequestContext,
    @Param('leadId', new ParseUUIDPipe()) leadId: string,
    @Body() input: UpdateLeadDto,
  ): Promise<LeadResponse> {
    return this.leads.update(tenantId, auth.userId, leadId, input);
  }

  @Patch(':leadId/status')
  @RequireCapability('lead.write')
  @ApiOperation({ summary: 'Move a lead forward through its lifecycle' })
  transition(
    @ActiveTenant() tenantId: string,
    @CurrentAuth() auth: AuthenticatedRequestContext,
    @Param('leadId', new ParseUUIDPipe()) leadId: string,
    @Body() input: TransitionLeadDto,
  ): Promise<LeadResponse> {
    return this.leads.transition(tenantId, auth.userId, leadId, input);
  }

  @Patch(':leadId/assignment')
  @RequireCapability('lead.assign')
  @ApiOperation({ summary: 'Assign or unassign an active tenant member' })
  assign(
    @ActiveTenant() tenantId: string,
    @CurrentAuth() auth: AuthenticatedRequestContext,
    @Param('leadId', new ParseUUIDPipe()) leadId: string,
    @Body() input: AssignLeadDto,
  ): Promise<LeadResponse> {
    return this.leads.assign(tenantId, auth.userId, leadId, input);
  }

  @Delete(':leadId')
  @RequireCapability('lead.write')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Archive a tenant lead' })
  async archive(
    @ActiveTenant() tenantId: string,
    @CurrentAuth() auth: AuthenticatedRequestContext,
    @Param('leadId', new ParseUUIDPipe()) leadId: string,
  ): Promise<void> {
    await this.leads.archive(tenantId, auth.userId, leadId);
  }
}
