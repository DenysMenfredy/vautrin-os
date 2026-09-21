import { Global, Module } from '@nestjs/common';

import { AuditService } from './audit.service.js';

/** Global: almost every state-changing module needs to write an audit record. */
@Global()
@Module({
  providers: [AuditService],
  exports: [AuditService],
})
export class AuditModule {}
