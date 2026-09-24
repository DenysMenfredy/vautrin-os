import { Module } from '@nestjs/common';

import { QueuesModule } from '../queues/queues.module.js';
import { WorkflowRunExecutor } from './workflow-run.executor.js';
import { WorkflowRunScheduler } from './workflow-run.scheduler.js';

@Module({
  imports: [QueuesModule],
  providers: [WorkflowRunExecutor, WorkflowRunScheduler],
  exports: [WorkflowRunExecutor, WorkflowRunScheduler],
})
export class WorkflowsModule {}
