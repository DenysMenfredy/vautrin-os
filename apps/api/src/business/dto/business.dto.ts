import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import type {
  BusinessListRequest,
  CreateLocationRequest,
  CreateServiceAreaRequest,
  CreateServiceRequest,
  PageRequest,
  ServiceAreaType,
  UpdateBusinessProfileRequest,
  UpdateLocationRequest,
  UpdateServiceAreaRequest,
  UpdateServiceRequest,
} from '@vautrin/contracts';
import { Transform, Type } from 'class-transformer';
import {
  IsBoolean,
  IsEmail,
  IsEnum,
  IsInt,
  IsNumber,
  IsObject,
  IsOptional,
  IsString,
  IsUrl,
  Matches,
  Max,
  MaxLength,
  Min,
  MinLength,
  ValidateIf,
} from 'class-validator';

export class UpdateBusinessProfileDto implements UpdateBusinessProfileRequest {
  @ApiPropertyOptional({ maxLength: 200 })
  @ValidateIf((_object, value) => value !== undefined)
  @IsString()
  @MinLength(1)
  @MaxLength(200)
  declare displayName?: string;

  @ApiPropertyOptional({ maxLength: 200, nullable: true })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  declare legalName?: string | null;

  @ApiPropertyOptional({ maxLength: 40, nullable: true })
  @IsOptional()
  @IsString()
  @MaxLength(40)
  declare phone?: string | null;

  @ApiPropertyOptional({ maxLength: 320, nullable: true })
  @IsOptional()
  @IsEmail()
  @MaxLength(320)
  declare email?: string | null;

  @ApiPropertyOptional({ maxLength: 2048, nullable: true })
  @IsOptional()
  @IsUrl({ protocols: ['http', 'https'], require_protocol: true })
  @MaxLength(2048)
  declare website?: string | null;

  @ApiPropertyOptional({ maxLength: 2000, nullable: true })
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  declare description?: string | null;

  @ApiPropertyOptional({ example: 'America/Belem' })
  @ValidateIf((_object, value) => value !== undefined)
  @IsString()
  @MaxLength(100)
  declare timezone?: string;

  @ApiPropertyOptional({ example: 'en-US' })
  @ValidateIf((_object, value) => value !== undefined)
  @IsString()
  @MinLength(1)
  @MaxLength(35)
  declare locale?: string;

  @ApiPropertyOptional({ example: 'USD' })
  @ValidateIf((_object, value) => value !== undefined)
  @IsString()
  @Matches(/^[A-Za-z]{3}$/)
  declare currency?: string;
}

export class CreateLocationDto implements CreateLocationRequest {
  @ApiProperty({ maxLength: 200 })
  @IsString()
  @MinLength(1)
  @MaxLength(200)
  declare name: string;

  @ApiPropertyOptional({ maxLength: 200, nullable: true })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  declare addressLine1?: string | null;

  @ApiPropertyOptional({ maxLength: 200, nullable: true })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  declare addressLine2?: string | null;

  @ApiPropertyOptional({ maxLength: 120, nullable: true })
  @IsOptional()
  @IsString()
  @MaxLength(120)
  declare city?: string | null;

  @ApiPropertyOptional({ maxLength: 120, nullable: true })
  @IsOptional()
  @IsString()
  @MaxLength(120)
  declare region?: string | null;

  @ApiPropertyOptional({ maxLength: 32, nullable: true })
  @IsOptional()
  @IsString()
  @MaxLength(32)
  declare postalCode?: string | null;

  @ApiPropertyOptional({ default: 'US', pattern: '^[A-Za-z]{2}$' })
  @ValidateIf((_object, value) => value !== undefined)
  @IsString()
  @Matches(/^[A-Za-z]{2}$/)
  declare country?: string;

  @ApiPropertyOptional({ minimum: -90, maximum: 90, nullable: true })
  @IsOptional()
  @IsNumber({ allowNaN: false, allowInfinity: false })
  @Min(-90)
  @Max(90)
  declare latitude?: number | null;

  @ApiPropertyOptional({ minimum: -180, maximum: 180, nullable: true })
  @IsOptional()
  @IsNumber({ allowNaN: false, allowInfinity: false })
  @Min(-180)
  @Max(180)
  declare longitude?: number | null;

  @ApiPropertyOptional({ maxLength: 100, nullable: true })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  declare timezone?: string | null;

  @ApiPropertyOptional({ default: false })
  @ValidateIf((_object, value) => value !== undefined)
  @IsBoolean()
  declare isPrimary?: boolean;

  @ApiPropertyOptional({ minimum: 1, nullable: true })
  @IsOptional()
  @IsInt()
  @Min(1)
  declare serviceRadiusMiles?: number | null;
}

export class UpdateLocationDto implements UpdateLocationRequest {
  @ApiPropertyOptional({ maxLength: 200 })
  @ValidateIf((_object, value) => value !== undefined)
  @IsString()
  @MinLength(1)
  @MaxLength(200)
  declare name?: string;

  @ApiPropertyOptional({ maxLength: 200, nullable: true })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  declare addressLine1?: string | null;

  @ApiPropertyOptional({ maxLength: 200, nullable: true })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  declare addressLine2?: string | null;

  @ApiPropertyOptional({ maxLength: 120, nullable: true })
  @IsOptional()
  @IsString()
  @MaxLength(120)
  declare city?: string | null;

