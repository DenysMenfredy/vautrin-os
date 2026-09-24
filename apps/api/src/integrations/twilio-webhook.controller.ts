import {
  BadRequestException,
  Controller,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Post,
  Req,
  UnsupportedMediaTypeException,
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Request } from 'express';

import { Public } from '../auth/decorators/public.decorator.js';
import { TwilioWebhookService } from './twilio-webhook.service.js';

@ApiTags('webhooks')
@Controller('webhooks/twilio')
export class TwilioWebhookController {
  constructor(private readonly webhooks: TwilioWebhookService) {}

  @Public()
  @Post('inbound/:integrationId')
  @HttpCode(204)
  @ApiOperation({ summary: 'Authenticated Twilio inbound SMS callback' })
  async inbound(
    @Param('integrationId', new ParseUUIDPipe()) integrationId: string,
    @Req() request: Request,
  ): Promise<void> {
    if (!request.is('application/x-www-form-urlencoded')) {
      throw new UnsupportedMediaTypeException('Expected form-encoded webhook.');
    }
    const fields = formFields(request.body);
    await this.webhooks.receive(
      integrationId,
      request.originalUrl,
      fields,
      request.header('x-twilio-signature') ?? '',
    );
  }
}

function formFields(value: unknown): Record<string, string> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new BadRequestException('Invalid webhook form.');
  }
  const fields: Record<string, string> = {};
  for (const [key, field] of Object.entries(value)) {
    if (typeof field !== 'string') throw new BadRequestException('Invalid webhook form.');
    fields[key] = field;
  }
  return fields;
}
