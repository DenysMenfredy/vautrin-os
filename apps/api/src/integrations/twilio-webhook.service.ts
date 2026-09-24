import { BadRequestException, ForbiddenException, Inject, Injectable } from '@nestjs/common';
import type { Environment } from '@vautrin/config';
import { Prisma } from '@vautrin/database';
import {
  MessagingProviderError,
  type NormalizedInboundMessage,
  TwilioMessagingProvider,
  twilioStatusCallbackUrl,
} from '@vautrin/integrations';

import { ENVIRONMENT } from '../config/environment.module.js';
import { ConversationsService } from '../conversations/conversations.service.js';
import { DatabaseService } from '../database/database.service.js';
import { TwilioIntegrationService } from './twilio-integration.service.js';

interface WebhookTarget {
  tenant_id: string;
  integration_id: string;
  credentials_ref: string | null;
  account_sid: string | null;
  phone_number: string | null;
  webhook_url: string | null;
}

@Injectable()
export class TwilioWebhookService {
  constructor(
    private readonly database: DatabaseService,
    private readonly integrations: TwilioIntegrationService,
    private readonly provider: TwilioMessagingProvider,
    private readonly conversations: ConversationsService,
    @Inject(ENVIRONMENT) private readonly environment: Environment,
  ) {}

  async receive(
    integrationId: string,
    originalUrl: string,
    fields: Readonly<Record<string, string>>,
    signature: string,
  ): Promise<void> {
    // Before signature validation there is no trusted tenant context. This
    // SECURITY DEFINER lookup returns only the addressed integration's routing
    // metadata; the inbound message is persisted later under withTenant().
    // nosemgrep: semgrep.vautrin-unscoped-database-access
    const [target] = await this.database.unscoped.$queryRaw<WebhookTarget[]>(
      Prisma.sql`SELECT * FROM app.twilio_webhook_target(${integrationId}::uuid)`,
    );
    if (
      !target?.account_sid ||
      !target.phone_number ||
      !target.webhook_url ||
      !target.credentials_ref
    ) {
      throw new ForbiddenException('Webhook rejected.');
    }
    const prefix = this.environment.API_GLOBAL_PREFIX.replace(/^\/+|\/+$/g, '');
    const expectedPath = `${prefix ? `/${prefix}` : ''}/webhooks/twilio/inbound/${integrationId}`;
    let configuredUrl: URL;
    try {
      configuredUrl = new URL(target.webhook_url);
    } catch {
      throw new ForbiddenException('Webhook rejected.');
    }
    if (
      configuredUrl.protocol !== 'https:' ||
      configuredUrl.pathname !== expectedPath ||
      `${configuredUrl.pathname}${configuredUrl.search}` !== originalUrl
    ) {
      throw new ForbiddenException('Webhook rejected.');
    }
    const credentials = await this.integrations.resolve(target.tenant_id, target.integration_id);
    if (
      !this.provider.validateInboundWebhook(
        { url: target.webhook_url, signature, fields },
        credentials.webhookAuthToken,
      )
    ) {
      throw new ForbiddenException('Webhook rejected.');
    }
    let message: NormalizedInboundMessage;
    try {
      message = this.provider.normalizeInboundWebhook(fields);
    } catch (error) {
      if (error instanceof MessagingProviderError) {
        throw new BadRequestException('Invalid inbound message.');
      }
      throw error;
    }
    if (
      message.providerAccountId !== target.account_sid ||
      message.toAddress !== target.phone_number
    ) {
      throw new ForbiddenException('Webhook rejected.');
    }
    await this.conversations.recordInboundFromWebhook(target.tenant_id, {
      provider: message.provider,
      providerEventId: message.providerEventId,
      providerMessageId: message.providerMessageId,
      fromAddress: message.fromAddress,
      toAddress: message.toAddress,
      body: message.body,
    });
  }

  async receiveStatus(
    integrationId: string,
    messageId: string,
    originalUrl: string,
    fields: Readonly<Record<string, string>>,
    signature: string,
  ): Promise<void> {
    // As with inbound callbacks, this narrowly scoped function discovers the
    // tenant only for the addressed, provisioned integration.
    // nosemgrep: semgrep.vautrin-unscoped-database-access
    const [target] = await this.database.unscoped.$queryRaw<WebhookTarget[]>(
      Prisma.sql`SELECT * FROM app.twilio_webhook_target(${integrationId}::uuid)`,
    );
    if (!target?.account_sid || !target.webhook_url || !target.credentials_ref) {
      throw new ForbiddenException('Webhook rejected.');
    }

    let expectedUrl: URL;
    try {
      expectedUrl = new URL(twilioStatusCallbackUrl(target.webhook_url, messageId));
    } catch {
      throw new ForbiddenException('Webhook rejected.');
    }
    const prefix = this.environment.API_GLOBAL_PREFIX.replace(/^\/+|\/+$/g, '');
    const expectedPath = `${prefix ? `/${prefix}` : ''}/webhooks/twilio/status/${integrationId}`;
    if (
      expectedUrl.pathname !== expectedPath ||
      `${expectedUrl.pathname}${expectedUrl.search}` !== originalUrl
    ) {
      throw new ForbiddenException('Webhook rejected.');
    }

    const credentials = await this.integrations.resolve(target.tenant_id, target.integration_id);
    if (
      !this.provider.validateInboundWebhook(
        { url: expectedUrl.toString(), signature, fields },
        credentials.webhookAuthToken,
      )
    ) {
      throw new ForbiddenException('Webhook rejected.');
    }

    let status: ReturnType<TwilioMessagingProvider['normalizeStatusWebhook']>;
    try {
      status = this.provider.normalizeStatusWebhook(fields);
    } catch (error) {
      if (error instanceof MessagingProviderError) {
        throw new BadRequestException('Invalid delivery status callback.');
      }
      throw error;
    }
    if (status.providerAccountId !== target.account_sid) {
      throw new ForbiddenException('Webhook rejected.');
    }
    await this.conversations.recordDeliveryStatusFromWebhook(
      target.tenant_id,
      messageId,
      target.integration_id,
      status,
    );
  }
}
