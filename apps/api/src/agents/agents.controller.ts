import { Body, Controller, Get, Param, ParseUUIDPipe, Patch, Post, Query } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import type { AgentPageResponse, AgentResponse } from '@vautrin/contracts';

import type { AuthenticatedRequestContext } from '../auth/decorators/current-auth.decorator.js';
import { ActiveTenant, CurrentAuth } from '../auth/decorators/current-auth.decorator.js';
import { RequireCapability } from '../authz/capability.decorator.js';
import { AgentsService } from './agents.service.js';
import { AgentStatusDto, CreateAgentDto, ListAgentsDto, UpdateAgentDto } from './dto/agents.dto.js';

@ApiTags('agents')
@Controller('agents')
export class AgentsController {
  constructor(private readonly agents: AgentsService) {}

  @Get()
  @RequireCapability('business.read')
  @ApiOperation({ summary: 'List active-tenant agent versions' })
  list(
    @ActiveTenant() tenantId: string,
    @Query() query: ListAgentsDto,
  ): Promise<AgentPageResponse> {
    return this.agents.list(tenantId, query);
  }

  @Post()
  @RequireCapability('business.manage')
  @ApiOperation({ summary: 'Create a draft agent configuration' })
  create(
    @ActiveTenant() tenantId: string,
    @CurrentAuth() auth: AuthenticatedRequestContext,
    @Body() input: CreateAgentDto,
  ): Promise<AgentResponse> {
    return this.agents.create(tenantId, auth.userId, input);
  }

  @Get(':agentId')
  @RequireCapability('business.read')
  @ApiOperation({ summary: 'Read an active-tenant agent version' })
  get(
    @ActiveTenant() tenantId: string,
    @Param('agentId', new ParseUUIDPipe()) agentId: string,
  ): Promise<AgentResponse> {
    return this.agents.get(tenantId, agentId);
  }

  @Patch(':agentId')
  @RequireCapability('business.manage')
  @ApiOperation({ summary: 'Edit a draft agent configuration' })
  update(
    @ActiveTenant() tenantId: string,
    @CurrentAuth() auth: AuthenticatedRequestContext,
    @Param('agentId', new ParseUUIDPipe()) agentId: string,
    @Body() input: UpdateAgentDto,
  ): Promise<AgentResponse> {
    return this.agents.update(tenantId, auth.userId, agentId, input);
  }

  @Post(':agentId/versions')
  @RequireCapability('business.manage')
  @ApiOperation({ summary: 'Create the next draft version from a published agent' })
  createVersion(
    @ActiveTenant() tenantId: string,
    @CurrentAuth() auth: AuthenticatedRequestContext,
    @Param('agentId', new ParseUUIDPipe()) agentId: string,
  ): Promise<AgentResponse> {
    return this.agents.createVersion(tenantId, auth.userId, agentId);
  }

  @Patch(':agentId/status')
  @RequireCapability('business.manage')
  @ApiOperation({ summary: 'Activate or archive an agent version' })
  setStatus(
    @ActiveTenant() tenantId: string,
    @CurrentAuth() auth: AuthenticatedRequestContext,
    @Param('agentId', new ParseUUIDPipe()) agentId: string,
    @Body() input: AgentStatusDto,
  ): Promise<AgentResponse> {
    return this.agents.setStatus(tenantId, auth.userId, agentId, input.status);
  }
}
