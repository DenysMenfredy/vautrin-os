import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { PLATFORM_ROLES, type PlatformRoleName, type TenantRoleName } from '@vautrin/contracts';
import { Transform, Type } from 'class-transformer';
import {
  Equals,
  IsBoolean,
  IsEmail,
  IsIn,
  IsInt,
  IsISO8601,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  Max,
  MaxLength,
  Min,
  MinLength,
  ValidateNested,
} from 'class-validator';

const ROLES = ['OWNER', 'ADMIN', 'MANAGER', 'STAFF', 'READ_ONLY'];
export class AdminListQuery {
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(200) q?: string;
  @ApiPropertyOptional()
  @IsOptional()
  @IsIn(['PENDING', 'ACTIVE', 'DISABLED', 'DELETED', 'SUSPENDED', 'ARCHIVED'])
  status?: string;
  @ApiPropertyOptional() @IsOptional() @IsUUID() tenantId?: string;
  @ApiPropertyOptional() @IsOptional() @IsIn(ROLES) role?: TenantRoleName;
  @ApiPropertyOptional() @IsOptional() @IsISO8601({ strict: true }) createdFrom?: string;
  @ApiPropertyOptional() @IsOptional() @IsISO8601({ strict: true }) createdTo?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(1000) cursor?: string;
  @ApiPropertyOptional({ default: 25, maximum: 100 })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit = 25;
  @ApiPropertyOptional() @IsIn(['createdAt:desc', 'createdAt:asc']) sort:
    | 'createdAt:desc'
    | 'createdAt:asc' = 'createdAt:desc';
}
export class AdminAuditQuery extends AdminListQuery {
  @ApiPropertyOptional() @IsOptional() @IsUUID() actorUserId?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(80) targetType?: string;
  @ApiPropertyOptional() @IsOptional() @IsUUID() targetId?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(100) action?: string;
  @ApiPropertyOptional() @IsOptional() @IsISO8601({ strict: true }) from?: string;
  @ApiPropertyOptional() @IsOptional() @IsISO8601({ strict: true }) to?: string;
}
export class AdminAnalyticsQuery {
  @ApiPropertyOptional({ default: 12 }) @Type(() => Number) @IsInt() @Min(1) @Max(36) months = 12;
}
export class AdminLoginDto {
  @ApiProperty() @IsEmail() @MaxLength(320) email!: string;
  @ApiProperty() @IsString() @MinLength(1) @MaxLength(256) password!: string;
}
export class AdminReasonDto {
  @ApiProperty()
  @Transform(({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value))
  @IsString()
  @MinLength(3)
  @MaxLength(500)
  reason!: string;
}
export class AdminDeleteUserDto extends AdminReasonDto {
  @ApiProperty({ enum: ['DELETE'] }) @Equals('DELETE') confirmation!: 'DELETE';
}
export class AdminEditUserDto {
  @ApiProperty()
  @Transform(({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value))
  @IsString()
  @MinLength(1)
  @MaxLength(200)
  name!: string;
}
export class AdminOwnerDto {
  @ApiProperty() @IsEmail() @MaxLength(320) email!: string;
}
export class AdminCreateTenantDto {
  @ApiProperty()
  @Transform(({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value))
  @IsString()
  @MinLength(2)
  @MaxLength(200)
  name!: string;
  @ApiPropertyOptional() @IsOptional() @Matches(/^[a-z0-9][a-z0-9-]{1,62}$/) slug?: string;
  @ApiProperty() @IsString() @MaxLength(100) timezone = 'UTC';
  @ApiPropertyOptional() @IsIn(['remodeling', 'generic-local-business']) template:
    | 'remodeling'
    | 'generic-local-business' = 'remodeling';
  @ApiPropertyOptional({ type: AdminOwnerDto })
  @IsOptional()
  @ValidateNested()
  @Type(() => AdminOwnerDto)
  owner?: AdminOwnerDto;
}
export class AdminEditTenantDto {
  @ApiPropertyOptional()
  @IsOptional()
  @Transform(({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value))
  @IsString()
  @MinLength(2)
  @MaxLength(200)
  name?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(100) timezone?: string;
  @ApiPropertyOptional() @IsOptional() @IsIn(['remodeling', 'generic-local-business']) template?:
    | 'remodeling'
    | 'generic-local-business';
}
export class AdminInvitationDto extends AdminOwnerDto {
  @ApiProperty() @IsUUID() tenantId!: string;
  @ApiProperty() @IsIn(ROLES) role!: TenantRoleName;
  @ApiPropertyOptional() @IsOptional() @IsBoolean() reissue?: boolean;
}
export class AdminMembershipDto {
  @ApiProperty() @IsUUID() tenantId!: string;
  @ApiProperty() @IsIn(ROLES) role!: TenantRoleName;
}
export class AdminMembershipRoleDto {
  @ApiProperty() @IsIn(ROLES) role!: TenantRoleName;
}
export class AdminPlatformAccessDto extends AdminReasonDto {
  @ApiProperty({ enum: PLATFORM_ROLES }) @IsIn(PLATFORM_ROLES) role!: PlatformRoleName;
  @ApiProperty() @IsIn(['ACTIVE', 'SUSPENDED']) status: 'ACTIVE' | 'SUSPENDED' = 'ACTIVE';
}
