import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  AGENT_STATUSES,
  type AgentLifecycleRequest,
  type AgentStatus,
  type CreateAgentRequest,
  type ListAgentsRequest,
  type UpdateAgentRequest,
} from '@vautrin/contracts';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayUnique,
  IsArray,
  IsIn,
  IsInt,
  IsObject,
  IsOptional,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
  MinLength,
  ValidateIf,
} from 'class-validator';

export class CreateAgentDto implements CreateAgentRequest {
  @ApiProperty({ example: 'receptionist', maxLength: 80 })
  @IsString()
  @Matches(/^[a-z0-9][a-z0-9_-]{0,79}$/)
  declare key: string;

  @ApiProperty({ maxLength: 200 })
  @IsString()
  @MinLength(1)
  @MaxLength(200)
  declare name: string;

  @ApiProperty({ maxLength: 20_000 })
  @IsString()
  @MinLength(1)
  @MaxLength(20_000)
  declare instructions: string;

  @ApiProperty({ example: 'receptionist-v1', maxLength: 80 })
  @IsString()
  @Matches(/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,79}$/)
  declare promptVersion: string;

  @ApiPropertyOptional({ type: 'object', additionalProperties: true })
  @IsOptional()
  @IsObject()
  declare modelConfiguration?: Readonly<Record<string, unknown>>;

  @ApiPropertyOptional({ type: 'array', items: { type: 'string' }, maxItems: 50 })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(50)
  @ArrayUnique()
  @IsString({ each: true })
  @Matches(/^[a-z][a-z0-9_.-]{0,79}$/, { each: true })
  declare allowedTools?: readonly string[];

  @ApiPropertyOptional({ type: 'object', additionalProperties: true })
  @IsOptional()
  @IsObject()
  declare knowledgeStrategy?: Readonly<Record<string, unknown>>;

  @ApiPropertyOptional({ type: 'object', additionalProperties: true })
  @IsOptional()
  @IsObject()
  declare guardrails?: Readonly<Record<string, unknown>>;

  @ApiPropertyOptional({ type: 'object', additionalProperties: true })
  @IsOptional()
  @IsObject()
  declare handoffPolicy?: Readonly<Record<string, unknown>>;
}

export class UpdateAgentDto implements UpdateAgentRequest {
  @ApiPropertyOptional({ maxLength: 200 })
  @ValidateIf((_object, value) => value !== undefined)
  @IsString()
  @MinLength(1)
  @MaxLength(200)
  declare name?: string;

  @ApiPropertyOptional({ maxLength: 20_000 })
  @ValidateIf((_object, value) => value !== undefined)
  @IsString()
  @MinLength(1)
  @MaxLength(20_000)
  declare instructions?: string;

  @ApiPropertyOptional({ maxLength: 80 })
  @ValidateIf((_object, value) => value !== undefined)
  @IsString()
  @Matches(/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,79}$/)
  declare promptVersion?: string;

  @ApiPropertyOptional({ type: 'object', additionalProperties: true })
  @ValidateIf((_object, value) => value !== undefined)
  @IsObject()
  declare modelConfiguration?: Readonly<Record<string, unknown>>;

  @ApiPropertyOptional({ type: 'array', items: { type: 'string' }, maxItems: 50 })
  @ValidateIf((_object, value) => value !== undefined)
  @IsArray()
  @ArrayMaxSize(50)
  @ArrayUnique()
  @IsString({ each: true })
  @Matches(/^[a-z][a-z0-9_.-]{0,79}$/, { each: true })
  declare allowedTools?: readonly string[];

  @ApiPropertyOptional({ type: 'object', additionalProperties: true })
  @ValidateIf((_object, value) => value !== undefined)
  @IsObject()
  declare knowledgeStrategy?: Readonly<Record<string, unknown>>;

  @ApiPropertyOptional({ type: 'object', additionalProperties: true })
  @ValidateIf((_object, value) => value !== undefined)
  @IsObject()
  declare guardrails?: Readonly<Record<string, unknown>>;

  @ApiPropertyOptional({ type: 'object', additionalProperties: true })
  @ValidateIf((_object, value) => value !== undefined)
  @IsObject()
  declare handoffPolicy?: Readonly<Record<string, unknown>>;
}

export class AgentStatusDto {
  @ApiProperty({ enum: ['ACTIVE', 'ARCHIVED'] })
  @IsIn(['ACTIVE', 'ARCHIVED'])
  declare status: AgentLifecycleRequest;
}

export class ListAgentsDto implements ListAgentsRequest {
  @ApiPropertyOptional({ minimum: 1, maximum: 100, default: 50 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  declare limit?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  declare cursor?: string;

  @ApiPropertyOptional({ enum: AGENT_STATUSES })
  @IsOptional()
  @IsIn(AGENT_STATUSES)
  declare status?: AgentStatus;
}
