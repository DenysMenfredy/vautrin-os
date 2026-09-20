import 'reflect-metadata';

import { Logger, ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import type { Environment } from '@vautrin/config';
import helmet from 'helmet';

import { AppModule } from './app.module.js';
import { AllExceptionsFilter } from './common/all-exceptions.filter.js';
import { ENVIRONMENT } from './config/environment.module.js';

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(AppModule, { bufferLogs: true });
  const environment = app.get<Environment>(ENVIRONMENT);
  const logger = new Logger('Bootstrap');

  // Release the logs buffered during module initialisation.
  app.flushLogs();

  /**
   * Security headers (SDD-09).
   *
   * `nosniff` is the one that matters most for a JSON API: without it a
   * browser may content-sniff a response into something executable.
   *
   * CSP is disabled here because this process serves JSON, not documents —
   * a policy on an API response protects nothing and only shows up as noise.
   * The frontend sets its own; see apps/web/nuxt.config.ts.
   *
   * helmet also removes X-Powered-By, which was advertising Express.
   */
  app.use(
    helmet({
      contentSecurityPolicy: false,
      crossOriginEmbedderPolicy: false,
    }),
  );

  app.setGlobalPrefix(environment.API_GLOBAL_PREFIX);

  // AGENTS.md §8: validate external input at the boundary.
  // `whitelist` strips unknown properties and `forbidNonWhitelisted` rejects
  // them outright, so a client cannot smuggle fields past a DTO — which is
  // how mass-assignment bugs usually start.
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
      transformOptions: { enableImplicitConversion: false },
    }),
  );

  app.useGlobalFilters(new AllExceptionsFilter());

  // Lets onModuleDestroy run on SIGTERM, so in-flight work finishes and the
  // database pool closes cleanly during a rolling deploy (SDD-12 §6).
  app.enableShutdownHooks();

  if (environment.NODE_ENV !== 'production') {
    // AGENTS.md §8: document public API behaviour with OpenAPI. Served only
    // outside production until authentication is in place (VOS-030).
    const document = SwaggerModule.createDocument(
      app,
      new DocumentBuilder()
        .setTitle('Vautrin OS API')
        .setDescription('Multi-tenant revenue workflow platform for local businesses')
        .setVersion('0.1')
        .addBearerAuth()
        .build(),
    );
    SwaggerModule.setup(`${environment.API_GLOBAL_PREFIX}/docs`, app, document);
  }

  await app.listen(environment.API_PORT);

  logger.log(`API listening on port ${environment.API_PORT} [${environment.NODE_ENV}]`);
}

bootstrap().catch((error: unknown) => {
  // Nest's logger may not exist yet if configuration failed, so a bare
  // console call is the only thing guaranteed to reach the operator here.
  console.error('Failed to start the API:', error);
  process.exit(1);
});
