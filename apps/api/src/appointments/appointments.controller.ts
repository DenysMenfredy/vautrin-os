import { Body, Controller, Get, Param, ParseUUIDPipe, Post, Query } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import type {
  AppointmentPageResponse,
  AppointmentResponse,
  AvailabilityResponse,
} from '@vautrin/contracts';

import type { AuthenticatedRequestContext } from '../auth/decorators/current-auth.decorator.js';
import { ActiveTenant, CurrentAuth } from '../auth/decorators/current-auth.decorator.js';
import { RequireCapability } from '../authz/capability.decorator.js';
import { AppointmentsService } from './appointments.service.js';
import {
  CancelAppointmentDto,
  CheckAvailabilityDto,
  CreateAppointmentDto,
  ListAppointmentsDto,
  RescheduleAppointmentDto,
} from './dto/appointments.dto.js';

@ApiTags('appointments')
@Controller('appointments')
export class AppointmentsController {
  constructor(private readonly appointments: AppointmentsService) {}

  @Get()
  @RequireCapability('appointment.read')
  @ApiOperation({ summary: 'List active-tenant appointments' })
  list(
    @ActiveTenant() tenantId: string,
    @Query() query: ListAppointmentsDto,
  ): Promise<AppointmentPageResponse> {
    return this.appointments.list(tenantId, query);
  }

  @Post('availability')
  @RequireCapability('appointment.read')
  @ApiOperation({ summary: 'Check policy-approved appointment slots' })
  availability(
    @ActiveTenant() tenantId: string,
    @Body() input: CheckAvailabilityDto,
  ): Promise<AvailabilityResponse> {
    return this.appointments.availability(tenantId, input);
  }

  @Post()
  @RequireCapability('appointment.write')
  @ApiOperation({ summary: 'Book a policy-approved appointment' })
  create(
    @ActiveTenant() tenantId: string,
    @CurrentAuth() auth: AuthenticatedRequestContext,
    @Body() input: CreateAppointmentDto,
  ): Promise<AppointmentResponse> {
    return this.appointments.create(tenantId, auth.userId, input);
  }

  @Get(':appointmentId')
  @RequireCapability('appointment.read')
  @ApiOperation({ summary: 'Read an active-tenant appointment' })
  get(
    @ActiveTenant() tenantId: string,
    @Param('appointmentId', new ParseUUIDPipe()) appointmentId: string,
  ): Promise<AppointmentResponse> {
    return this.appointments.get(tenantId, appointmentId);
  }

  @Post(':appointmentId/cancel')
  @RequireCapability('appointment.write')
  @ApiOperation({ summary: 'Cancel an appointment when the V1 policy permits it' })
  cancel(
    @ActiveTenant() tenantId: string,
    @CurrentAuth() auth: AuthenticatedRequestContext,
    @Param('appointmentId', new ParseUUIDPipe()) appointmentId: string,
    @Body() input: CancelAppointmentDto,
  ): Promise<AppointmentResponse> {
    return this.appointments.cancel(tenantId, auth.userId, appointmentId, input);
  }

  @Post(':appointmentId/reschedule')
  @RequireCapability('appointment.write')
  @ApiOperation({ summary: 'Reschedule after independent policy and availability checks' })
  reschedule(
    @ActiveTenant() tenantId: string,
    @CurrentAuth() auth: AuthenticatedRequestContext,
    @Param('appointmentId', new ParseUUIDPipe()) appointmentId: string,
    @Body() input: RescheduleAppointmentDto,
  ): Promise<AppointmentResponse> {
    return this.appointments.reschedule(tenantId, auth.userId, appointmentId, input);
  }
}
