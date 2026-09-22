import { ApiPropertyOptional } from '@nestjs/swagger';
import type {
  ContactJsonValue,
  CreateContactRequest,
  ListContactsRequest,
  UpdateContactRequest,
} from '@vautrin/contracts';
import { Transform, Type } from 'class-transformer';
import {
  Allow,
  IsArray,
  IsEmail,
  IsInt,
  IsOptional,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
  ValidateIf,
} from 'class-validator';

abstract class ContactFieldsDto {
  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @IsString()
  declare firstName?: string | null;

  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @IsString()
  declare lastName?: string | null;

  @ApiPropertyOptional({ nullable: true })
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @IsOptional()
  @IsEmail()
  declare email?: string | null;

  @ApiPropertyOptional({
    example: '+15551234567',
    maxLength: 16,
    nullable: true,
    description: 'Phone number in E.164 format.',
  })
  @IsOptional()
  @IsString()
  @Matches(/^\+[1-9]\d{1,14}$/)
  declare phone?: string | null;

  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @IsString()
  declare company?: string | null;

  @ApiPropertyOptional({
    nullable: true,
    description: 'Flexible JSON address value; no undocumented address shape is imposed.',
  })
  @Allow()
  declare address?: ContactJsonValue | null;

  @ApiPropertyOptional({ type: [String] })
  @ValidateIf((_object, value) => value !== undefined)
  @IsArray()
  @IsString({ each: true })
  declare tags?: readonly string[];

  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @IsString()
  declare notes?: string | null;
}

export class CreateContactDto extends ContactFieldsDto implements CreateContactRequest {}

export class UpdateContactDto extends ContactFieldsDto implements UpdateContactRequest {}

abstract class PageQueryDto implements ListContactsRequest {
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

  @ApiPropertyOptional({ maxLength: 200 })
  @ValidateIf((_object, value) => value !== undefined)
  @IsString()
  @MaxLength(200)
  declare search?: string;
}

export class ListContactsDto extends PageQueryDto implements ListContactsRequest {}
