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
import type { ContactPageResponse, ContactResponse } from '@vautrin/contracts';

import type { AuthenticatedRequestContext } from '../auth/decorators/current-auth.decorator.js';
import { ActiveTenant, CurrentAuth } from '../auth/decorators/current-auth.decorator.js';
import { RequireCapability } from '../authz/capability.decorator.js';
import { ContactsService } from './contacts.service.js';
import { CreateContactDto, ListContactsDto, UpdateContactDto } from './dto/contacts.dto.js';

@ApiTags('contacts')
@Controller('contacts')
export class ContactsController {
  constructor(private readonly contacts: ContactsService) {}

  @Get()
  @RequireCapability('contact.read')
  @ApiOperation({ summary: 'Search and list active-tenant contacts' })
  list(
    @ActiveTenant() tenantId: string,
    @Query() query: ListContactsDto,
  ): Promise<ContactPageResponse> {
    return this.contacts.list(tenantId, query);
  }

  @Post()
  @RequireCapability('contact.write')
  @ApiOperation({ summary: 'Create a contact in the active tenant' })
  create(
    @ActiveTenant() tenantId: string,
    @CurrentAuth() auth: AuthenticatedRequestContext,
    @Body() input: CreateContactDto,
  ): Promise<ContactResponse> {
    return this.contacts.create(tenantId, auth.userId, input);
  }

  @Get(':contactId')
  @RequireCapability('contact.read')
  @ApiOperation({ summary: 'Read a contact in the active tenant' })
  get(
    @ActiveTenant() tenantId: string,
    @Param('contactId', new ParseUUIDPipe()) contactId: string,
  ): Promise<ContactResponse> {
    return this.contacts.get(tenantId, contactId);
  }

  @Patch(':contactId')
  @RequireCapability('contact.write')
  @ApiOperation({ summary: 'Update a contact in the active tenant' })
  update(
    @ActiveTenant() tenantId: string,
    @CurrentAuth() auth: AuthenticatedRequestContext,
    @Param('contactId', new ParseUUIDPipe()) contactId: string,
    @Body() input: UpdateContactDto,
  ): Promise<ContactResponse> {
    return this.contacts.update(tenantId, auth.userId, contactId, input);
  }

  @Delete(':contactId')
  @RequireCapability('contact.write')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Archive a contact in the active tenant' })
  async archive(
    @ActiveTenant() tenantId: string,
    @CurrentAuth() auth: AuthenticatedRequestContext,
    @Param('contactId', new ParseUUIDPipe()) contactId: string,
  ): Promise<void> {
    await this.contacts.archive(tenantId, auth.userId, contactId);
  }
}
