import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import type { LoginRequest, SwitchTenantRequest } from '@vautrin/contracts';
import { IsEmail, IsOptional, IsString, IsUUID, MaxLength, MinLength } from 'class-validator';

/**
 * Request DTOs (AGENTS.md §8 — validate external input at the boundary).
 *
 * The global ValidationPipe runs with `whitelist` and `forbidNonWhitelisted`,
 * so anything not declared here is stripped and then rejected.
 */

export class LoginDto implements LoginRequest {
  @ApiProperty({ example: 'owner@example.com' })
  @IsEmail({}, { message: 'email must be a valid email address' })
  @MaxLength(320)
  declare email: string;

  /**
   * Bounded at both ends. The minimum is a floor on guessability; the
   * maximum matters more than it looks — Argon2 hashes whatever it is
   * given, so an unbounded field is a cheap way to burn server CPU.
   */
  @ApiProperty({ example: 'correct horse battery staple', minLength: 12, maxLength: 200 })
  @IsString()
  @MinLength(12)
  @MaxLength(200)
  declare password: string;
}

export class RefreshDto {
  @ApiPropertyOptional({ description: 'Omit when the refresh token is sent as a cookie.' })
  @IsOptional()
  @IsString()
  @MaxLength(512)
  declare refreshToken?: string;
}

export class SwitchTenantDto implements SwitchTenantRequest {
  @ApiProperty({ format: 'uuid' })
  @IsUUID()
  declare tenantId: string;
}
