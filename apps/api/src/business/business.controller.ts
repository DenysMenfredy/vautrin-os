import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import type {
  BusinessProfileResponse,
  BusinessSettingsResponse,
  LocationResponse,
  PageResponse,
  ServiceAreaResponse,
  ServiceResponse,
} from '@vautrin/contracts';
import type { AuthenticatedRequestContext } from '../auth/decorators/current-auth.decorator.js';
import { ActiveTenant, CurrentAuth } from '../auth/decorators/current-auth.decorator.js';
import { RequireCapability } from '../authz/capability.decorator.js';
import { BusinessService } from './business.service.js';
import {
  CreateLocationDto,
  CreateServiceAreaDto,
  CreateServiceDto,
  ListBusinessItemsDto,
  ListLocationsDto,
  UpdateBusinessProfileDto,
  UpdateBusinessSettingsDto,
  UpdateLocationDto,
  UpdateServiceAreaDto,
  UpdateServiceDto,
} from './dto/business.dto.js';

@ApiTags('business')
@Controller('business')
export class BusinessController {
  constructor(private readonly business: BusinessService) {}

  @Get('profile')
  @RequireCapability('business.read')
  @ApiOperation({ summary: 'Read the active tenant business profile' })
  getProfile(@ActiveTenant() tenantId: string): Promise<BusinessProfileResponse> {
    return this.business.getProfile(tenantId);
  }

  @Patch('profile')
  @RequireCapability('business.manage')
  @ApiOperation({ summary: 'Create or update the active tenant business profile' })
  updateProfile(
    @ActiveTenant() tenantId: string,
    @CurrentAuth() auth: AuthenticatedRequestContext,
    @Body() input: UpdateBusinessProfileDto,
  ): Promise<BusinessProfileResponse> {
    return this.business.updateProfile(tenantId, auth.userId, input);
  }

  @Get('settings')
  @RequireCapability('business.manage')
  @ApiOperation({ summary: 'Read the active tenant operational settings' })
  getSettings(@ActiveTenant() tenantId: string): Promise<BusinessSettingsResponse> {
    return this.business.getSettings(tenantId);
  }

  @Patch('settings')
  @RequireCapability('business.manage')
  @ApiOperation({ summary: 'Update the active tenant operational settings' })
  updateSettings(
    @ActiveTenant() tenantId: string,
    @CurrentAuth() auth: AuthenticatedRequestContext,
    @Body() input: UpdateBusinessSettingsDto,
  ): Promise<BusinessSettingsResponse> {
    return this.business.updateSettings(tenantId, auth.userId, input);
  }

  @Get('locations')
  @RequireCapability('business.read')
  @ApiOperation({ summary: 'List active tenant locations' })
  listLocations(
    @ActiveTenant() tenantId: string,
    @Query() query: ListLocationsDto,
  ): Promise<PageResponse<LocationResponse>> {
    return this.business.listLocations(tenantId, query);
  }

  @Post('locations')
  @RequireCapability('business.manage')
  @ApiOperation({ summary: 'Create a tenant location' })
  createLocation(
    @ActiveTenant() tenantId: string,
    @CurrentAuth() auth: AuthenticatedRequestContext,
    @Body() input: CreateLocationDto,
  ): Promise<LocationResponse> {
    return this.business.createLocation(tenantId, auth.userId, input);
  }

  @Get('locations/:locationId')
  @RequireCapability('business.read')
  @ApiOperation({ summary: 'Read a tenant location' })
  getLocation(
    @ActiveTenant() tenantId: string,
    @Param('locationId', new ParseUUIDPipe()) locationId: string,
  ): Promise<LocationResponse> {
    return this.business.getLocation(tenantId, locationId);
  }

  @Patch('locations/:locationId')
  @RequireCapability('business.manage')
  @ApiOperation({ summary: 'Update a tenant location' })
  updateLocation(
    @ActiveTenant() tenantId: string,
    @CurrentAuth() auth: AuthenticatedRequestContext,
    @Param('locationId', new ParseUUIDPipe()) locationId: string,
    @Body() input: UpdateLocationDto,
  ): Promise<LocationResponse> {
    return this.business.updateLocation(tenantId, auth.userId, locationId, input);
  }

  @Delete('locations/:locationId')
  @RequireCapability('business.manage')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Archive a tenant location' })
  async deleteLocation(
    @ActiveTenant() tenantId: string,
    @CurrentAuth() auth: AuthenticatedRequestContext,
    @Param('locationId', new ParseUUIDPipe()) locationId: string,
  ): Promise<void> {
    await this.business.deleteLocation(tenantId, auth.userId, locationId);
  }

