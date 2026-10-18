import type { Raw } from "../academic/types.ts";
import { z } from "zod";
import { ok, err, fmtErr } from "../utils.ts";
import { contentGen as config } from "../config.ts";
import { proxyAwareFetch } from "../http.ts";

// ── Templates ────────────────────────────────────────────────────────────────
const TEMPLATES: Record<string, Raw> = {
  social_post: {
    system: `Bạn là chuyên gia content marketing. Tạo bài đăng mạng xã hội hấp dẫn, viral, phù hợp platform.
Quy tắc:
- Ngắn gọn, hook mạnh ở câu đầu
- Dùng emoji phù hợp (không spam)
- Kết thúc bằng CTA rõ ràng
- Thêm hashtag liên quan (5-10 tags)
- Tone: thân thiện, chuyên nghiệp, gần gũi`,
    format: "Trả về: [Hook] + [Body] + [CTA] + [Hashtags]",
  },
  caption: {
    system: `Bạn là copywriter chuyên viết caption cho ảnh/video trên MXH.
Quy tắc:
- Caption ngắn (1-3 câu), gây tò mò
- Phù hợp với mô tả hình ảnh/video
- Thêm emoji và hashtag`,
    format: "Trả về caption ngắn gọn + hashtags",
  },
  blog_outline: {
    system: `Bạn là content strategist. Tạo outline bài blog SEO-friendly.
Quy tắc:
- H1 title hấp dẫn, chứa keyword chính
- 5-8 H2 sections logic
- Mỗi section có 2-3 bullet points gợi ý nội dung
- Gợi ý meta description (150-160 ký tự)
- Gợi ý internal/external links`,
    format: "Trả về: Title + Meta Description + Outline (H2/H3) + Keywords",
  },
  email: {
    system: `Bạn là email marketing specialist. Viết email marketing chuyển đổi cao.
Quy tắc:
- Subject line gây tò mò (< 50 ký tự)
- Preview text hấp dẫn
- Body ngắn, scan-friendly (bullet points)
- CTA rõ ràng, nổi bật
- P.S. line tạo urgency`,
    format: "Trả về: Subject + Preview + Body + CTA + P.S.",
  },
  ad_copy: {
    system: `Bạn là performance marketer. Viết ad copy cho quảng cáo digital (Facebook/Google/TikTok).
Quy tắc:
- Headline: ngắn, benefit-driven (< 30 ký tự)
- Primary text: pain point → solution → CTA
- Nhiều variations (A/B test)
- Phù hợp character limits của platform`,
    format: "Trả về 3 variations: [Headline] + [Primary Text] + [CTA]",
  },
  product_description: {
    system: `Bạn là copywriter e-commerce. Viết mô tả sản phẩm bán hàng.
Quy tắc:
- Mở đầu bằng benefit chính
- Features → Benefits mapping
- Social proof / urgency elements
- SEO-friendly, chứa keywords tự nhiên
- Bullet points dễ scan`,
    format: "Trả về: Headline + Short desc + Features + Benefits + CTA",
  },
  video_script: {
    system: `Bạn là scriptwriter cho video ngắn (Reels/TikTok/Shorts).
Quy tắc:
- Hook trong 3 giây đầu
- Cấu trúc: Hook → Problem → Solution → CTA
- Thời lượng: 30-60 giây
- Ngôn ngữ nói, tự nhiên
- Gợi ý visual/B-roll cho từng đoạn`,
    format: "Trả về: [Timestamp] + [Script] + [Visual notes]",
  },
  seo_meta: {
    system: `Bạn là SEO specialist. Tạo meta tags tối ưu cho trang web.
Quy tắc:
- Title tag: 50-60 ký tự, keyword đầu
- Meta description: 150-160 ký tự, có CTA
- H1 suggestion
- Schema markup suggestions
- Focus keyword + LSI keywords`,
    format: "Trả về: Title + Description + H1 + Keywords + Schema suggestions",
  },
};

const TEMPLATE_NAMES = Object.keys(TEMPLATES);

