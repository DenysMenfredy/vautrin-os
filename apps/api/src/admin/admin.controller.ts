import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpException,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  Req,
  Res,
  UseGuards,
} from '@nestjs/common';
import { ApiCookieAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { PlatformPrincipal } from '@vautrin/contracts';
import type { Request, Response } from 'express';
import { AuthRateLimitService } from '../auth/auth-rate-limit.service.js';
import { Public } from '../auth/decorators/public.decorator.js';
import {
  AdminAnalyticsQuery,
  AdminAuditQuery,
  AdminCreateTenantDto,
  AdminDeleteUserDto,
  AdminEditTenantDto,
  AdminEditUserDto,
  AdminInvitationDto,
  AdminListQuery,
  AdminLoginDto,
  AdminMembershipDto,
  AdminMembershipRoleDto,
  AdminPlatformAccessDto,
  AdminReasonDto,
} from './admin.dto.js';
import { AdminService, type PlatformMutationContext } from './admin.service.js';
import {
  adminCookie,
  CurrentPlatform,
  PlatformAnonymous,
  PlatformGuard,
  RequiresPlatform,
} from './platform.guard.js';
import {
  ADMIN_COOKIE,
  ADMIN_SESSION_SECONDS,
  PlatformAuthService,
} from './platform-auth.service.js';

/** Public to the tenant JWT guard only; PlatformGuard is mandatory for this entire controller. */
@ApiTags('Platform administration')
@ApiCookieAuth(ADMIN_COOKIE)
@Public()
@UseGuards(PlatformGuard)
@Controller('admin')
export class AdminController {
  constructor(
    private readonly service: AdminService,
    private readonly auth: PlatformAuthService,
    private readonly rateLimits: AuthRateLimitService,
  ) {}
  @Post('session')
  @HttpCode(200)
  @PlatformAnonymous()
  @ApiOperation({ summary: 'Create an independent platform-admin session' })
  async login(
    @Body() input: AdminLoginDto,
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ) {
    const decision = await this.rateLimits.checkLogin(request.ip ?? 'unknown', input.email);
    if (!decision.allowed) {
      response.setHeader('retry-after', String(decision.retryAfterSeconds));
      throw new HttpException('Too many authentication attempts. Try again later.', 429);
    }
    const result = await this.auth.login(
      input.email,
      input.password,
      request.header('x-correlation-id'),
    );
    response.cookie(ADMIN_COOKIE, result.token, {
      httpOnly: true,
      secure: this.auth.environment.NODE_ENV === 'production',
      sameSite: 'strict',
      path: '/',
      maxAge: ADMIN_SESSION_SECONDS * 1000,
    });
    return result.session;
  }
  @Get('session')
  @ApiOperation({ summary: 'Resolve the live platform principal and permissions' })
  session(@CurrentPlatform() principal: PlatformPrincipal) {
    return this.auth.session(principal);
  }
  @Delete('session')
  @HttpCode(204)
  @PlatformAnonymous()
  @ApiOperation({ summary: 'Revoke the presented admin session' })
  async logout(@Req() request: Request, @Res({ passthrough: true }) response: Response) {
    await this.auth.logout(adminCookie(request), request.header('x-correlation-id'));
    response.clearCookie(ADMIN_COOKIE, {
      path: '/',
      sameSite: 'strict',
      secure: this.auth.environment.NODE_ENV === 'production',
      httpOnly: true,
    });
  }
  @Get('dashboard')
  @ApiOperation({ summary: 'Platform totals and current UTC month counts' })
  dashboard() {
    return this.service.dashboard();
  }
  @Get('analytics/users-per-month')
  @ApiOperation({ summary: 'UTC monthly user registration counts, including zero months' })
  usersPerMonth(@Query() query: AdminAnalyticsQuery) {
    return this.service.analytics('users', query.months);
  }
  @Get('analytics/tenants-per-month')
  @ApiOperation({ summary: 'UTC monthly tenant registration counts, including zero months' })
  tenantsPerMonth(@Query() query: AdminAnalyticsQuery) {
    return this.service.analytics('tenants', query.months);
  }
  @Get('users')
  @ApiOperation({ summary: 'Search safe user metadata with cursor pagination' })
  users(@Query() query: AdminListQuery, @CurrentPlatform() principal: PlatformPrincipal) {
    return this.service.users(query, principal);
  }
  @Get('users/:userId')
  @ApiOperation({ summary: 'Inspect safe identity, membership and session counts' })
  user(
    @Param('userId', ParseUUIDPipe) id: string,
    @CurrentPlatform() principal: PlatformPrincipal,
  ) {
    return this.service.user(id, principal);
  }
  @Get('users/:userId/memberships')
  @ApiOperation({ summary: 'Paginated memberships for an inspected user' })
  memberships(@Param('userId', ParseUUIDPipe) id: string, @Query() query: AdminListQuery) {
    return this.service.memberships(id, query);
  }
  @Patch('users/:userId')
  @RequiresPlatform('user.edit')
  @ApiOperation({ summary: 'Edit allowlisted profile metadata' })
  editUser(
    @Param('userId', ParseUUIDPipe) id: string,
    @Body() input: AdminEditUserDto,
    @CurrentPlatform() principal: PlatformPrincipal,
    @Req() request: Request,
  ) {
    return this.service.editUser(mutationContext(principal, request), id, input.name);
  }
  @Post('users/:userId/disable')
  @RequiresPlatform('user.disable')
  @ApiOperation({ summary: 'Disable an identity and revoke all sessions' })
  disableUser(
    @Param('userId', ParseUUIDPipe) id: string,
    @Body() input: AdminReasonDto,
    @CurrentPlatform() principal: PlatformPrincipal,
    @Req() request: Request,
  ) {
    return this.service.userLifecycle(
      mutationContext(principal, request),
      id,
      'disable',
      input.reason,
    );
  }
  @Post('users/:userId/enable')
  @RequiresPlatform('user.disable')
  @ApiOperation({ summary: 'Re-enable an invitation-accepted identity' })
  enableUser(
    @Param('userId', ParseUUIDPipe) id: string,
    @Body() input: AdminReasonDto,
    @CurrentPlatform() principal: PlatformPrincipal,
    @Req() request: Request,
  ) {
    return this.service.userLifecycle(
      mutationContext(principal, request),
      id,
      'enable',
      input.reason,
    );
  }
  @Delete('users/:userId')
  @RequiresPlatform('user.delete')
  @ApiOperation({
    summary: 'Logically delete, preserving historical references; requires DELETE confirmation',
  })
  deleteUser(
    @Param('userId', ParseUUIDPipe) id: string,
    @Body() input: AdminDeleteUserDto,
    @CurrentPlatform() principal: PlatformPrincipal,
    @Req() request: Request,
  ) {
    return this.service.userLifecycle(
      mutationContext(principal, request),
      id,
      'delete',
      input.reason,
    );
  }
  @Post('users/:userId/memberships')
  @RequiresPlatform('membership.manage')
  @ApiOperation({ summary: 'Grant a membership to an existing active identity' })
  addMembership(
    @Param('userId', ParseUUIDPipe) id: string,
    @Body() input: AdminMembershipDto,
    @CurrentPlatform() principal: PlatformPrincipal,
    @Req() request: Request,
  ) {
    return this.service.addMembership(
      mutationContext(principal, request),
      id,
      input.tenantId,
      input.role,
    );
  }
  @Patch('users/:userId/memberships/:membershipId')
  @RequiresPlatform('membership.manage')
  @ApiOperation({ summary: 'Change a tenant role and revoke affected sessions' })
  changeMembership(
    @Param('userId', ParseUUIDPipe) id: string,
    @Param('membershipId', ParseUUIDPipe) membership: string,
    @Body() input: AdminMembershipRoleDto,
    @CurrentPlatform() principal: PlatformPrincipal,
    @Req() request: Request,
  ) {
    return this.service.changeMembership(
      mutationContext(principal, request),
      id,
      membership,
      input.role,
    );
  }
  @Delete('users/:userId/memberships/:membershipId')
  @RequiresPlatform('membership.manage')
  @ApiOperation({ summary: 'Revoke a membership without deleting the global user' })
  removeMembership(
    @Param('userId', ParseUUIDPipe) id: string,
    @Param('membershipId', ParseUUIDPipe) membership: string,
    @CurrentPlatform() principal: PlatformPrincipal,
    @Req() request: Request,
  ) {
    return this.service.changeMembership(mutationContext(principal, request), id, membership);
  }
  @Patch('users/:userId/platform-access')
  @RequiresPlatform('access.manage')
  @ApiOperation({ summary: 'Explicit super-admin grant, change or suspension of platform access' })
  access(
    @Param('userId', ParseUUIDPipe) id: string,
    @Body() input: AdminPlatformAccessDto,
    @CurrentPlatform() principal: PlatformPrincipal,
    @Req() request: Request,
  ) {
    return this.service.platformAccess(mutationContext(principal, request), id, input);
  }
  @Post('invitations')
  @RequiresPlatform('user.invite')
  @ApiOperation({
    summary: 'Issue a seven-day one-time tenant invitation; token is returned only once',
  })
  invite(
    @Body() input: AdminInvitationDto,
    @CurrentPlatform() principal: PlatformPrincipal,
    @Req() request: Request,
  ) {
    return this.service.invite(mutationContext(principal, request), input);
  }
  @Get('tenants')
  @ApiOperation({ summary: 'Search tenant metadata with cursor pagination' })
  tenants(@Query() query: AdminListQuery) {
    return this.service.tenants(query);
  }
  @Get('tenants/:tenantId')
  @ApiOperation({ summary: 'Inspect tenant metadata and business-profile summary' })
  tenant(@Param('tenantId', ParseUUIDPipe) id: string) {
    return this.service.tenant(id);
  }
  @Post('tenants')
  @RequiresPlatform('tenant.manage')
  @ApiOperation({ summary: 'Provision a tenant and optionally issue its first OWNER invitation' })
  createTenant(
    @Body() input: AdminCreateTenantDto,
    @CurrentPlatform() principal: PlatformPrincipal,
    @Req() request: Request,
  ) {
    return this.service.createTenant(mutationContext(principal, request), input);
  }
  @Patch('tenants/:tenantId')
  @RequiresPlatform('tenant.manage')
  @ApiOperation({ summary: 'Edit allowlisted tenant metadata' })
  editTenant(
    @Param('tenantId', ParseUUIDPipe) id: string,
    @Body() input: AdminEditTenantDto,
    @CurrentPlatform() principal: PlatformPrincipal,
    @Req() request: Request,
  ) {
    return this.service.editTenant(mutationContext(principal, request), id, input);
  }
  @Post('tenants/:tenantId/suspend')
  @RequiresPlatform('tenant.manage')
  @ApiOperation({ summary: 'Suspend a tenant and revoke tenant sessions' })
  suspendTenant(
    @Param('tenantId', ParseUUIDPipe) id: string,
    @Body() input: AdminReasonDto,
    @CurrentPlatform() principal: PlatformPrincipal,
    @Req() request: Request,
  ) {
    return this.service.tenantLifecycle(
      mutationContext(principal, request),
      id,
      'suspend',
      input.reason,
    );
  }
  @Post('tenants/:tenantId/reactivate')
  @RequiresPlatform('tenant.manage')
  @ApiOperation({ summary: 'Reactivate a suspended tenant' })
  reactivateTenant(
    @Param('tenantId', ParseUUIDPipe) id: string,
    @Body() input: AdminReasonDto,
    @CurrentPlatform() principal: PlatformPrincipal,
    @Req() request: Request,
  ) {
    return this.service.tenantLifecycle(
      mutationContext(principal, request),
      id,
      'reactivate',
      input.reason,
    );
  }
  @Post('tenants/:tenantId/archive')
  @RequiresPlatform('tenant.manage')
  @ApiOperation({ summary: 'Archive a tenant non-destructively' })
  archiveTenant(
    @Param('tenantId', ParseUUIDPipe) id: string,
    @Body() input: AdminReasonDto,
    @CurrentPlatform() principal: PlatformPrincipal,
    @Req() request: Request,
  ) {
    return this.service.tenantLifecycle(
      mutationContext(principal, request),
      id,
      'archive',
      input.reason,
    );
  }
  @Get('audit')
  @ApiOperation({ summary: 'Read append-only platform audit events with cursor pagination' })
  audit(@Query() query: AdminAuditQuery) {
    return this.service.audit(query);
  }
}
function mutationContext(principal: PlatformPrincipal, request: Request): PlatformMutationContext {
  const key = request.header('idempotency-key');
  if (key && !/^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i.test(key))
    throw new BadRequestException('Idempotency-Key must be a UUID.');
  const correlation = request.header('x-correlation-id');
  const requestId =
    correlation && /^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i.test(correlation)
      ? correlation
      : undefined;
  return { ...principal, requestId, correlationId: requestId, idempotencyKey: key };
}
