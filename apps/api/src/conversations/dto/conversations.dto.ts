import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  type ChangeConversationStatusRequest,
  CONVERSATION_CHANNELS,
  CONVERSATION_STATUSES,
  type ConversationChannel,
  type ConversationStatus,
  type CreateConversationRequest,
  type ListConversationsRequest,
  type SendMessageRequest,
} from '@vautrin/contracts';
import { Type } from 'class-transformer';
import { IsIn, IsInt, IsOptional, IsString, IsUUID, Max, MaxLength, Min } from 'class-validator';

export class CreateConversationDto implements CreateConversationRequest {
  @ApiProperty({ format: 'uuid' })
  @IsUUID()
  declare contactId: string;

  @ApiPropertyOptional({ format: 'uuid' })
  @IsOptional()
  @IsUUID()
  declare leadId?: string;

  @ApiProperty({ enum: CONVERSATION_CHANNELS })
  @IsIn(CONVERSATION_CHANNELS)
  declare channel: ConversationChannel;

  @ApiPropertyOptional({ maxLength: 200 })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  declare subject?: string;
}

export class ListConversationsDto implements ListConversationsRequest {
  @ApiPropertyOptional({ minimum: 1, maximum: 100, default: 50 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  declare limit?: number;

  @ApiPropertyOptional({ maxLength: 256 })
  @IsOptional()
  @IsString()
  @MaxLength(256)
  declare cursor?: string;

  @ApiPropertyOptional({ format: 'uuid' })
  @IsOptional()
  @IsUUID()
  declare contactId?: string;

  @ApiPropertyOptional({ format: 'uuid' })
  @IsOptional()
  @IsUUID()
  declare leadId?: string;

  @ApiPropertyOptional({ enum: CONVERSATION_CHANNELS })
  @IsOptional()
  @IsIn(CONVERSATION_CHANNELS)
  declare channel?: ConversationChannel;

  @ApiPropertyOptional({ enum: CONVERSATION_STATUSES })
  @IsOptional()
  @IsIn(CONVERSATION_STATUSES)
  declare status?: ConversationStatus;
}

export class ListMessagesDto {
  @ApiPropertyOptional({ minimum: 1, maximum: 100, default: 50 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  declare limit?: number;

  @ApiPropertyOptional({ maxLength: 256 })
  @IsOptional()
  @IsString()
  @MaxLength(256)
  declare cursor?: string;
}

export class ChangeConversationStatusDto implements ChangeConversationStatusRequest {
  @ApiProperty({ enum: CONVERSATION_STATUSES })
  @IsIn(CONVERSATION_STATUSES)
  declare status: ConversationStatus;
}

export class SendMessageDto implements SendMessageRequest {
  @ApiProperty({ maxLength: 1600 })
  @IsString()
  @MaxLength(1600)
  declare body: string;

  @ApiProperty({ format: 'uuid', description: 'Reuse this key when retrying the request.' })
  @IsUUID()
  declare idempotencyKey: string;
}
