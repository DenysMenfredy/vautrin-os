import { Body, Controller, Get, Param, ParseUUIDPipe, Patch, Post, Query } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import type { WorkflowPageResponse, WorkflowResponse } from '@vautrin/contracts';

import type { AuthenticatedRequestContext } from '../auth/decorators/current-auth.decorator.js';
import { ActiveTenant, CurrentAuth } from '../auth/decorators/current-auth.decorator.js';
import { RequireCapability } from '../authz/capability.decorator.js';
import {
  CreateWorkflowDto,
  ListWorkflowsDto,
  UpdateWorkflowDto,
  WorkflowStatusDto,
} from './dto/workflows.dto.js';
import { WorkflowsService } from './workflows.service.js';

@ApiTags('workflows')
@Controller('workflows')
export class WorkflowsController {
  constructor(private readonly workflows: WorkflowsService) {}

  @Get()
  @RequireCapability('workflow.read')
  @ApiOperation({ summary: 'List active-tenant workflow versions' })
  list(
    @ActiveTenant() tenantId: string,
    @Query() query: ListWorkflowsDto,
  ): Promise<WorkflowPageResponse> {
    return this.workflows.list(tenantId, query);
  }

  @Post()
  @RequireCapability('workflow.manage')
  @ApiOperation({ summary: 'Create a draft workflow version' })
  create(
    @ActiveTenant() tenantId: string,
    @CurrentAuth() auth: AuthenticatedRequestContext,
    @Body() input: CreateWorkflowDto,
  ): Promise<WorkflowResponse> {
    return this.workflows.create(tenantId, auth.userId, input);
  }

  @Get(':workflowId')
  @RequireCapability('workflow.read')
  @ApiOperation({ summary: 'Read an active-tenant workflow version' })
  get(
    @ActiveTenant() tenantId: string,
    @Param('workflowId', new ParseUUIDPipe()) workflowId: string,
  ): Promise<WorkflowResponse> {
    return this.workflows.get(tenantId, workflowId);
  }

  @Patch(':workflowId')
  @RequireCapability('workflow.manage')
  @ApiOperation({ summary: 'Edit a draft workflow version' })
  update(
    @ActiveTenant() tenantId: string,
    @CurrentAuth() auth: AuthenticatedRequestContext,
    @Param('workflowId', new ParseUUIDPipe()) workflowId: string,
    @Body() input: UpdateWorkflowDto,
  ): Promise<WorkflowResponse> {
    return this.workflows.update(tenantId, auth.userId, workflowId, input);
  }

  @Post(':workflowId/versions')
  @RequireCapability('workflow.manage')
  @ApiOperation({ summary: 'Create the next draft version from a published version' })
  createVersion(
    @ActiveTenant() tenantId: string,
    @CurrentAuth() auth: AuthenticatedRequestContext,
    @Param('workflowId', new ParseUUIDPipe()) workflowId: string,
  ): Promise<WorkflowResponse> {
    return this.workflows.createVersion(tenantId, auth.userId, workflowId);
  }

  @Patch(':workflowId/status')
  @RequireCapability('workflow.manage')
  @ApiOperation({ summary: 'Activate, pause, or archive a workflow version' })
  setStatus(
    @ActiveTenant() tenantId: string,
    @CurrentAuth() auth: AuthenticatedRequestContext,
    @Param('workflowId', new ParseUUIDPipe()) workflowId: string,
    @Body() input: WorkflowStatusDto,
  ): Promise<WorkflowResponse> {
    return this.workflows.setStatus(tenantId, auth.userId, workflowId, input.status);
  }
}
