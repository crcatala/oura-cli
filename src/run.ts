import { pathToFileURL } from "node:url";
import { main } from "./cli-main.js";

/** CLI entrypoint: run main() and set the process exit code. */
export async function run(): Promise<void> {
  const code = await main(process.argv.slice(2), process.env);
  if (code !== 0) process.exitCode = code;
}

// Self-invoke only when executed directly (node dist/run.js), NOT when
// imported by cli.js — otherwise commands run twice.
const isMain = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMain) {
  run().catch((err) => {
    console.error(err instanceof Error ? err.message : String(err));
    process.exitCode = 1;
  });
}
