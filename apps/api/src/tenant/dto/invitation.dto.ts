import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import type { AcceptInvitationRequest, CreateInvitationRequest } from '@vautrin/contracts';
import {
  IsEmail,
  IsIn,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  MinLength,
} from 'class-validator';

export class CreateInvitationDto implements CreateInvitationRequest {
  @ApiProperty({ example: 'member@example.com' })
  @IsEmail()
  @MaxLength(320)
  declare email: string;

  @ApiProperty({ enum: ['OWNER', 'ADMIN', 'MANAGER', 'STAFF', 'READ_ONLY'] })
  @IsIn(['OWNER', 'ADMIN', 'MANAGER', 'STAFF', 'READ_ONLY'])
  declare role: 'OWNER' | 'ADMIN' | 'MANAGER' | 'STAFF' | 'READ_ONLY';
}

export class AcceptInvitationDto implements AcceptInvitationRequest {
  @ApiProperty({
    description: 'One-time token delivered by the inviter',
    minLength: 43,
    maxLength: 43,
  })
  @IsString()
  @Matches(/^[A-Za-z0-9_-]{43}$/)
  declare token: string;

  @ApiProperty({ minLength: 12, maxLength: 200 })
  @IsString()
  @MinLength(12)
  @MaxLength(200)
  declare password: string;

  @ApiPropertyOptional({ maxLength: 200 })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  declare name?: string;
}
