import { Module } from '@nestjs/common';

import { AgentContextBuilder } from './agent-context.builder.js';
import { AgentRunTelemetry } from './agent-run.telemetry.js';
import { DatabaseAgentToolAuditSink } from './agent-tool-audit.sink.js';

@Module({
  providers: [AgentContextBuilder, AgentRunTelemetry, DatabaseAgentToolAuditSink],
  exports: [AgentContextBuilder, AgentRunTelemetry, DatabaseAgentToolAuditSink],
})
export class AgentsModule {}
