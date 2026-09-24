import 'reflect-metadata';

import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import type { Environment } from '@vautrin/config';
import { ALL_QUEUES } from '@vautrin/queues';
import { AppModule } from './app.module.js';
import { ENVIRONMENT } from './config/environment.module.js';
import { OutboxDispatcher } from './outbox/outbox-dispatcher.service.js';

async function bootstrap(): Promise<void> {
  // A standalone context, not an HTTP server: this process registers queues
  // and exposes no port (SDD-02 §3). Processors arrive with feature modules.
  const app = await NestFactory.createApplicationContext(AppModule, { bufferLogs: true });
  const environment = app.get<Environment>(ENVIRONMENT);
  const logger = new Logger('Bootstrap');

  // Release the logs buffered during module initialisation.
  app.flushLogs();

  // Without this, SIGTERM during a deploy kills the process mid-job and the
  // work is only recovered when BullMQ's lock expires.
  app.enableShutdownHooks();

  app.get(OutboxDispatcher).start();

  logger.log(`Worker started [${environment.NODE_ENV}] with queues: ${ALL_QUEUES.join(', ')}`);
}

bootstrap().catch((error: unknown) => {
  // Nest's logger may not exist yet if configuration failed, so a bare
  // console call is the only thing guaranteed to reach the operator here.
  console.error('Failed to start the worker:', error);
  process.exit(1);
});
