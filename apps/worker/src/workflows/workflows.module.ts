import { Module } from '@nestjs/common';
import { AgentsModule } from '../agents/agents.module.js';
import { QueuesModule } from '../queues/queues.module.js';
import { WorkflowActionProcessor } from './workflow-action.processor.js';
import { WorkflowContextBuilder } from './workflow-context.builder.js';
import { WorkflowMessageStepExecutor } from './workflow-message-step.executor.js';
import { WorkflowRunExecutor } from './workflow-run.executor.js';
import { WorkflowRunScheduler } from './workflow-run.scheduler.js';

@Module({
  imports: [QueuesModule, AgentsModule],
  providers: [
    WorkflowContextBuilder,
    WorkflowMessageStepExecutor,
    WorkflowRunExecutor,
    WorkflowRunScheduler,
    WorkflowActionProcessor,
  ],
  exports: [WorkflowRunExecutor, WorkflowRunScheduler, WorkflowActionProcessor],
})
export class WorkflowsModule {}
