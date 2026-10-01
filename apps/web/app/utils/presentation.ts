import type { ContactResponse } from '@vautrin/contracts';

export function humanize(value: string): string {
  if (value === 'SMS' || value === 'AI') return value;
  if (value === 'WHATSAPP') return 'WhatsApp';
  const words = value.toLowerCase().replaceAll('_', ' ');
  return words.charAt(0).toUpperCase() + words.slice(1);
}

export function contactName(contact?: ContactResponse | null): string {
  if (!contact) return 'Contact unavailable';
  const name = [contact.firstName, contact.lastName].filter(Boolean).join(' ').trim();
  return name || contact.company || contact.email || contact.phone || 'Unnamed contact';
}

export function shortDate(value: string | null | undefined, timezone?: string): string {
  if (!value) return '—';
  return new Intl.DateTimeFormat('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    ...(timezone ? { timeZone: timezone } : {}),
  }).format(new Date(value));
}

export function dateTime(value: string | null | undefined, timezone?: string): string {
  if (!value) return '—';
  return new Intl.DateTimeFormat('en-US', {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    ...(timezone ? { timeZone: timezone } : {}),
  }).format(new Date(value));
}

export function statusTone(value: string): 'success' | 'warning' | 'danger' | 'info' | 'neutral' {
  if (['WON', 'ACTIVE', 'DELIVERED', 'READ', 'COMPLETED', 'CONFIRMED'].includes(value))
    return 'success';
  if (['FAILED', 'LOST', 'CANCELLED', 'NO_SHOW'].includes(value)) return 'danger';
  if (['NEW', 'PENDING', 'FOLLOW_UP', 'SENDING', 'PAUSED', 'SNOOZED'].includes(value))
    return 'warning';
  if (['QUEUED', 'SCHEDULED', 'QUALIFIED', 'OPEN', 'CONTACTED'].includes(value)) return 'info';
  return 'neutral';
}
