import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  Req,
  Res,
} from '@nestjs/common';
import { ApiOperation, ApiProperty, ApiTags } from '@nestjs/swagger';
import { IsString, MaxLength, MinLength } from 'class-validator';
import type { Request, Response } from 'express';
import {
  ActiveTenant,
  type AuthenticatedRequestContext,
  CurrentAuth,
} from '../auth/decorators/current-auth.decorator.js';
import { Public } from '../auth/decorators/public.decorator.js';
import { RequireCapability } from '../authz/capability.decorator.js';
import { OperationsListDto } from '../operations/operations.dto.js';
import { IntegrationManagementService } from './integration-management.service.js';

class ConnectCalendarDto {
  @ApiProperty({ example: 'primary' })
  @IsString()
  @MinLength(1)
  @MaxLength(1024)
  calendarId!: string;
}
@ApiTags('integrations')
@Controller('integrations')
export class IntegrationManagementController {
  constructor(private readonly integrations: IntegrationManagementService) {}
  @Get()
  @RequireCapability('integration.manage')
  @ApiOperation({
    summary: 'List active-tenant integrations without secret references or credentials',
  })
  list(@ActiveTenant() tenantId: string, @Query() query: OperationsListDto) {
    return this.integrations.list(tenantId, query.limit, query.cursor);
  }
  @Delete(':id')
  @HttpCode(204)
  @RequireCapability('integration.manage')
  @ApiOperation({ summary: 'Disconnect an integration and prevent use of its credentials' })
  disconnect(
    @ActiveTenant() tenantId: string,
    @CurrentAuth() auth: AuthenticatedRequestContext,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.integrations.disconnect(tenantId, auth.userId, id);
  }
  @Post('google-calendar/connect')
  @RequireCapability('integration.manage')
  @ApiOperation({
    summary: 'Start Google Calendar consent with one-time state, browser binding and PKCE',
  })
  async connect(
    @ActiveTenant() tenantId: string,
    @CurrentAuth() auth: AuthenticatedRequestContext,
    @Body() input: ConnectCalendarDto,
    @Res({ passthrough: true }) response: Response,
  ) {
    const result = await this.integrations.begin(tenantId, auth.userId, input.calendarId.trim());
    response.cookie('vautrin_calendar_nonce', result.nonce, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      maxAge: 600000,
      path: `/${process.env.API_GLOBAL_PREFIX ?? 'api'}/integrations/google-calendar/callback`,
    });
    return { authorizationUrl: result.authorizationUrl };
  }
  @Get('google-calendar/callback')
  @Public()
  @ApiOperation({
    summary:
      'Validate browser-bound OAuth state and store refresh credentials in the configured secret store',
  })
  async callback(
    @Query('state') state: string,
    @Query('code') code: string,
    @Req() request: Request,
    @Res() response: Response,
  ) {
    const nonce =
      (request.headers.cookie ?? '')
        .split(';')
        .map((item) => item.trim())
        .find((item) => item.startsWith('vautrin_calendar_nonce='))
        ?.slice('vautrin_calendar_nonce='.length) ?? '';
    await this.integrations.callback(
      typeof state === 'string' ? state : '',
      typeof code === 'string' ? code : '',
      nonce,
    );
    response.clearCookie('vautrin_calendar_nonce', {
      path: `/${process.env.API_GLOBAL_PREFIX ?? 'api'}/integrations/google-calendar/callback`,
    });
    response.setHeader('Cache-Control', 'no-store');
    response.redirect(303, '/settings?calendar=connected');
  }
}
