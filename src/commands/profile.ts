import type { Command } from "commander";
import type { OuraClient } from "../api/client.js";
import type { CliContext } from "../cli/context.js";
import { output } from "../output/index.js";
import type { PersonalInfo } from "../types.js";

/** `oura profile` — personal info (age, sex, weight, height, email). */
export function registerProfile(program: Command, ctx: CliContext, client: OuraClient): void {
  program
    .command("profile")
    .description("Personal information (age, biological sex, weight, height, email)")
    .action(async () => {
      const info = await client.personalInfo();
      output(ctx, info, {
        formatter: (data: unknown) => {
          const p = data as PersonalInfo | null;
          if (!p) return "(no profile data)";
          const rows = [
            ["age", p.age],
            ["biological_sex", p.biological_sex],
            ["weight", p.weight],
            ["height", p.height],
            ["email", p.email],
          ] as const;
          return rows.map(([k, v]) => `${k}: ${v ?? "—"}`).join("\n");
        },
      });
    });
}
