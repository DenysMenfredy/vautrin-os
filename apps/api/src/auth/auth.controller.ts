import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpException,
  HttpStatus,
  Inject,
  Post,
  Req,
  Res,
} from '@nestjs/common';
import { ApiNoContentResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Environment } from '@vautrin/config';
import type { AuthTokensResponse, CurrentSessionResponse } from '@vautrin/contracts';
import type { Request, Response } from 'express';
import { ENVIRONMENT } from '../config/environment.module.js';
import { AcceptInvitationDto } from '../tenant/dto/invitation.dto.js';
import { InvitationService } from '../tenant/invitation.service.js';
import { AuthService } from './auth.service.js';
import { type AuthRateLimitDecision, AuthRateLimitService } from './auth-rate-limit.service.js';
import {
  type AuthenticatedRequestContext,
  CurrentAuth,
} from './decorators/current-auth.decorator.js';
import { Public } from './decorators/public.decorator.js';
import { LoginDto, RefreshDto, SwitchTenantDto } from './dto/auth.dto.js';
import { assertTrustedOrigin } from './origin-policy.js';

/** Name of the httpOnly cookie carrying the refresh token. */
const REFRESH_COOKIE = 'vos_refresh';

@ApiTags('auth')
@Controller('auth')
export class AuthController {
  constructor(
    private readonly auth: AuthService,
    private readonly rateLimits: AuthRateLimitService,
    private readonly invitations: InvitationService,
    @Inject(ENVIRONMENT) private readonly environment: Environment,
  ) {}

  @Public()
  @Post('invitations/accept')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({
    summary: 'Accept an operator-issued invitation and activate membership',
    description: 'New users set a password; existing users confirm their current password.',
  })
  @ApiNoContentResponse({ description: 'Invitation accepted. Log in to obtain a session.' })
  async acceptInvitation(
    @Body() dto: AcceptInvitationDto,
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ): Promise<void> {
    assertTrustedOrigin(request, this.environment);
    enforceRateLimit(
      response,
      await this.rateLimits.checkInvitation(request.ip ?? 'unknown', dto.token),
    );
    await this.invitations.accept(dto);
  }

  @Public()
  @Post('login')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Authenticate with email and password' })
  async login(
    @Body() dto: LoginDto,
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ): Promise<AuthTokensResponse> {
    assertTrustedOrigin(request, this.environment);
    enforceRateLimit(
      response,
      await this.rateLimits.checkLogin(request.ip ?? 'unknown', dto.email),
    );
    const tokens = await this.auth.login(dto.email, dto.password, requestContext(request));
    setRefreshCookie(response, tokens.refreshToken);
    return tokens;
  }

  /**
   * Public because the access token is expected to be expired here — that
   * is the entire point of the endpoint. The refresh token is the
   * credential being presented.
   */
  @Public()
  @Post('refresh')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Exchange a refresh token for a new token pair' })
  async refresh(
    @Body() dto: RefreshDto,
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ): Promise<AuthTokensResponse> {
    // Cookie first: a browser always has it, and preferring it means a
    // stale body value cannot override the live session.
    const cookieToken = readRefreshCookie(request);
    if (cookieToken !== undefined) assertTrustedOrigin(request, this.environment);

    const presented = cookieToken ?? dto.refreshToken;
    enforceRateLimit(
      response,
      await this.rateLimits.checkRefresh(request.ip ?? 'unknown', presented ?? ''),
    );
    if (!presented) {
      return this.auth.refresh('', requestContext(request));
    }

    const tokens = await this.auth.refresh(presented, requestContext(request));
    setRefreshCookie(response, tokens.refreshToken);
    return tokens;
  }

  @Public()
  @Post('logout')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Revoke the presented refresh token' })
  async logout(
    @Req() request: Request & { auth?: AuthenticatedRequestContext },
    @Res({ passthrough: true }) response: Response,
  ): Promise<void> {
    // Public so logging out still works with an expired access token —
    // otherwise a user whose session lapsed cannot clear their cookie.
    const refreshToken = readRefreshCookie(request);
    if (refreshToken !== undefined) assertTrustedOrigin(request, this.environment);
    await this.auth.logout(refreshToken, request.auth?.userId);
    clearRefreshCookie(response);
  }

  @Get('me')
  @ApiOperation({ summary: 'The caller, their active tenant and their capabilities' })
  me(@CurrentAuth() auth: AuthenticatedRequestContext): Promise<CurrentSessionResponse> {
    return this.auth.currentSession(auth.userId, auth.tenantId, auth.role);
  }

  @Post('tenant')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Switch the active tenant and reissue the access token' })
  switchTenant(
    @CurrentAuth() auth: AuthenticatedRequestContext,
    @Body() dto: SwitchTenantDto,
    @Req() request: Request,
  ): Promise<{ accessToken: string; expiresIn: number; activeTenantId: string }> {
    const refreshToken = readRefreshCookie(request);
    if (refreshToken !== undefined) assertTrustedOrigin(request, this.environment);
    return this.auth.switchTenant(auth.userId, dto.tenantId, refreshToken);
  }
}

function enforceRateLimit(response: Response, decision: AuthRateLimitDecision): void {
  if (decision.allowed) return;

  response.setHeader('retry-after', String(decision.retryAfterSeconds));
  throw new HttpException(
    'Too many authentication attempts. Try again later.',
    HttpStatus.TOO_MANY_REQUESTS,
  );
}

function requestContext(request: Request): { userAgent?: string; ipAddress?: string } {
  const userAgent = request.header('user-agent');
  return {
    ...(userAgent ? { userAgent: userAgent.slice(0, 500) } : {}),
    ...(request.ip ? { ipAddress: request.ip } : {}),
  };
}

function readRefreshCookie(request: Request): string | undefined {
  // Parsed by hand to avoid a cookie-parser dependency for one cookie.
  const header = request.header('cookie');
  if (!header) return undefined;

  for (const part of header.split(';')) {
    const [name, ...rest] = part.trim().split('=');
    if (name === REFRESH_COOKIE) return decodeURIComponent(rest.join('='));
  }
  return undefined;
}

function setRefreshCookie(response: Response, token: string): void {
  response.cookie(REFRESH_COOKIE, token, {
    // Unreadable to JavaScript, so an XSS bug cannot exfiltrate the
    // long-lived credential.
    httpOnly: true,
    // Lax, not Strict: the dashboard is same-origin behind the Nuxt proxy,
    // and Strict would drop the cookie on a normal top-level navigation
    // back into the app.
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    // Scoped to the refresh endpoints, so it is not attached to every API
    // call and cannot leak through an unrelated handler's logging.
    path: '/api/auth',
    maxAge: 30 * 24 * 60 * 60 * 1000,
  });
}

function clearRefreshCookie(response: Response): void {
  response.clearCookie(REFRESH_COOKIE, { path: '/api/auth' });
}
