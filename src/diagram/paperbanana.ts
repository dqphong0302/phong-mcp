import type { Raw } from "../academic/types.ts";
import { z } from "zod";
import { ok, err, fmtErr } from "../utils.ts";
import { paperbanana as config } from "../config.ts";
import { proxyAwareFetch } from "../http.ts";

export function registerPaperBananaTool(server: Raw) {
  server.tool(
    "diagram_paperbanana_generate",
    "Generate a publication-ready academic diagram or plot from a methodology section and a figure caption using the PaperBanana multi-agent pipeline.",
    {
      method_text: z.string().describe(
        "The text of the methodology/methods section describing the architecture, model, or steps."
      ),
      caption: z.string().describe(
        "The caption of the figure describing the illustration to generate."
      ),
      aspect_ratio: z
        .enum(["16:9", "21:9", "3:2", "1:1"])
        .optional()
        .default("21:9")
        .describe("Aspect ratio of the generated illustration (default: 21:9)."),
      max_critic_rounds: z
        .number()
        .min(1)
        .max(5)
        .optional()
        .default(3)
        .describe("Number of Critic-Visualizer improvement rounds (default: 3)."),
      exp_mode: z
        .enum(["demo_full", "demo_planner_critic"])
        .optional()
        .default("demo_full")
        .describe("Pipeline mode: 'demo_full' (full agents) or 'demo_planner_critic' (bypasses stylist)."),
      task_name: z
        .enum(["diagram", "plot"])
        .optional()
        .default("diagram")
        .describe("Type of illustration: 'diagram' (default) or 'plot'."),
    },
    async ({ method_text, caption, aspect_ratio, max_critic_rounds, exp_mode, task_name }: Raw) => {
      try {
        const headers: Record<string, string> = {
          "Content-Type": "application/json",
        };
        if (config.apiKey) {
          headers["Authorization"] = `Bearer ${config.apiKey}`;
        }

        const response = await proxyAwareFetch(`${config.url}/v1/paperbanana/generate`, {
          method: "POST",
          headers,
          body: JSON.stringify({
            method_text,
            caption,
            aspect_ratio: aspect_ratio || "21:9",
            max_critic_rounds: max_critic_rounds || 3,
            exp_mode: exp_mode || "demo_full",
            task_name: task_name || "diagram",
          }),
          timeout: 240000, // Large timeout because agent loops take a while (4 minutes max)
        });

        if (!response.ok) {
          const errData = await (response.json() as Promise<Raw>).catch(() => ({}));
          return err(`PaperBanana API error: ${errData.detail || `HTTP ${response.status}`}`);
        }

        const data = (await response.json() as Raw);
        if (!data.success || !data.image) {
          return err("PaperBanana pipeline failed to produce an image.");
        }

        return {
          content: [
            {
              type: "text",
              text: `### PaperBanana Generated Illustration\n\n**Description/Plan:**\n${data.description}\n\nHere is the generated ${task_name}:`,
            },
            {
              type: "image",
              data: data.image,
              mimeType: "image/jpeg",
            },
          ],
        };
      } catch (e) {
        return err(`Failed to generate illustration via PaperBanana: ${fmtErr(e)}`);
      }
    }
  );
}
