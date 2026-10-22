import { healthResponseSchema, type HealthResponse } from '@aura/shared';

const API_URL = process.env.EXPO_PUBLIC_API_URL ?? 'http://localhost:3000';

export async function fetchHealth(): Promise<HealthResponse> {
  const res = await fetch(`${API_URL}/health`);
  if (!res.ok) throw new Error(`Health check failed with ${res.status}`);
  return healthResponseSchema.parse(await res.json());
}
