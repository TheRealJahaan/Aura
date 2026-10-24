import { isAbsolute, normalize, relative, resolve, sep } from 'node:path';

export const APP_ORIGIN = 'aura://app';

/**
 * Maps an aura://app/... path to a file inside `root`, or null if the path
 * tries to leave it (like aura://app/../../etc/passwd).
 */
export function resolveInside(root: string, pathname: string): string | null {
  let decoded: string;
  try {
    decoded = decodeURIComponent(pathname);
  } catch {
    return null;
  }
  if (decoded.includes('\0')) return null;
  const base = resolve(root);
  const target = resolve(base, normalize(`.${sep}${decoded}`));
  const rel = relative(base, target);
  if (!rel || rel.startsWith('..') || isAbsolute(rel)) return null;
  return target;
}

export function isAppUrl(url: string | undefined): boolean {
  if (!url) return false;
  try {
    const parsed = new URL(url);
    return parsed.protocol === 'aura:' && parsed.host === 'app';
  } catch {
    return false;
  }
}
