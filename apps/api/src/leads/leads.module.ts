import { Module } from '@nestjs/common';

import { CrmDashboardController } from './crm-dashboard.controller.js';
import { LeadSourcesController } from './lead-sources.controller.js';
import { LeadSourcesService } from './lead-sources.service.js';
import { LeadsController } from './leads.controller.js';
import { LeadsService } from './leads.service.js';

@Module({
  controllers: [LeadsController, LeadSourcesController, CrmDashboardController],
  providers: [LeadsService, LeadSourcesService],
})
export class LeadsModule {}
