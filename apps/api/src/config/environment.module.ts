import { Global, Module } from '@nestjs/common';
import { type Environment, loadEnvironment } from '@vautrin/config';

/** Injection token for the validated environment. */
export const ENVIRONMENT = Symbol('ENVIRONMENT');

/**
 * Parses the environment once, at startup, and shares it through DI.
 *
 * Global because nearly every module needs some part of it, and threading it
 * manually through every constructor adds noise without adding safety.
 * Invalid configuration throws here, so the process fails to boot rather than
 * failing later on the first request that happens to need the bad value.
 */
@Global()
@Module({
  providers: [{ provide: ENVIRONMENT, useFactory: (): Environment => loadEnvironment() }],
  exports: [ENVIRONMENT],
})
export class EnvironmentModule {}
