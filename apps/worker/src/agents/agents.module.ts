import { Module } from '@nestjs/common';
import {
  GoogleCalendarProvider,
  GoogleOAuthTokenProvider,
  OpenAILLMProvider,
} from '@vautrin/integrations';
import { AgentContextBuilder } from './agent-context.builder.js';
import { AgentRunTelemetry } from './agent-run.telemetry.js';
import { DatabaseAgentToolAuditSink } from './agent-tool-audit.sink.js';
import { LLM_PROVIDER, ReceptionistRuntime } from './receptionist-runtime.js';
import { ReceptionistTools } from './receptionist-tools.js';

@Module({
  providers: [
    AgentContextBuilder,
    AgentRunTelemetry,
    DatabaseAgentToolAuditSink,
    ReceptionistTools,
    ReceptionistRuntime,
    { provide: GoogleCalendarProvider, useFactory: () => new GoogleCalendarProvider() },
    { provide: GoogleOAuthTokenProvider, useFactory: () => new GoogleOAuthTokenProvider() },
    {
      provide: LLM_PROVIDER,
      useFactory: () => new OpenAILLMProvider(process.env.OPENAI_API_KEY ?? ''),
    },
  ],
  exports: [
    AgentContextBuilder,
    AgentRunTelemetry,
    DatabaseAgentToolAuditSink,
    ReceptionistTools,
    ReceptionistRuntime,
  ],
})
export class AgentsModule {}
