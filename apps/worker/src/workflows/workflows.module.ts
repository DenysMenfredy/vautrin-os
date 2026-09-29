import { Module } from '@nestjs/common';

import { QueuesModule } from '../queues/queues.module.js';
import { WorkflowContextBuilder } from './workflow-context.builder.js';
import { WorkflowMessageStepExecutor } from './workflow-message-step.executor.js';
import { WorkflowRunExecutor } from './workflow-run.executor.js';
import { WorkflowRunScheduler } from './workflow-run.scheduler.js';

@Module({
  imports: [QueuesModule],
  providers: [
    WorkflowContextBuilder,
    WorkflowMessageStepExecutor,
    WorkflowRunExecutor,
    WorkflowRunScheduler,
  ],
  exports: [WorkflowRunExecutor, WorkflowRunScheduler],
})
export class WorkflowsModule {}
