import type { Raw } from "../academic/types.ts";
import { z } from "zod";
import { mkdir, writeFile, readFile, stat } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import { ok, err, fmtErr } from "../utils.ts";
import { speechCluster as config } from "../config.ts";

// All voices go through the unified /tts endpoint on port 80.
// Piper voices (production): maiphuong, minhkhang, ngochuyen, minhquang, thanhphuong2, manhdung
// VieNeu voices (proxied)  : vieneu-ngoclinh, vieneu-ngoclan, vieneu-myduyen, vieneu-trucly, vieneu-giabao, vieneu-xuanvinh, vieneu-ductri, vieneu-thaison, vieneu-tronghuu, vieneu-binhan

function detectEngine(voice: Raw) {
    // All voices use the unified port 80 API.
    // VieNeu voices are prefixed with "vieneu-"; Piper voices are bare names.
    return voice.startsWith("vieneu-") ? "vieneu" : "piper";
}

// ── Core functions ────────────────────────────────────────────────────────────
async function generateAudio({ text, voice, engine, outputDir }: Raw) {
    const detectedEngine = engine || detectEngine(voice);
    // Both Piper and VieNeu voices are served via the unified API on port 80.
    // The unified API auto-routes based on voice prefix (vieneu-* → VieNeu engine).
    const apiUrl = `http://${config.host}:${config.unifiedPort}/tts`;

    const response = await fetch(apiUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text, voice }),
    });

    if (!response.ok) {
        const errText = await response.text();
        throw new Error(`TTS API Error (${response.status}): ${errText}`);
    }

    const buffer    = Buffer.from(await response.arrayBuffer());
    const targetDir = path.resolve(outputDir || config.defaultOutputDir);
    await mkdir(targetDir, { recursive: true });

    const ts       = new Date().toISOString().replace(/[:.]/g, "-");
    const stem     = text.slice(0, 30).normalize("NFKD")
        .replace(/[̀-ͯ]/g, "")
        .replace(/[^a-zA-Z0-9]+/g, "-")
        .replace(/^-+|-+$/g, "") || "audio";
    const filename = `${ts}-${stem}-${voice}.wav`;
    const filePath = path.join(targetDir, filename);

    await writeFile(filePath, buffer);
    return { path: filePath, size: buffer.length, engine: detectedEngine };
}

async function transcribeAudio(filePath: Raw) {
    if (!existsSync(filePath)) throw new Error(`Audio file not found: ${filePath}`);

    // Guard: don't load huge files into memory — match the server-side 50 MB ASR limit.
    const MAX_ASR_SIZE = 50 * 1024 * 1024;
    const { size } = await stat(filePath);
    if (size > MAX_ASR_SIZE) {
        throw new Error(`Audio file too large: ${(size / 1024 / 1024).toFixed(1)} MB (max 50 MB)`);
    }

    const buffer   = await readFile(filePath);
    const formData = new FormData();
    formData.append("file", new Blob([buffer], { type: "audio/wav" }), path.basename(filePath));

    const response = await fetch(`http://${config.host}:${config.asrPort}/asr`, {
        method: "POST",
        body: formData,
    });

    if (!response.ok) {
        const errText = await response.text();
        throw new Error(`ASR API Error (${response.status}): ${errText}`);
    }
    return response.json() as Promise<Raw>;
}

// ── Tool registration ─────────────────────────────────────────────────────────
export function registerTtsTools(server: Raw) {
    server.tool(
        "tts_generate_audio",
        "Generate speech from text using the Vietnamese Speech Cluster (Piper/Valtec/VieNeu). Returns the local path to the generated .wav file.",
        {
            text:       z.string().describe("Text to synthesize into speech. E.g. 'Xin chào các bạn'"),
            voice:      z.string().describe("Voice model to use. Common: 'ngochuyen', 'minhkhang', 'maiphuong', 'minhquang', 'thanhphuong2', 'manhdung'. VieNeu: 'vieneu-ngoclinh', 'vieneu-myduyen', 'vieneu-trucly', 'vieneu-ductri', 'vieneu-thaison', 'vieneu-tronghuu'"),
            engine:     z.enum(["piper", "vieneu"]).optional().describe("Force specific engine. Defaults to auto-detection based on voice name."),
            output_dir: z.string().optional().describe("Directory to save generated .wav files. Defaults to ./temp/tts"),
        },
        async ({ text, voice, engine, output_dir }: Raw) => {
            try {
                const result = await generateAudio({ text, voice, engine, outputDir: output_dir });
                return ok(
                    `Audio generated successfully!\n\nEngine: ${result.engine}\nVoice: ${voice}\nFile Path: \`${result.path}\`\nSize: ${(result.size / 1024).toFixed(2)} KB`
                );
            } catch (e) {
                return err(`TTS Generation failed: ${fmtErr(e)}`);
            }
        }
    );

    server.tool(
        "asr_transcribe",
        "Transcribe a local audio file (.wav, .mp3) into Vietnamese text using Whisper ASR (whisper-large-v3-turbo) on the Vietnamese Speech Cluster.",
        {
            file_path: z.string().describe("Absolute path to the audio file on the server to transcribe."),
        },
        async ({ file_path }: Raw) => {
            try {
                const result     = await transcribeAudio(file_path);
                const transcript = result.text || JSON.stringify(result);
                return ok(`Transcription Result for \`${path.basename(file_path)}\`:\n\n${transcript}`);
            } catch (e) {
                return err(`ASR Transcription failed: ${fmtErr(e)}`);
            }
        }
    );
}
