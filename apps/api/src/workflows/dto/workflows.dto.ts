import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  type CreateWorkflowRequest,
  type ListWorkflowsRequest,
  type UpdateWorkflowRequest,
  WORKFLOW_STATUSES,
  type WorkflowDefinition,
  type WorkflowLifecycleRequest,
  type WorkflowStatus,
} from '@vautrin/contracts';
import { Type } from 'class-transformer';
import {
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

export class CreateWorkflowDto implements CreateWorkflowRequest {
  @ApiProperty({ example: 'missed_call_recovery_v1', maxLength: 80 })
  @IsString()
  @Matches(/^[a-z0-9][a-z0-9_-]{0,79}$/)
  declare key: string;

  @ApiProperty({ maxLength: 200 })
  @IsString()
  @MinLength(1)
  @MaxLength(200)
  declare name: string;

  @ApiPropertyOptional({ maxLength: 2000, nullable: true })
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  declare description?: string | null;

  @ApiProperty({ example: 'call.missed', maxLength: 100 })
  @IsString()
  @Matches(/^[a-z][a-z0-9]*(?:[._-][a-z0-9]+)*$/)
  @MaxLength(100)
  declare trigger: string;

  @ApiProperty({
    type: 'object',
    additionalProperties: true,
    example: { steps: [{ id: 'initial-wait', type: 'wait', config: {} }] },
  })
  @IsObject()
  declare definition: WorkflowDefinition;

  @ApiPropertyOptional({ type: 'array', items: { type: 'object' } })
  @ValidateIf((_object, value) => value !== undefined)
  @IsArray()
  @IsObject({ each: true })
  declare conditions?: readonly Readonly<Record<string, unknown>>[];

  @ApiPropertyOptional({ type: 'object', additionalProperties: true })
  @ValidateIf((_object, value) => value !== undefined)
  @IsObject()
  declare retryPolicy?: Readonly<Record<string, unknown>>;

  @ApiPropertyOptional({ type: 'object', additionalProperties: true })
  @ValidateIf((_object, value) => value !== undefined)
  @IsObject()
  declare failurePolicy?: Readonly<Record<string, unknown>>;
}

export class UpdateWorkflowDto implements UpdateWorkflowRequest {
  @ApiPropertyOptional({ maxLength: 200 })
  @ValidateIf((_object, value) => value !== undefined)
  @IsString()
  @MinLength(1)
  @MaxLength(200)
  declare name?: string;

  @ApiPropertyOptional({ maxLength: 2000, nullable: true })
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  declare description?: string | null;

  @ApiPropertyOptional({ example: 'call.missed', maxLength: 100 })
  @ValidateIf((_object, value) => value !== undefined)
  @IsString()
  @Matches(/^[a-z][a-z0-9]*(?:[._-][a-z0-9]+)*$/)
  @MaxLength(100)
  declare trigger?: string;

  @ApiPropertyOptional({ type: 'object', additionalProperties: true })
  @ValidateIf((_object, value) => value !== undefined)
  @IsObject()
  declare definition?: WorkflowDefinition;

  @ApiPropertyOptional({ type: 'array', items: { type: 'object' } })
  @ValidateIf((_object, value) => value !== undefined)
  @IsArray()
  @IsObject({ each: true })
  declare conditions?: readonly Readonly<Record<string, unknown>>[];

  @ApiPropertyOptional({ type: 'object', additionalProperties: true })
  @ValidateIf((_object, value) => value !== undefined)
  @IsObject()
  declare retryPolicy?: Readonly<Record<string, unknown>>;

  @ApiPropertyOptional({ type: 'object', additionalProperties: true })
  @ValidateIf((_object, value) => value !== undefined)
  @IsObject()
  declare failurePolicy?: Readonly<Record<string, unknown>>;
}

export class WorkflowStatusDto {
  @ApiProperty({ enum: ['ACTIVE', 'PAUSED', 'ARCHIVED'] })
  @IsIn(['ACTIVE', 'PAUSED', 'ARCHIVED'])
  declare status: WorkflowLifecycleRequest;
}

export class ListWorkflowsDto implements ListWorkflowsRequest {
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

  @ApiPropertyOptional({ enum: WORKFLOW_STATUSES })
  @IsOptional()
  @IsIn(WORKFLOW_STATUSES)
  declare status?: WorkflowStatus;

  @ApiPropertyOptional({ maxLength: 100 })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  declare trigger?: string;
}
