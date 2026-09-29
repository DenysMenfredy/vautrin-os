import { Module } from '@nestjs/common';
import { IntegrationsModule } from '../integrations/integrations.module.js';

import { AppointmentsController } from './appointments.controller.js';
import { AppointmentsService } from './appointments.service.js';
import { BookingService } from './booking.service.js';

@Module({
  imports: [IntegrationsModule],
  controllers: [AppointmentsController],
  providers: [AppointmentsService, BookingService],
  exports: [AppointmentsService],
})
export class AppointmentsModule {}
