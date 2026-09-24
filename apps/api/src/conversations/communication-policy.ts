import type { ConversationChannel } from '@vautrin/contracts';

/** Only the deterministic STOP command is handled before AI interpretation. */
export function isStopCommand(channel: ConversationChannel, body: string): boolean {
  return (channel === 'SMS' || channel === 'WHATSAPP') && body.trim().toUpperCase() === 'STOP';
}
