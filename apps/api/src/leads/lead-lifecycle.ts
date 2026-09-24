import { BadRequestException } from '@nestjs/common';
import { LEAD_STATUSES, type LeadStatus } from '@vautrin/contracts';

/** VOS-053: forward progression; WON and LOST close the opportunity. */
export function assertLeadTransition(from: LeadStatus, to: LeadStatus): void {
  if (from === 'WON' || from === 'LOST') {
    throw new BadRequestException(`A ${from} lead is closed and cannot transition.`);
  }
  if (LEAD_STATUSES.indexOf(to) <= LEAD_STATUSES.indexOf(from)) {
    throw new BadRequestException(`Cannot transition a lead from ${from} to ${to}.`);
  }
}
