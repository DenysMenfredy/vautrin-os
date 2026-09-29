import { BadRequestException } from '@nestjs/common';

const KEY = /^[a-z0-9][a-z0-9_-]{0,79}$/;
const TOOL_NAME = /^[a-z][a-z0-9_.-]{0,79}$/;
const PROMPT_VERSION = /^[a-zA-Z0-9][a-zA-Z0-9._-]{0,79}$/;
const SENSITIVE_KEY = /(?:api[_-]?key|token|password|secret|credential)/i;
const SECRET_REFERENCE_KEY = /^(?:secret|credential)[_-]?ref$/i;

export function validateAgentKey(value: string): void {
  if (!KEY.test(value)) throw new BadRequestException('key has an invalid format.');
}

export function validateAgentName(value: string): void {
  if (!value.trim() || value.trim().length > 200) {
    throw new BadRequestException('name must contain 1–200 characters.');
  }
}

export function validateAgentInstructions(value: string): string {
  const normalized = value.trim();
  if (!normalized || normalized.length > 20_000) {
    throw new BadRequestException('instructions must contain 1–20000 characters.');
  }
  return normalized;
}

export function validatePromptVersion(value: string): void {
  if (!PROMPT_VERSION.test(value))
    throw new BadRequestException('promptVersion has an invalid format.');
}

export function validateAllowedTools(value: readonly string[]): readonly string[] {
  if (
    value.length > 50 ||
    value.some((tool) => !TOOL_NAME.test(tool)) ||
    new Set(value).size !== value.length
  ) {
    throw new BadRequestException('allowedTools must contain up to 50 unique tool names.');
  }
  return value;
}

export function validateAgentConfiguration(value: unknown, field: string): Record<string, unknown> {
  if (!isRecord(value)) throw new BadRequestException(`${field} must be an object.`);
  if (Object.keys(value).length > 1_000) {
    throw new BadRequestException(`${field} contains too many properties.`);
  }
  assertSafeJson(value, field, 0);
  return value;
}

function assertSafeJson(value: unknown, field: string, depth: number): void {
  if (depth > 16) throw new BadRequestException(`${field} exceeds the allowed nesting depth.`);
  if (Array.isArray(value)) {
    if (value.length > 1_000) throw new BadRequestException(`${field} contains too many values.`);
    for (const item of value) assertSafeJson(item, field, depth + 1);
    return;
  }
  if (!isRecord(value)) {
    if (typeof value === 'string' && value.length <= 20_000) return;
    if (typeof value === 'number' && Number.isFinite(value)) return;
    if (value === null || typeof value === 'boolean') return;
    throw new BadRequestException(`${field} must contain JSON values only.`);
  }
  for (const [key, item] of Object.entries(value)) {
    if (SENSITIVE_KEY.test(key) && !SECRET_REFERENCE_KEY.test(key)) {
      throw new BadRequestException(
        `${field} must not contain secret material; store a secret reference.`,
      );
    }
    assertSafeJson(item, field, depth + 1);
  }
}

export function redactAgentModelConfiguration(value: unknown): Record<string, unknown> {
  if (!isRecord(value)) return {};
  return Object.fromEntries(
    Object.entries(value)
      .filter(([key]) => !SENSITIVE_KEY.test(key) || SECRET_REFERENCE_KEY.test(key))
      .map(([key, item]) => [key, redactNested(item)]),
  );
}

function redactNested(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(redactNested);
  if (!isRecord(value)) return value;
  return redactAgentModelConfiguration(value);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
