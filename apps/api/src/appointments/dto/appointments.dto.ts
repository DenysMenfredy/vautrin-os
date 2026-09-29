import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  APPOINTMENT_STATUSES,
  type AppointmentStatus,
  type CancelAppointmentRequest,
  type CheckAvailabilityRequest,
  type CreateAppointmentRequest,
  type ListAppointmentsRequest,
  type RescheduleAppointmentRequest,
} from '@vautrin/contracts';
import { Type } from 'class-transformer';
import {
  IsDateString,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  Max,
  MaxLength,
  Min,
} from 'class-validator';

const APPOINTMENT_TYPE_ID = /^[a-z0-9][a-z0-9-]{0,79}$/;

export class ListAppointmentsDto implements ListAppointmentsRequest {
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

  @ApiPropertyOptional({ enum: APPOINTMENT_STATUSES })
  @IsOptional()
  @IsIn(APPOINTMENT_STATUSES)
  declare status?: AppointmentStatus;

  @ApiPropertyOptional({ format: 'uuid' })
  @IsOptional()
  @IsUUID()
  declare contactId?: string;

  @ApiPropertyOptional({ format: 'uuid' })
  @IsOptional()
  @IsUUID()
  declare leadId?: string;

  @ApiPropertyOptional({ format: 'uuid' })
  @IsOptional()
  @IsUUID()
  declare locationId?: string;

  @ApiPropertyOptional({ format: 'date-time' })
  @IsOptional()
  @IsDateString()
  declare startsAfter?: string;

  @ApiPropertyOptional({ format: 'date-time' })
  @IsOptional()
  @IsDateString()
  declare startsBefore?: string;
}

export class CheckAvailabilityDto implements CheckAvailabilityRequest {
  @ApiProperty({ format: 'uuid' })
  @IsUUID()
  declare leadId: string;

  @ApiProperty({ pattern: APPOINTMENT_TYPE_ID.source })
  @Matches(APPOINTMENT_TYPE_ID)
  declare appointmentTypeId: string;

  @ApiProperty({ format: 'date-time' })
  @IsDateString()
  declare from: string;

  @ApiProperty({ format: 'date-time' })
  @IsDateString()
  declare to: string;
}

export class CreateAppointmentDto implements CreateAppointmentRequest {
  @ApiProperty({ format: 'uuid' })
  @IsUUID()
  declare leadId: string;

  @ApiProperty({ pattern: APPOINTMENT_TYPE_ID.source })
  @Matches(APPOINTMENT_TYPE_ID)
  declare appointmentTypeId: string;

  @ApiProperty({ format: 'date-time' })
  @IsDateString()
  declare startsAt: string;

  @ApiProperty({ format: 'uuid' })
  @IsUUID()
  declare idempotencyKey: string;
}

export class CancelAppointmentDto implements CancelAppointmentRequest {
  @ApiPropertyOptional({ maxLength: 500 })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  declare reason?: string;
}

export class RescheduleAppointmentDto implements RescheduleAppointmentRequest {
  @ApiProperty({ format: 'date-time' })
  @IsDateString()
  declare startsAt: string;

  @ApiProperty({ format: 'uuid' })
  @IsUUID()
  declare idempotencyKey: string;
}
