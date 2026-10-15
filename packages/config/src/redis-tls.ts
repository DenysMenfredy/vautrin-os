/** A public provider CA, base64 encoded for single-line secret-manager environments. */
export function redisTlsOptions(
  redisUrl: string,
  encodedCa: string | undefined = process.env.REDIS_TLS_CA_BASE64,
): { tls?: { ca: string; rejectUnauthorized: true } } {
  if (!redisUrl.startsWith('rediss:') || !encodedCa) return {};
  const ca = Buffer.from(encodedCa, 'base64').toString('utf8');
  if (!ca.includes('-----BEGIN CERTIFICATE-----') || !ca.includes('-----END CERTIFICATE-----'))
    throw new Error('Invalid Redis TLS CA configuration.');
  return { tls: { ca, rejectUnauthorized: true } };
}
