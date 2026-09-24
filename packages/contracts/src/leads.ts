import type { PageRequest, PageResponse } from './business.js';

/** Initial statuses from SDD-01 §4; labels may vary by vertical. */
export const LEAD_STATUSES = [
  'NEW',
  'CONTACTED',
  'QUALIFIED',
  'APPOINTMENT_BOOKED',
  'ESTIMATE_PENDING',
  'ESTIMATE_SENT',
  'FOLLOW_UP',
  'WON',
  'LOST',
] as const;
export type LeadStatus = (typeof LEAD_STATUSES)[number];

export interface LeadSourceResponse {
  readonly id: string;
  readonly key: string;
  readonly label: string;
  readonly category: string | null;
  readonly isActive: boolean;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface CreateLeadSourceRequest {
  readonly key: string;
  readonly label: string;
  readonly category?: string | null;
}

export interface UpdateLeadSourceRequest {
  readonly key?: string;
  readonly label?: string;
  readonly category?: string | null;
  readonly isActive?: boolean;
}

export interface ListLeadSourcesRequest extends PageRequest {
  readonly active?: boolean;
  readonly search?: string;
}

export type LeadSourcePageResponse = PageResponse<LeadSourceResponse>;

export interface LeadResponse {
  readonly id: string;
  readonly contactId: string;
  readonly status: LeadStatus;
  readonly sourceId: string | null;
  /** Snapshot of a tenant service key. */
  readonly service: string | null;
  readonly assignedUserId: string | null;
  readonly title: string | null;
  readonly description: string | null;
  /** Decimal string preserves the database's two-cent precision. */
  readonly estimatedValue: string | null;
  readonly lastContactedAt: string | null;
  readonly version: number;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface CreateLeadRequest {
  readonly contactId: string;
  readonly sourceId?: string | null;
  readonly service?: string | null;
  readonly title?: string | null;
  readonly description?: string | null;
  readonly estimatedValue?: string | null;
}

export interface UpdateLeadRequest {
  readonly version: number;
  readonly sourceId?: string | null;
  readonly service?: string | null;
  readonly title?: string | null;
  readonly description?: string | null;
  readonly estimatedValue?: string | null;
}

export interface TransitionLeadRequest {
  readonly version: number;
  readonly status: LeadStatus;
}

export interface AssignLeadRequest {
  readonly version: number;
  readonly assignedUserId: string | null;
}

export interface ListLeadsRequest extends PageRequest {
  readonly status?: LeadStatus;
  readonly sourceId?: string;
  readonly assignedUserId?: string;
  readonly search?: string;
}

export type LeadPageResponse = PageResponse<LeadResponse>;

export interface LeadDashboardResponse {
  readonly total: number;
  readonly byStatus: Readonly<Record<LeadStatus, number>>;
}