  @ApiPropertyOptional({ maxLength: 120, nullable: true })
  @IsOptional()
  @IsString()
  @MaxLength(120)
  declare region?: string | null;

  @ApiPropertyOptional({ maxLength: 32, nullable: true })
  @IsOptional()
  @IsString()
  @MaxLength(32)
  declare postalCode?: string | null;

  @ApiPropertyOptional({ pattern: '^[A-Za-z]{2}$' })
  @ValidateIf((_object, value) => value !== undefined)
  @IsString()
  @Matches(/^[A-Za-z]{2}$/)
  declare country?: string;

  @ApiPropertyOptional({ minimum: -90, maximum: 90, nullable: true })
  @IsOptional()
  @IsNumber({ allowNaN: false, allowInfinity: false })
  @Min(-90)
  @Max(90)
  declare latitude?: number | null;

  @ApiPropertyOptional({ minimum: -180, maximum: 180, nullable: true })
  @IsOptional()
  @IsNumber({ allowNaN: false, allowInfinity: false })
  @Min(-180)
  @Max(180)
  declare longitude?: number | null;

  @ApiPropertyOptional({ maxLength: 100, nullable: true })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  declare timezone?: string | null;

  @ApiPropertyOptional()
  @ValidateIf((_object, value) => value !== undefined)
  @IsBoolean()
  declare isPrimary?: boolean;

  @ApiPropertyOptional({ minimum: 1, nullable: true })
  @IsOptional()
  @IsInt()
  @Min(1)
  declare serviceRadiusMiles?: number | null;
}

export class CreateServiceDto implements CreateServiceRequest {
  @ApiProperty({ example: 'kitchen-remodeling', maxLength: 80 })
  @IsString()
  @Matches(/^[a-z0-9][a-z0-9-]{0,79}$/)
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

  @ApiPropertyOptional({ default: true })
  @ValidateIf((_object, value) => value !== undefined)
  @IsBoolean()
  declare active?: boolean;

  @ApiPropertyOptional({ type: 'object', additionalProperties: true })
  @ValidateIf((_object, value) => value !== undefined)
  @IsObject()
  declare metadata?: Readonly<Record<string, unknown>>;
}

export class UpdateServiceDto implements UpdateServiceRequest {
  @ApiPropertyOptional({ maxLength: 80 })
  @ValidateIf((_object, value) => value !== undefined)
  @IsString()
  @Matches(/^[a-z0-9][a-z0-9-]{0,79}$/)
  declare key?: string;

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

  @ApiPropertyOptional()
  @ValidateIf((_object, value) => value !== undefined)
  @IsBoolean()
  declare active?: boolean;

  @ApiPropertyOptional({ type: 'object', additionalProperties: true })
  @ValidateIf((_object, value) => value !== undefined)
  @IsObject()
  declare metadata?: Readonly<Record<string, unknown>>;
}

export class CreateServiceAreaDto implements CreateServiceAreaRequest {
  @ApiProperty({ enum: ['CITY', 'POSTAL_CODE', 'RADIUS', 'REGION'] })
  @IsEnum({ CITY: 'CITY', POSTAL_CODE: 'POSTAL_CODE', RADIUS: 'RADIUS', REGION: 'REGION' })
  declare type: ServiceAreaType;

  @ApiProperty({ maxLength: 250 })
  @IsString()
  @MinLength(1)
  @MaxLength(250)
  declare value: string;

  @ApiPropertyOptional({ type: 'object', additionalProperties: true })
  @ValidateIf((_object, value) => value !== undefined)
  @IsObject()
  declare configuration?: Readonly<Record<string, unknown>>;

  @ApiPropertyOptional({ default: true })
  @ValidateIf((_object, value) => value !== undefined)
  @IsBoolean()
  declare active?: boolean;
}

export class UpdateServiceAreaDto implements UpdateServiceAreaRequest {
  @ApiPropertyOptional({ enum: ['CITY', 'POSTAL_CODE', 'RADIUS', 'REGION'] })
  @ValidateIf((_object, value) => value !== undefined)
  @IsEnum({ CITY: 'CITY', POSTAL_CODE: 'POSTAL_CODE', RADIUS: 'RADIUS', REGION: 'REGION' })
  declare type?: ServiceAreaType;

  @ApiPropertyOptional({ maxLength: 250 })
  @ValidateIf((_object, value) => value !== undefined)
  @IsString()
  @MinLength(1)
  @MaxLength(250)
  declare value?: string;

  @ApiPropertyOptional({ type: 'object', additionalProperties: true })
  @ValidateIf((_object, value) => value !== undefined)
  @IsObject()
  declare configuration?: Readonly<Record<string, unknown>>;

  @ApiPropertyOptional()
  @ValidateIf((_object, value) => value !== undefined)
  @IsBoolean()
  declare active?: boolean;
}

abstract class PageQueryDto implements PageRequest {
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

export class ListLocationsDto extends PageQueryDto implements Omit<BusinessListRequest, 'active'> {
  @ApiPropertyOptional({ maxLength: 200 })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  declare search?: string;
}

export class ListBusinessItemsDto extends PageQueryDto implements BusinessListRequest {
  @ApiPropertyOptional({ maxLength: 200 })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  declare search?: string;

  @ApiPropertyOptional({ enum: ['true', 'false'] })
  @IsOptional()
  @Transform(({ value }) => (value === 'true' ? true : value === 'false' ? false : value))
  @IsBoolean()
  declare active?: boolean;
}
