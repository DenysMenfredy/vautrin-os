import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsIn, IsInt, IsOptional, IsString, IsUUID, Max, MaxLength, Min } from 'class-validator';
export class OperationsListDto {
  @ApiPropertyOptional()
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(200) cursor?: string;
  @ApiPropertyOptional()
  @IsOptional()
  @IsIn(['PENDING', 'RUNNING', 'WAITING', 'COMPLETED', 'FAILED', 'CANCELLED'])
  status?: 'PENDING' | 'RUNNING' | 'WAITING' | 'COMPLETED' | 'FAILED' | 'CANCELLED';
  @ApiPropertyOptional() @IsOptional() @IsUUID() leadId?: string;
}
