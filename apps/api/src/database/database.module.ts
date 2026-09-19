import { Global, Module } from '@nestjs/common';

import { DatabaseService } from './database.service.js';

/**
 * Global: the data layer is infrastructure every feature module needs, and
 * re-importing it everywhere adds ceremony without adding a boundary.
 */
@Global()
@Module({
  providers: [DatabaseService],
  exports: [DatabaseService],
})
export class DatabaseModule {}
