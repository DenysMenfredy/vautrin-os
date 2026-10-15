import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  Max,
  Min,
} from 'class-validator';

export class MissedCallDto {
  @ApiProperty({ example: '+15125550101' }) @Matches(/^\+[1-9]\d{7,14}$/) fromNumber!: string;
  @ApiProperty() @IsUUID() idempotencyKey!: string;
}
export class RemodelingTemplateDto {
  @ApiProperty({ example: ['78701'] })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(100)
  @Matches(/^\d{5}$/, { each: true })
  postalCodes!: string[];
  @ApiProperty({ example: 'America/Chicago' })
  @IsString()
  @Matches(/^(?:UTC|[A-Za-z_]+(?:\/[A-Za-z_+-]+)+)$/)
  timezone!: string;
  @ApiProperty({ description: 'Explicit OpenAI model identifier' })
  @IsString()
  @Matches(/^[a-zA-Z0-9][a-zA-Z0-9_.:-]{0,99}$/)
  model!: string;
  @ApiPropertyOptional({ default: 30000 })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(3600000)
  recoveryDelayMs?: number;
  @ApiPropertyOptional({ default: [7200000, 86400000] })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(3)
  @IsInt({ each: true })
  @Min(1, { each: true })
  @Max(604800000, { each: true })
  followUpDelaysMs?: number[];
}
