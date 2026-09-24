import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  type AssignLeadRequest,
  type CreateLeadRequest,
  type CreateLeadSourceRequest,
  LEAD_STATUSES,
  type LeadStatus,
  type ListLeadSourcesRequest,
  type ListLeadsRequest,
  type TransitionLeadRequest,
  type UpdateLeadRequest,
  type UpdateLeadSourceRequest,
} from '@vautrin/contracts';
import { Transform, Type } from 'class-transformer';
import {
  IsBoolean,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  Max,
  MaxLength,
  Min,
  MinLength,
  ValidateIf,
} from 'class-validator';

const MONEY_PATTERN = /^(?:0|[1-9]\d{0,9})(?:\.\d{1,2})?$/;

abstract class PageQueryDto {
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

export class ListLeadsDto extends PageQueryDto implements ListLeadsRequest {
  @ApiPropertyOptional({ enum: LEAD_STATUSES })
  @IsOptional()
  @IsIn(LEAD_STATUSES)
  declare status?: LeadStatus;

  @ApiPropertyOptional({ format: 'uuid' })
  @IsOptional()
  @IsUUID()
  declare sourceId?: string;

  @ApiPropertyOptional({ format: 'uuid' })
  @IsOptional()
  @IsUUID()
  declare assignedUserId?: string;

  @ApiPropertyOptional({ maxLength: 200 })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  declare search?: string;
}

export class ListLeadSourcesDto extends PageQueryDto implements ListLeadSourcesRequest {
  @ApiPropertyOptional({ enum: ['true', 'false'] })
  @IsOptional()
  @Transform(({ value }) => (value === 'true' ? true : value === 'false' ? false : value))
  @IsBoolean()
  declare active?: boolean;

  @ApiPropertyOptional({ maxLength: 200 })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  declare search?: string;
}

export class CreateLeadSourceDto implements CreateLeadSourceRequest {
  @ApiProperty({ example: 'website', pattern: '^[a-z0-9][a-z0-9-]{0,79}$' })
  @IsString()
  @Matches(/^[a-z0-9][a-z0-9-]{0,79}$/)
  declare key: string;

  @ApiProperty()
  @IsString()
  @MinLength(1)
  declare label: string;

  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @IsString()
  declare category?: string | null;
}

export class UpdateLeadSourceDto implements UpdateLeadSourceRequest {
  @ApiPropertyOptional({ pattern: '^[a-z0-9][a-z0-9-]{0,79}$' })
  @ValidateIf((_object, value) => value !== undefined)
  @IsString()
  @Matches(/^[a-z0-9][a-z0-9-]{0,79}$/)
  declare key?: string;

  @ApiPropertyOptional()
  @ValidateIf((_object, value) => value !== undefined)
  @IsString()
  @MinLength(1)
  declare label?: string;

  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @IsString()
  declare category?: string | null;

  @ApiPropertyOptional()
  @ValidateIf((_object, value) => value !== undefined)
  @IsBoolean()
  declare isActive?: boolean;
}

abstract class LeadEditableFieldsDto {
  @ApiPropertyOptional({ format: 'uuid', nullable: true })
  @IsOptional()
  @IsUUID()
  declare sourceId?: string | null;

  @ApiPropertyOptional({ description: 'Key of an active tenant service.', nullable: true })
  @IsOptional()
  @IsString()
  declare service?: string | null;

  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @IsString()
  declare title?: string | null;

  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @IsString()
  declare description?: string | null;

  @ApiPropertyOptional({ pattern: MONEY_PATTERN.source, nullable: true })
  @IsOptional()
  @IsString()
  @Matches(MONEY_PATTERN)
  declare estimatedValue?: string | null;
}

export class CreateLeadDto extends LeadEditableFieldsDto implements CreateLeadRequest {
  @ApiProperty({ format: 'uuid' })
  @IsUUID()
  declare contactId: string;
}

export class UpdateLeadDto extends LeadEditableFieldsDto implements UpdateLeadRequest {
  @ApiProperty({ minimum: 0, description: 'Current optimistic concurrency version.' })
  @IsInt()
  @Min(0)
  declare version: number;
}

export class TransitionLeadDto implements TransitionLeadRequest {
  @ApiProperty({ minimum: 0 })
  @IsInt()
  @Min(0)
  declare version: number;

  @ApiProperty({ enum: LEAD_STATUSES })
  @IsIn(LEAD_STATUSES)
  declare status: LeadStatus;
}

export class AssignLeadDto implements AssignLeadRequest {
  @ApiProperty({ minimum: 0 })
  @IsInt()
  @Min(0)
  declare version: number;

  @ApiProperty({ format: 'uuid', nullable: true })
  @ValidateIf((_object, value) => value !== null)
  @IsUUID()
  declare assignedUserId: string | null;
}
