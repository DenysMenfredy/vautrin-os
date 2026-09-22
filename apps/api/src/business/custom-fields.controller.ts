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
  Put,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiOperation, ApiParam, ApiTags } from '@nestjs/swagger';
import type {
  CustomFieldDefinitionResponse,
  CustomFieldEntityType,
  CustomFieldValueResponse,
  PageResponse,
} from '@vautrin/contracts';
import { CUSTOM_FIELD_ENTITY_TYPES } from '@vautrin/contracts';

import type { AuthenticatedRequestContext } from '../auth/decorators/current-auth.decorator.js';
import { ActiveTenant, CurrentAuth } from '../auth/decorators/current-auth.decorator.js';
import { RequireCapability, RequireTenant } from '../authz/capability.decorator.js';
import { CustomFieldValueCapabilityGuard } from '../authz/custom-field-value-capability.guard.js';
import { CustomFieldsService } from './custom-fields.service.js';
import {
  CreateCustomFieldDefinitionDto,
  ListCustomFieldDefinitionsDto,
  SetCustomFieldValueDto,
  UpdateCustomFieldDefinitionDto,
} from './dto/business.dto.js';

@ApiTags('business-custom-fields')
@Controller('business')
export class CustomFieldsController {
  constructor(private readonly customFields: CustomFieldsService) {}

  @Get('custom-field-definitions')
  @RequireCapability('business.read')
  @ApiOperation({ summary: 'List tenant custom field definitions' })
  listDefinitions(
    @ActiveTenant() tenantId: string,
    @Query() query: ListCustomFieldDefinitionsDto,
  ): Promise<PageResponse<CustomFieldDefinitionResponse>> {
    return this.customFields.listDefinitions(tenantId, query);
  }

  @Post('custom-field-definitions')
  @RequireCapability('business.manage')
  @ApiOperation({ summary: 'Create a tenant custom field definition' })
  createDefinition(
    @ActiveTenant() tenantId: string,
    @CurrentAuth() auth: AuthenticatedRequestContext,
    @Body() input: CreateCustomFieldDefinitionDto,
  ): Promise<CustomFieldDefinitionResponse> {
    return this.customFields.createDefinition(tenantId, auth.userId, input);
  }

  @Get('custom-field-definitions/:definitionId')
  @RequireCapability('business.read')
  @ApiOperation({ summary: 'Read a tenant custom field definition' })
  getDefinition(
    @ActiveTenant() tenantId: string,
    @Param('definitionId', new ParseUUIDPipe()) definitionId: string,
  ): Promise<CustomFieldDefinitionResponse> {
    return this.customFields.getDefinition(tenantId, definitionId);
  }

  @Patch('custom-field-definitions/:definitionId')
  @RequireCapability('business.manage')
  @ApiOperation({ summary: 'Update a tenant custom field definition' })
  updateDefinition(
    @ActiveTenant() tenantId: string,
    @CurrentAuth() auth: AuthenticatedRequestContext,
    @Param('definitionId', new ParseUUIDPipe()) definitionId: string,
    @Body() input: UpdateCustomFieldDefinitionDto,
  ): Promise<CustomFieldDefinitionResponse> {
    return this.customFields.updateDefinition(tenantId, auth.userId, definitionId, input);
  }

  @Delete('custom-field-definitions/:definitionId')
  @RequireCapability('business.manage')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Deactivate a tenant custom field definition' })
  async deactivateDefinition(
    @ActiveTenant() tenantId: string,
    @CurrentAuth() auth: AuthenticatedRequestContext,
    @Param('definitionId', new ParseUUIDPipe()) definitionId: string,
  ): Promise<void> {
    await this.customFields.deactivateDefinition(tenantId, auth.userId, definitionId);
  }

  @Get('custom-field-values/:entityType/:entityId')
  @RequireTenant()
  @UseGuards(CustomFieldValueCapabilityGuard)
  @ApiOperation({ summary: 'List custom field values for a tenant CRM record' })
  @ApiParam({ name: 'entityType', enum: CUSTOM_FIELD_ENTITY_TYPES })
  listValues(
    @ActiveTenant() tenantId: string,
    @Param('entityType') entityType: CustomFieldEntityType,
    @Param('entityId', new ParseUUIDPipe()) entityId: string,
  ): Promise<readonly CustomFieldValueResponse[]> {
    return this.customFields.listValues(tenantId, entityType, entityId);
  }

  @Put('custom-field-values/:entityType/:entityId/:definitionId')
  @RequireTenant()
  @UseGuards(CustomFieldValueCapabilityGuard)
  @ApiOperation({ summary: 'Set a custom field value on a tenant CRM record' })
  @ApiParam({ name: 'entityType', enum: CUSTOM_FIELD_ENTITY_TYPES })
  setValue(
    @ActiveTenant() tenantId: string,
    @CurrentAuth() auth: AuthenticatedRequestContext,
    @Param('entityType') entityType: CustomFieldEntityType,
    @Param('entityId', new ParseUUIDPipe()) entityId: string,
    @Param('definitionId', new ParseUUIDPipe()) definitionId: string,
    @Body() input: SetCustomFieldValueDto,
  ): Promise<CustomFieldValueResponse> {
    return this.customFields.setValue(
      tenantId,
      auth.userId,
      entityType,
      entityId,
      definitionId,
      input,
    );
  }

  @Delete('custom-field-values/:entityType/:entityId/:definitionId')
  @RequireTenant()
  @UseGuards(CustomFieldValueCapabilityGuard)
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Remove a custom field value from a tenant CRM record' })
  @ApiParam({ name: 'entityType', enum: CUSTOM_FIELD_ENTITY_TYPES })
  async deleteValue(
    @ActiveTenant() tenantId: string,
    @CurrentAuth() auth: AuthenticatedRequestContext,
    @Param('entityType') entityType: CustomFieldEntityType,
    @Param('entityId', new ParseUUIDPipe()) entityId: string,
    @Param('definitionId', new ParseUUIDPipe()) definitionId: string,
  ): Promise<void> {
    await this.customFields.deleteValue(tenantId, auth.userId, entityType, entityId, definitionId);
  }
}
