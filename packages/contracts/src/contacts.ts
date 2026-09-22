import type { PageRequest, PageResponse } from './business.js';

/** JSON stored in the Contact.address field; the SDD leaves its structure flexible. */
export type ContactJsonValue =
  | string
  | number
  | boolean
  | null
  | readonly ContactJsonValue[]
  | { readonly [key: string]: ContactJsonValue };

export interface ContactResponse {
  readonly id: string;
  readonly firstName: string | null;
  readonly lastName: string | null;
  readonly email: string | null;
  readonly phone: string | null;
  readonly company: string | null;
  readonly address: ContactJsonValue | null;
  readonly tags: readonly string[];
  readonly notes: string | null;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface CreateContactRequest {
  readonly firstName?: string | null;
  readonly lastName?: string | null;
  readonly email?: string | null;
  readonly phone?: string | null;
  readonly company?: string | null;
  readonly address?: ContactJsonValue | null;
  readonly tags?: readonly string[];
  readonly notes?: string | null;
}

export type UpdateContactRequest = Partial<CreateContactRequest>;

export interface ListContactsRequest extends PageRequest {
  readonly search?: string;
}

export type ContactPageResponse = PageResponse<ContactResponse>;
