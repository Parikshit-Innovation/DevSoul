import { randomBytes } from "node:crypto";

export type ClockFn = () => Date;
export type IdGenFn = (prefix?: string) => string;

export class SystemContext {
  private static clock: ClockFn = () => new Date();
  private static idCounter: number = 0;
  private static customIdGen?: IdGenFn;

  public static setClock(customClock: ClockFn): void {
    SystemContext.clock = customClock;
  }

  public static resetClock(): void {
    SystemContext.clock = () => new Date();
  }

  public static now(): Date {
    return SystemContext.clock();
  }

  public static nowIso(): string {
    return SystemContext.clock().toISOString();
  }

  public static setIdGenerator(customGen: IdGenFn): void {
    SystemContext.customIdGen = customGen;
  }

  public static resetIdGenerator(): void {
    SystemContext.customIdGen = undefined;
    SystemContext.idCounter = 0;
  }

  public static generateId(prefix: string = "aegis"): string {
    if (SystemContext.customIdGen) {
      return SystemContext.customIdGen(prefix);
    }
    SystemContext.idCounter += 1;
    const rand = randomBytes(4).toString("hex");
    return `${prefix}-${Date.now()}-${SystemContext.idCounter}-${rand}`;
  }
}
