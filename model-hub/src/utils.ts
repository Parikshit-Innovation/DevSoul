import * as crypto from 'node:crypto';

export class SystemContext {
  private static mockClock: (() => Date) | null = null;
  private static idCounter: number = 0;

  public static setMockClock(fn: (() => Date) | null): void {
    this.mockClock = fn;
  }

  public static now(): Date {
    return this.mockClock ? this.mockClock() : new Date();
  }

  public static nowMs(): number {
    return this.now().getTime();
  }

  public static nowIso(): string {
    return this.now().toISOString();
  }

  public static generateId(prefix: string = 'task'): string {
    this.idCounter++;
    const random = crypto.randomBytes(4).toString('hex');
    return `${prefix}-${this.nowMs()}-${this.idCounter}-${random}`;
  }

  public static resetCounter(): void {
    this.idCounter = 0;
  }
}

export function sha256Hex(content: string): string {
  return crypto.createHash('sha256').update(content, 'utf8').digest('hex');
}

/**
 * Simple glob matching supporting * and ** without external dependencies
 */
export function matchGlob(filepath: string, pattern: string): boolean {
  const normPath = filepath.replace(/\\/g, '/').toLowerCase();
  const normPattern = pattern.replace(/\\/g, '/').toLowerCase();

  // Escape special regex characters except * and ?
  let regexStr = normPattern
    .replace(/[.+^${}()|[\]\\]/g, '\\$&')
    .replace(/\*\*/g, '.*')
    .replace(/(?<!\.)\*/g, '[^/]*')
    .replace(/\?/g, '.');

  if (!regexStr.startsWith('.*') && !regexStr.startsWith('^')) {
    regexStr = `(^|/)${regexStr}`;
  }
  if (!regexStr.endsWith('.*') && !regexStr.endsWith('$')) {
    regexStr = `${regexStr}($|/)`;
  }

  try {
    const regex = new RegExp(regexStr);
    return regex.test(normPath);
  } catch {
    return normPath.includes(normPattern);
  }
}

export function redactAuthHeader(headers: Record<string, string>): Record<string, string> {
  const clean: Record<string, string> = { ...headers };
  for (const key of Object.keys(clean)) {
    if (key.toLowerCase() === 'authorization') {
      clean[key] = 'Bearer [REDACTED]';
    }
  }
  return clean;
}
