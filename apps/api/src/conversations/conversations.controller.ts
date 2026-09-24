import { Body, Controller, Get, Param, ParseUUIDPipe, Patch, Post, Query } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import type {
  ConversationPageResponse,
  ConversationResponse,
  MessagePageResponse,
} from '@vautrin/contracts';

import type { AuthenticatedRequestContext } from '../auth/decorators/current-auth.decorator.js';
import { ActiveTenant, CurrentAuth } from '../auth/decorators/current-auth.decorator.js';
import { RequireCapability } from '../authz/capability.decorator.js';
import { ConversationsService } from './conversations.service.js';
import {
  ChangeConversationStatusDto,
  CreateConversationDto,
  ListConversationsDto,
  ListMessagesDto,
} from './dto/conversations.dto.js';

@ApiTags('conversations')
@Controller('conversations')
export class ConversationsController {
  constructor(private readonly conversations: ConversationsService) {}

  @Get()
  @RequireCapability('conversation.read')
  @ApiOperation({ summary: 'List tenant conversations' })
  list(
    @ActiveTenant() tenantId: string,
    @Query() query: ListConversationsDto,
  ): Promise<ConversationPageResponse> {
    return this.conversations.list(tenantId, query);
  }

  @Post()
  @RequireCapability('conversation.write')
  @ApiOperation({ summary: 'Open a conversation for a tenant contact' })
  create(
    @ActiveTenant() tenantId: string,
    @CurrentAuth() auth: AuthenticatedRequestContext,
    @Body() input: CreateConversationDto,
  ): Promise<ConversationResponse> {
    return this.conversations.create(tenantId, auth.userId, input);
  }

  @Get(':conversationId')
  @RequireCapability('conversation.read')
  @ApiOperation({ summary: 'Read a tenant conversation' })
  get(
    @ActiveTenant() tenantId: string,
    @Param('conversationId', new ParseUUIDPipe()) conversationId: string,
  ): Promise<ConversationResponse> {
    return this.conversations.get(tenantId, conversationId);
  }

  @Patch(':conversationId/status')
  @RequireCapability('conversation.write')
  @ApiOperation({ summary: 'Change a conversation state' })
  changeStatus(
    @ActiveTenant() tenantId: string,
    @CurrentAuth() auth: AuthenticatedRequestContext,
    @Param('conversationId', new ParseUUIDPipe()) conversationId: string,
    @Body() input: ChangeConversationStatusDto,
  ): Promise<ConversationResponse> {
    return this.conversations.changeStatus(tenantId, auth.userId, conversationId, input);
  }

  @Get(':conversationId/messages')
  @RequireCapability('conversation.read')
  @ApiOperation({ summary: 'List messages in a tenant conversation' })
  listMessages(
    @ActiveTenant() tenantId: string,
    @Param('conversationId', new ParseUUIDPipe()) conversationId: string,
    @Query() query: ListMessagesDto,
  ): Promise<MessagePageResponse> {
    return this.conversations.listMessages(tenantId, conversationId, query);
  }
}
