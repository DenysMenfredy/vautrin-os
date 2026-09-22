import { Module } from '@nestjs/common';
import { CustomFieldValueCapabilityGuard } from '../authz/custom-field-value-capability.guard.js';
import { BusinessController } from './business.controller.js';
import { BusinessService } from './business.service.js';
import { CustomFieldsController } from './custom-fields.controller.js';
import { CustomFieldsService } from './custom-fields.service.js';

@Module({
  controllers: [BusinessController, CustomFieldsController],
  providers: [BusinessService, CustomFieldsService, CustomFieldValueCapabilityGuard],
})
export class BusinessModule {}