  @Get('services')
  @RequireCapability('business.read')
  @ApiOperation({ summary: 'List tenant services' })
  listServices(
    @ActiveTenant() tenantId: string,
    @Query() query: ListBusinessItemsDto,
  ): Promise<PageResponse<ServiceResponse>> {
    return this.business.listServices(tenantId, query);
  }

  @Post('services')
  @RequireCapability('business.manage')
  @ApiOperation({ summary: 'Create a tenant service' })
  createService(
    @ActiveTenant() tenantId: string,
    @CurrentAuth() auth: AuthenticatedRequestContext,
    @Body() input: CreateServiceDto,
  ): Promise<ServiceResponse> {
    return this.business.createService(tenantId, auth.userId, input);
  }

  @Get('services/:serviceId')
  @RequireCapability('business.read')
  @ApiOperation({ summary: 'Read a tenant service' })
  getService(
    @ActiveTenant() tenantId: string,
    @Param('serviceId', new ParseUUIDPipe()) serviceId: string,
  ): Promise<ServiceResponse> {
    return this.business.getService(tenantId, serviceId);
  }

  @Patch('services/:serviceId')
  @RequireCapability('business.manage')
  @ApiOperation({ summary: 'Update a tenant service' })
  updateService(
    @ActiveTenant() tenantId: string,
    @CurrentAuth() auth: AuthenticatedRequestContext,
    @Param('serviceId', new ParseUUIDPipe()) serviceId: string,
    @Body() input: UpdateServiceDto,
  ): Promise<ServiceResponse> {
    return this.business.updateService(tenantId, auth.userId, serviceId, input);
  }

  @Delete('services/:serviceId')
  @RequireCapability('business.manage')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Deactivate a tenant service' })
  async deleteService(
    @ActiveTenant() tenantId: string,
    @CurrentAuth() auth: AuthenticatedRequestContext,
    @Param('serviceId', new ParseUUIDPipe()) serviceId: string,
  ): Promise<void> {
    await this.business.deleteService(tenantId, auth.userId, serviceId);
  }

  @Get('service-areas')
  @RequireCapability('business.read')
  @ApiOperation({ summary: 'List tenant service areas' })
  listServiceAreas(
    @ActiveTenant() tenantId: string,
    @Query() query: ListBusinessItemsDto,
  ): Promise<PageResponse<ServiceAreaResponse>> {
    return this.business.listServiceAreas(tenantId, query);
  }

  @Post('service-areas')
  @RequireCapability('business.manage')
  @ApiOperation({ summary: 'Create a tenant service area' })
  createServiceArea(
    @ActiveTenant() tenantId: string,
    @CurrentAuth() auth: AuthenticatedRequestContext,
    @Body() input: CreateServiceAreaDto,
  ): Promise<ServiceAreaResponse> {
    return this.business.createServiceArea(tenantId, auth.userId, input);
  }

  @Get('service-areas/:serviceAreaId')
  @RequireCapability('business.read')
  @ApiOperation({ summary: 'Read a tenant service area' })
  getServiceArea(
    @ActiveTenant() tenantId: string,
    @Param('serviceAreaId', new ParseUUIDPipe()) serviceAreaId: string,
  ): Promise<ServiceAreaResponse> {
    return this.business.getServiceArea(tenantId, serviceAreaId);
  }

  @Patch('service-areas/:serviceAreaId')
  @RequireCapability('business.manage')
  @ApiOperation({ summary: 'Update a tenant service area' })
  updateServiceArea(
    @ActiveTenant() tenantId: string,
    @CurrentAuth() auth: AuthenticatedRequestContext,
    @Param('serviceAreaId', new ParseUUIDPipe()) serviceAreaId: string,
    @Body() input: UpdateServiceAreaDto,
  ): Promise<ServiceAreaResponse> {
    return this.business.updateServiceArea(tenantId, auth.userId, serviceAreaId, input);
  }

  @Delete('service-areas/:serviceAreaId')
  @RequireCapability('business.manage')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Deactivate a tenant service area' })
  async deleteServiceArea(
    @ActiveTenant() tenantId: string,
    @CurrentAuth() auth: AuthenticatedRequestContext,
    @Param('serviceAreaId', new ParseUUIDPipe()) serviceAreaId: string,
  ): Promise<void> {
    await this.business.deleteServiceArea(tenantId, auth.userId, serviceAreaId);
  }
}
