import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

export function defaultConfigDir(): string {
  return join(process.env.XDG_CONFIG_HOME ?? join(homedir(), ".config"), "oura-cli");
}

/**
 * Read-write a JSON file with 0600 perms. Used for the --use-config
 * credential fallback (keyring is the default).
 */
export class JsonFileStore<T> {
  constructor(
    readonly filePath: string,
    readonly mode: number = 0o600,
  ) {}

  load(): T | null {
    if (!existsSync(this.filePath)) return null;
    try {
      const raw = readFileSync(this.filePath, "utf-8");
      return JSON.parse(raw) as T;
    } catch (err) {
      throw new Error(
        `Could not parse ${this.filePath}: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  save(data: T): void {
    mkdirSync(this.dir(), { recursive: true, mode: 0o700 });
    writeFileSync(this.filePath, `${JSON.stringify(data, null, 2)}\n`, { mode: this.mode });
  }

  clear(): void {
    if (existsSync(this.filePath)) rmSync(this.filePath);
  }

  private dir(): string {
    const parts = this.filePath.split(/[\\/]/);
    parts.pop();
    return parts.join("/") || ".";
  }
}
