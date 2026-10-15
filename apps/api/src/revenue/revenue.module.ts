import { Module } from '@nestjs/common';
import { RevenueController } from './revenue.controller.js';
import { RevenueService } from './revenue.service.js';
@Module({
  controllers: [RevenueController],
  providers: [RevenueService],
  exports: [RevenueService],
})
export class RevenueModule {}
