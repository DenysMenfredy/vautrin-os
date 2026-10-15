import { writeFile } from 'node:fs/promises';
import { Injectable, type OnModuleDestroy, type OnModuleInit } from '@nestjs/common';
@Injectable()
export class WorkerHeartbeat implements OnModuleInit, OnModuleDestroy {
  private timer: ReturnType<typeof setInterval> | undefined;
  async onModuleInit(): Promise<void> {
    await this.beat();
    this.timer = setInterval(() => {
      void this.beat().catch(() => undefined);
    }, 15_000);
    this.timer.unref();
  }
  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer);
  }
  private beat(): Promise<void> {
    return writeFile('/tmp/vautrin-worker-heartbeat', String(Date.now()), { mode: 0o600 });
  }
}
