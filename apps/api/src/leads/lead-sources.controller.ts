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
import type { LeadSourcePageResponse, LeadSourceResponse } from '@vautrin/contracts';

import type { AuthenticatedRequestContext } from '../auth/decorators/current-auth.decorator.js';
import { ActiveTenant, CurrentAuth } from '../auth/decorators/current-auth.decorator.js';
import { RequireCapability } from '../authz/capability.decorator.js';
import { CreateLeadSourceDto, ListLeadSourcesDto, UpdateLeadSourceDto } from './dto/leads.dto.js';
import { LeadSourcesService } from './lead-sources.service.js';

@ApiTags('lead-sources')
@Controller('lead-sources')
export class LeadSourcesController {
  constructor(private readonly sources: LeadSourcesService) {}

  @Get()
  @RequireCapability('lead.read')
  @ApiOperation({ summary: 'List active-tenant lead sources' })
  list(
    @ActiveTenant() tenantId: string,
    @Query() query: ListLeadSourcesDto,
  ): Promise<LeadSourcePageResponse> {
    return this.sources.list(tenantId, query);
  }

  @Post()
  @RequireCapability('business.manage')
  @ApiOperation({ summary: 'Create a lead source in the tenant catalog' })
  create(
    @ActiveTenant() tenantId: string,
    @CurrentAuth() auth: AuthenticatedRequestContext,
    @Body() input: CreateLeadSourceDto,
  ): Promise<LeadSourceResponse> {
    return this.sources.create(tenantId, auth.userId, input);
  }

  @Get(':sourceId')
  @RequireCapability('lead.read')
  @ApiOperation({ summary: 'Read a tenant lead source' })
  get(
    @ActiveTenant() tenantId: string,
    @Param('sourceId', new ParseUUIDPipe()) sourceId: string,
  ): Promise<LeadSourceResponse> {
    return this.sources.get(tenantId, sourceId);
  }

  @Patch(':sourceId')
  @RequireCapability('business.manage')
  @ApiOperation({ summary: 'Update a tenant lead source' })
  update(
    @ActiveTenant() tenantId: string,
    @CurrentAuth() auth: AuthenticatedRequestContext,
    @Param('sourceId', new ParseUUIDPipe()) sourceId: string,
    @Body() input: UpdateLeadSourceDto,
  ): Promise<LeadSourceResponse> {
    return this.sources.update(tenantId, auth.userId, sourceId, input);
  }

  @Delete(':sourceId')
  @RequireCapability('business.manage')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Deactivate a tenant lead source' })
  async deactivate(
    @ActiveTenant() tenantId: string,
    @CurrentAuth() auth: AuthenticatedRequestContext,
    @Param('sourceId', new ParseUUIDPipe()) sourceId: string,
  ): Promise<void> {
    await this.sources.deactivate(tenantId, auth.userId, sourceId);
  }
}
