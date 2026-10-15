import { Injectable } from '@nestjs/common';
import { GoogleCalendarProvider } from '@vautrin/integrations';
import { BookingApplication } from '@vautrin/revenue';
import { DatabaseService } from '../database/database.service.js';
import { GoogleCalendarIntegrationService } from '../integrations/google-calendar-integration.service.js';

@Injectable()
export class BookingService extends BookingApplication {
  constructor(
    database: DatabaseService,
    integrations: GoogleCalendarIntegrationService,
    calendar: GoogleCalendarProvider,
  ) {
    super(database, integrations, calendar);
  }
}