// ── API call ─────────────────────────────────────────────────────────────────
async function generateContent({ template, topic, platform, tone, language, extra_instructions, max_tokens }: Raw) {
  if (!config.apiKey) {
    throw new Error("CONTENT_GEN_API_KEY, NINE_ROUTER_API_KEY or 9ROUTER_API_KEY environment variable is required");
  }
  const tmpl = TEMPLATES[template] || TEMPLATES.social_post;
  
  let systemPrompt = tmpl.system;
  if (platform) systemPrompt += `\nPlatform: ${platform}`;
  if (tone) systemPrompt += `\nTone: ${tone}`;
  if (language === "en") systemPrompt = systemPrompt.replace(/Bạn là/g, "You are a").replace(/Quy tắc:/g, "Rules:").replace(/Trả về/g, "Return");
  systemPrompt += `\n\nOutput format: ${tmpl.format}`;

  let userPrompt = `Chủ đề/Yêu cầu: ${topic}`;
  if (extra_instructions) userPrompt += `\n\nYêu cầu thêm: ${extra_instructions}`;

  try {
    const response = await proxyAwareFetch(`${config.baseUrl}/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${config.apiKey}`,
      },
      body: JSON.stringify({
        model: config.model,
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userPrompt },
        ],
        max_tokens: max_tokens || 1500,
        temperature: 0.8,
        stream: false,
      }),
      timeout: config.timeoutMs,
    });

    if (!response.ok) {
      const errText = await response.text().catch(() => "");
      return { error: `API error ${response.status}: ${errText || response.statusText}` };
    }

    const rawText = await response.text();

    // Try plain JSON first (non-streaming response)
    let data;
    try {
      data = JSON.parse(rawText);
    } catch {
      // Fall back to SSE line-by-line parsing (server returned streaming format)
      const contentParts = [];
      let usage = null;
      let model = null;

      for (const line of rawText.split("\n")) {
        const trimmed = line.trim();
        if (!trimmed.startsWith("data:")) continue;
        const payload = trimmed.slice(5).trim();
        if (payload === "[DONE]") continue;
        try {
          const parsed = JSON.parse(payload);
          if (parsed.model) model = parsed.model;
          if (parsed.usage) usage = parsed.usage;
          // Streaming delta
          const delta = parsed.choices?.[0]?.delta?.content;
          if (delta) contentParts.push(delta);
          // Non-streaming message in SSE wrapper
          const msg = parsed.choices?.[0]?.message?.content;
          if (msg) contentParts.push(msg);
        } catch { /* skip malformed lines */ }
      }

      data = {
        choices: [{ message: { content: contentParts.join("") } }],
        usage: usage || {},
        model: model || config.model,
      };
    }

    const content = data.choices?.[0]?.message?.content || "";
    const usage = data.usage || {};

    return { content, usage, model: data.model || config.model };
  } catch (e) {
    return { error: `API request failed: ${fmtErr(e)}` };
  }
}

// ── Tool registration ────────────────────────────────────────────────────────
export function registerContentGenTool(server: Raw) {
  server.tool(
    "content_generator",
    `Generate marketing content: social posts, captions, blog outlines, email campaigns, ad copy, product descriptions, video scripts, seo_meta. Templates: ${TEMPLATE_NAMES.join(", ")}. Powered by ${config.model}.`,
    {
      template: z.enum(TEMPLATE_NAMES as [string, ...string[]]).describe(
        "Content template: social_post, caption, blog_outline, email, ad_copy, product_description, video_script, seo_meta"
      ),
      topic: z.string().describe("Chủ đề/sản phẩm/dịch vụ cần tạo content"),
      platform: z.string().optional().describe("Platform: facebook, instagram, tiktok, linkedin, zalo, youtube, google_ads, email"),
      tone: z.string().optional().describe("Tone of voice: professional, friendly, humorous, urgent, luxury, casual. Default: friendly"),
      language: z.enum(["vi", "en"]).optional().describe("Output language. Default: vi (Vietnamese)"),
      extra_instructions: z.string().optional().describe("Yêu cầu bổ sung: target audience, USP, promo, constraints..."),
      max_tokens: z.number().min(100).max(4000).optional().describe("Max output tokens. Default: 1500"),
      variations: z.number().min(1).max(5).optional().describe("Số variations cần tạo. Default: 1"),
    },
    async ({ template, topic, platform, tone, language, extra_instructions, max_tokens, variations }: Raw) => {
      try {
        const numVariations = Math.min(variations || 1, 5);
        const results = [];

        for (let i = 0; i < numVariations; i++) {
          const varExtra = numVariations > 1
            ? `${extra_instructions || ""}\n\nĐây là variation ${i + 1}/${numVariations}. Hãy tạo nội dung KHÁC BIỆT so với các variation trước.`
            : extra_instructions;

          const result = await generateContent({
            template, topic, platform, tone, language,
            extra_instructions: varExtra,
            max_tokens,
          });

          if (result.error) return err(`content_generator failed: ${result.error}`);
          results.push(result);
        }

        // Format output
        let output = "";
        if (numVariations === 1) {
          output = results[0].content;
        } else {
          output = results.map((r, i) => `## Variation ${i + 1}\n\n${r.content}`).join("\n\n---\n\n");
        }

        const totalTokens = results.reduce((sum, r) => sum + (r.usage?.total_tokens || 0), 0);
        const footer = `\n\n---\n📝 Template: ${template} | Platform: ${platform || "general"} | Model: ${results[0].model} | Tokens: ${totalTokens}`;

        return {
          ...ok(output + footer),
          structuredContent: {
            template,
            topic,
            platform: platform || "general",
            tone: tone || "friendly",
            language: language || "vi",
            variations: numVariations,
            total_tokens: totalTokens,
            model: results[0].model,
          },
        };
      } catch (e) {
        return err(`content_generator failed: ${fmtErr(e)}`);
      }
    }
  );
}
