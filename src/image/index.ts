import { errorMessage } from "../academic/errors.ts";
import type { Raw } from "../academic/types.ts";
import { z } from "zod";
import { mkdir, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import sharp from "sharp";
import { ok, err, fmtErr } from "../utils.ts";
import { image as config } from "../config.ts";
import { proxyAwareFetch } from "../http.ts";

// ── Internal helpers ──────────────────────────────────────────────────────────
function safeJsonParse(text: Raw) {
    try { return JSON.parse(text); } catch { return null; }
}

function parseSseBody(text: Raw) {
    const events = [], dataLines = [];
    for (const rawLine of text.split(/\r?\n/)) {
        const line = rawLine.trimEnd();
        if (!line || line.startsWith(":") || !line.startsWith("data:")) continue;
        const data = line.slice(5).trimStart();
        if (!data || data === "[DONE]") continue;
        dataLines.push(data);
        events.push(safeJsonParse(data) ?? data);
    }
    return { events, dataLines };
}

interface ImageHint {
    path: string;
    kind: string;
    value: string;
}

function findImageHints(value: Raw, p = "root", acc: ImageHint[] = []): ImageHint[] {
    if (value == null) return acc;
    if (typeof value === "string") {
        const lower     = value.toLowerCase();
        const isUrl     = /^https?:\/\//i.test(value);
        const isImgUrl  = isUrl && /\.(png|jpe?g|webp)(\?|#|$)/i.test(value);
        const isDataImg = lower.startsWith("data:image/");
        const looksB64  = value.length > 200 && /^[A-Za-z0-9+/=\n\r]+$/.test(value.slice(0, 256));
        if (isImgUrl || isDataImg || looksB64)
            acc.push({ path: p, kind: isImgUrl ? "image_url" : isDataImg ? "data_image" : "base64_like", value: isImgUrl ? value : `[${value.length} chars omitted]` });
        else if (isUrl)
            acc.push({ path: p, kind: "url", value });
        return acc;
    }
    if (Array.isArray(value)) { value.forEach((v, i) => findImageHints(v, `${p}[${i}]`, acc)); return acc; }
    if (typeof value === "object") { for (const [k, v] of Object.entries(value)) findImageHints(v, `${p}.${k}`, acc); }
    return acc;
}

function getGeneratedImages(payload: Raw) {
    if (!payload || !Array.isArray(payload.data)) return [];
    return payload.data
        .map((item: Raw, index: Raw) => (item && typeof item.b64_json === "string" ? { index, b64Json: item.b64_json } : null))
        .filter(Boolean);
}

function sanitizeFileStem(text: Raw) {
    return text.normalize("NFKD")
        .replace(/[̀-ͯ]/g, "")
        .replace(/[^a-zA-Z0-9._-]+/g, "-")
        .replace(/^-+|-+$/g, "")
        .slice(0, 80) || "image";
}

async function saveGeneratedImages(payload: Raw, { prompt, outputFormat, outputDir }: Raw) {
    const images = getGeneratedImages(payload);
    if (images.length === 0) return [];
    const targetDir = path.resolve(outputDir || config.outputDir);
    await mkdir(targetDir, { recursive: true });
    const stem = sanitizeFileStem(prompt);
    const ts   = new Date().toISOString().replace(/[:.]/g, "-");
    return Promise.all(images.map(async (image: Raw) => {
        const filename = `${ts}-${stem}-${image.index + 1}.${outputFormat}`;
        const filePath = path.join(targetDir, filename);
        await writeFile(filePath, Buffer.from(image.b64Json, "base64"));
        return { index: image.index, path: filePath, filename };
    }));
}

function summarizePayload(payload: Raw, rawText: Raw, savedFiles: Array<{ index: number; path: string; filename: string }> = []) {
    const hints = findImageHints(payload ?? rawText);
    let out = "## 9router Image Generation Result\n\n";
    if (hints.length > 0) {
        out += "### Image / URL Hints\n";
        for (const h of hints.slice(0, 20)) out += `- **${h.kind}** at \`${h.path}\`: ${h.value}\n`;
        out += "\n";
    }
    if (savedFiles.length > 0) {
        out += "### Saved Files\n";
        for (const f of savedFiles) out += `- Image ${f.index + 1}: \`${f.path}\`\n`;
        out += "\n";
    }
    out += "### Response Summary\n";
    if (payload) {
        const compact = JSON.stringify(payload, null, 2);
        out += "```json\n" + (compact.length > 12000 ? compact.slice(0, 12000) + "\n... [truncated]" : compact) + "\n```\n";
    } else {
        out += "```text\n" + (rawText.length > 12000 ? rawText.slice(0, 12000) + "\n... [truncated]" : rawText) + "\n```\n";
    }
    return out;
}

async function call9routerImage(body: Raw) {
    if (!config.apiKey) throw new Error("Missing 9ROUTER_IMAGE_API_KEY environment variable");
    
    // Model fallback chain: Request model -> Configured model -> Cloudflare Flux & SDXL -> others
    const fallbackModels = [
        body.model,
        config.model,
        "cloudflare-ai/@cf/black-forest-labs/flux-1-schnell",
        "cloudflare-ai/@cf/stabilityai/stable-diffusion-xl-base-1.0",
        "cx/gpt-5.4-image",
        "antigravity/imagen-3.0-generate-002",
    ].filter((m, i, arr) => Boolean(m) && arr.indexOf(m) === i);

    let lastError = null;
    for (const modelCandidate of fallbackModels) {
        try {
            const reqBody = { ...body, model: modelCandidate };
            const resp = await proxyAwareFetch(`${config.baseUrl}/v1/images/generations`, {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                    "Authorization": `Bearer ${config.apiKey}`,
                    "Accept": "text/event-stream",
                },
                body: JSON.stringify(reqBody),
                timeout: config.timeoutMs,
            });
            const text = await resp.text();
            if (!resp.ok) {
                const e = safeJsonParse(text);
                throw new Error(`9router request failed (${modelCandidate}): ${e?.error?.message || e?.detail || text || `HTTP ${resp.status}`}`);
            }
            const ct = resp.headers.get("content-type") || "";
            if (ct.includes("text/event-stream") || text.includes("data:")) {
                const { events, dataLines } = parseSseBody(text);
                return [...events].reverse().find(e => e && typeof e === "object") || { events, raw_data_lines: dataLines };
            }
            return safeJsonParse(text) ?? text;
        } catch (e) {
            lastError = e;
            console.warn(`[image] Model ${modelCandidate} failed, attempting next fallback... (${errorMessage(e)})`);
        }
    }
    throw lastError || new Error("All image model fallbacks failed");
}

async function aiUpscaleImage(inputBuffer: Raw, { targetWidth, targetHeight, outputFormat }: Raw) {
    if (!config.apiKey) throw new Error("Missing 9ROUTER_IMAGE_API_KEY — cannot use AI upscale");
    const mime    = outputFormat === "jpeg" ? "image/jpeg" : outputFormat === "webp" ? "image/webp" : "image/png";
    const dataUri = `data:${mime};base64,${inputBuffer.toString("base64")}`;
    const sizeHint = (targetWidth && targetHeight) ? `${targetWidth}x${targetHeight}` :
                      targetWidth ? `width ${targetWidth}px` :
                      targetHeight ? `height ${targetHeight}px` : "larger";
    const body = {
        model: config.model,
        prompt: `Upscale and enhance this image to ${sizeHint}. Make it sharp, crisp, and high-resolution. Preserve all details, colors, and composition exactly. Do not add new elements.`,
        n: 1,
        size: (targetWidth && targetHeight) ? `${targetWidth}x${targetHeight}` : "auto",
        quality: "high",
        output_format: outputFormat || "png",
        image: dataUri,
    };
    const payload = await call9routerImage(body);
    const images  = getGeneratedImages(payload);
    if (images.length === 0) throw new Error("AI upscale returned no images");
    return Buffer.from(images[0].b64Json, "base64");
}

function resolveCropPreset(preset: Raw, imgWidth: Raw, imgHeight: Raw) {
    const ratios: Record<string, number> = { "square": 1, "1:1": 1, "16:9": 16/9, "4:3": 4/3, "3:2": 3/2, "2:1": 2, "9:16": 9/16, "3:4": 3/4 };
    const targetRatio = ratios[preset];
    if (!targetRatio) throw new Error(`Unknown crop preset "${preset}". Available: ${Object.keys(ratios).join(", ")}`);
    const cur = imgWidth / imgHeight;
    let cropW, cropH;
    if (cur > targetRatio) { cropH = imgHeight; cropW = Math.round(imgHeight * targetRatio); }
    else                   { cropW = imgWidth;  cropH = Math.round(imgWidth / targetRatio);  }
    return { left: Math.floor((imgWidth - cropW) / 2), top: Math.floor((imgHeight - cropH) / 2), width: cropW, height: cropH };
}

function applyOutputFormat(pipeline: Raw, format: Raw, quality: Raw) {
    const q = quality || 85;
    switch (format) {
        case "jpeg": pipeline.jpeg({ quality: q }); break;
        case "webp": pipeline.webp({ quality: q }); break;
        case "avif": pipeline.avif({ quality: q }); break;
        case "png":  pipeline.png({ compressionLevel: Math.round((100 - q) / 11) }); break;
        default:     pipeline.png(); break;
    }
}

// ── Tool registration ─────────────────────────────────────────────────────────
export function registerImageTools(server: Raw) {
    server.tool(
        "image_create_image",
        "Generate images via 9router image API using cx/gpt-5.4-image by default.",
        {
            prompt:        z.string().describe("Image prompt, e.g. 'A cute cat wearing a hat'"),
            n:             z.number().optional().describe("Number of images to generate (1-4, default: 1)"),
            size:          z.string().optional().describe("Image size, default: auto"),
            quality:       z.string().optional().describe("Image quality, default: auto"),
            background:    z.string().optional().describe("Background mode, default: auto"),
            image_detail:  z.string().optional().describe("Image detail level, default: high"),
            output_format: z.enum(["png", "jpeg", "webp"]).optional().describe("Output format"),
            model:         z.string().optional().describe("9router image model"),
            output_dir:    z.string().optional().describe("Directory to save generated image files, default: ./temp or 9ROUTER_IMAGE_OUTPUT_DIR"),
        },
        async ({ prompt, n, size, quality, background, image_detail, output_format, model, output_dir }: Raw) => {
            const body = {
                model:         model || config.model,
                prompt,
                n:             n || 1,
                size:          size || "auto",
                quality:       quality || "auto",
                background:    background || "auto",
                image_detail:  image_detail || "high",
                output_format: output_format || "png",
            };
            try {
                const payload    = await call9routerImage(body);
                const savedFiles = await saveGeneratedImages(payload, { prompt, outputFormat: body.output_format, outputDir: output_dir });
                const rawText    = typeof payload === "string" ? payload : JSON.stringify(payload, null, 2);
                return ok(summarizePayload(payload, rawText, savedFiles));
            } catch (e) {
                return err(`Failed to generate image: ${fmtErr(e)}`);
            }
        }
    );

    server.tool(
        "image_process_image",
        [
            "Process a local image file: resize, crop, and/or convert format.",
            "When ENLARGING (scale > 1 or target dimensions bigger than source), AI upscaling is used automatically for sharper results.",
            "When SHRINKING or keeping size, fast local processing via sharp is used (no AI cost).",
            "Crop supports exact pixel coordinates and aspect-ratio presets (square, 16:9, 4:3, 3:2, 2:1, 9:16, 3:4).",
            "Useful for preparing web assets quickly: optimize images, convert to WebP, cut to exact sizes.",
        ].join(" "),
        {
            input_path: z.string().describe("Absolute path to the source image file. Supported: PNG, JPEG, WebP, AVIF, GIF, TIFF."),
            output_path: z.string().optional().describe("Absolute path for the output file. If omitted, a timestamped file is created next to the source."),
            output_format: z.enum(["png", "jpeg", "webp", "avif"]).optional().describe("Output format. Defaults to source format. WebP is recommended for web use."),
            quality: z.number().min(1).max(100).optional().describe("Quality for lossy formats (JPEG, WebP, AVIF). Range 1–100, default: 85."),
            resize: z.object({
                width:  z.number().int().positive().optional().describe("Target width in pixels."),
                height: z.number().int().positive().optional().describe("Target height in pixels."),
                scale:  z.number().positive().optional().describe("Scale factor, e.g. 2.0 = double, 0.5 = half."),
                fit:    z.enum(["cover", "contain", "fill", "inside", "outside"]).optional().describe("Fit mode (default: inside)."),
            }).optional().describe("Resize options. Omit to keep original dimensions."),
            crop: z.union([
                z.object({
                    x:      z.number().int().min(0).describe("Left offset in pixels."),
                    y:      z.number().int().min(0).describe("Top offset in pixels."),
                    width:  z.number().int().positive().describe("Crop width in pixels."),
                    height: z.number().int().positive().describe("Crop height in pixels."),
                }),
                z.object({
                    preset: z.enum(["square", "1:1", "16:9", "4:3", "3:2", "2:1", "9:16", "3:4"]).describe("Aspect ratio preset — crops centered to the target ratio."),
                }),
            ]).optional().describe("Crop the image before resizing."),
            use_ai_upscale: z.boolean().optional().describe("Force AI upscale ON or OFF. Default: auto (AI used only when enlarging)."),
        },
        async ({ input_path, output_path, output_format, quality, resize, crop, use_ai_upscale }: Raw) => {
            try {
                if (!existsSync(input_path)) throw new Error(`Input file not found: ${input_path}`);

                let pipeline = sharp(input_path);
                const meta   = await pipeline.metadata();
                const srcW   = meta.width ?? 0;
                const srcH   = meta.height ?? 0;
                const outFmt = output_format || meta.format || "png";

                // Crop
                let cropRegion = null;
                if (crop) {
                    cropRegion = "preset" in crop
                        ? resolveCropPreset(crop.preset, srcW, srcH)
                        : { left: crop.x, top: crop.y, width: Math.min(crop.width, srcW - crop.x), height: Math.min(crop.height, srcH - crop.y) };
                    pipeline = pipeline.extract(cropRegion);
                }

                const afterW = cropRegion ? cropRegion.width  : srcW;
                const afterH = cropRegion ? cropRegion.height : srcH;

                // Resize
                let targetW = null, targetH = null, isEnlarging = false;
                if (resize) {
                    if (resize.scale != null) {
                        targetW     = Math.round(afterW * resize.scale);
                        targetH     = Math.round(afterH * resize.scale);
                        isEnlarging = resize.scale > 1;
                    } else {
                        targetW     = resize.width  || null;
                        targetH     = resize.height || null;
                        const scaleW = targetW ? targetW / afterW : 1;
                        const scaleH = targetH ? targetH / afterH : 1;
                        isEnlarging  = Math.max(scaleW, scaleH) > 1;
                    }
                }

                const useAI = use_ai_upscale != null ? use_ai_upscale : (isEnlarging && !!config.apiKey);
                const steps = [];
                let finalBuffer;

                if (useAI && isEnlarging) {
                    steps.push("crop (local sharp)");
                    const croppedBuf = await pipeline.toBuffer();
                    steps.push(`AI upscale → ${targetW ?? "auto"}×${targetH ?? "auto"} via 9router`);
                    const upscaled = await aiUpscaleImage(croppedBuf, { targetWidth: targetW, targetHeight: targetH, outputFormat: outFmt });
                    if (outFmt !== "png" || quality) {
                        const post = sharp(upscaled);
                        applyOutputFormat(post, outFmt, quality);
                        finalBuffer = await post.toBuffer();
                        steps.push(`convert to ${outFmt}`);
                    } else {
                        finalBuffer = upscaled;
                    }
                } else {
                    if (targetW || targetH) {
                        pipeline = pipeline.resize(targetW, targetH, { fit: resize?.fit || "inside", withoutEnlargement: false });
                        steps.push(`resize to ${targetW ?? "auto"}×${targetH ?? "auto"} (${resize?.fit || "inside"})`);
                    }
                    applyOutputFormat(pipeline, outFmt, quality);
                    steps.push(`convert to ${outFmt}${quality ? ` q=${quality}` : ""}`);
                    finalBuffer = await pipeline.toBuffer();
                }

                // Save output
                let outPath = output_path;
                if (!outPath) {
                    const dir  = path.dirname(input_path);
                    const stem = path.basename(input_path, path.extname(input_path));
                    const ts   = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
                    outPath = path.join(dir, `${stem}-processed-${ts}.${outFmt}`);
                }
                await mkdir(path.dirname(outPath), { recursive: true });
                await writeFile(outPath, finalBuffer);

                const outMeta    = await sharp(finalBuffer).metadata();
                const fileSizeKB = Math.round(finalBuffer.length / 1024);

                let report = "## 9router Image Processor Result\n\n";
                report += `**Input:** \`${input_path}\`  \n**Output:** \`${outPath}\`  \n\n`;
                report += "### Dimensions\n| | Width | Height |\n|---|---|---|\n";
                report += `| Source | ${srcW}px | ${srcH}px |\n`;
                if (cropRegion) report += `| After crop | ${cropRegion.width}px | ${cropRegion.height}px |\n`;
                report += `| Output | ${outMeta.width}px | ${outMeta.height}px |\n\n`;
                report += "### Processing Steps\n";
                steps.forEach((s, i) => { report += `${i + 1}. ${s}\n`; });
                report += "\n### Output Info\n";
                report += `- **Format:** ${outFmt.toUpperCase()}\n- **File size:** ${fileSizeKB} KB\n`;
                report += `- **Method:** ${useAI && isEnlarging ? `AI upscale (9router ${config.model})` : "Local (sharp)"}\n`;

                return ok(report);
            } catch (e) {
                return err(`process_image failed: ${fmtErr(e)}`);
            }
        }
    );
}
