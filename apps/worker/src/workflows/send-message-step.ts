export interface WorkflowSendMessageStepConfig {
  readonly body: string;
}

/** Parses the deliberately literal, SMS-only v0.3 workflow message action. */
export function parseWorkflowSendMessageStepConfig(value: unknown): WorkflowSendMessageStepConfig {
  if (
    typeof value !== 'object' ||
    value === null ||
    Array.isArray(value) ||
    Object.keys(value).some((key) => key !== 'body') ||
    !('body' in value) ||
    typeof value.body !== 'string'
  ) {
    throw new Error('send_message config must contain only a body string.');
  }

  const body = value.body.trim();
  if (!body || body.length > 1600) {
    throw new Error('send_message body must contain 1-1600 characters.');
  }
  return { body };
}

export function normalizedSmsAddress(value: string): string | undefined {
  const normalized = value.trim();
  return /^\+[1-9]\d{1,14}$/.test(normalized) ? normalized : undefined;
}

export function jsonRecord(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

export function stringValue(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined;
}
