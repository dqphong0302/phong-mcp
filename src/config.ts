import path from "node:path";
import os from "node:os";
import { fileURLToPath } from "node:url";
import { existsSync } from "node:fs";

// ── Proxy helpers ────────────────────────────────────────────────────────────
export const PROXY_URL =
  process.env.PERPLEXITY_PROXY ||
  process.env.HTTPS_PROXY ||
  process.env.HTTP_PROXY ||
  undefined;

// ── Perplexity Config ────────────────────────────────────────────────────────
export const perplexity = {
  apiKey: process.env.PERPLEXITY_API_KEY || "",
  baseUrl: (process.env.PERPLEXITY_BASE_URL || "https://api.perplexity.ai").replace(/\/$/, ""),
  timeoutMs: parseInt(process.env.PERPLEXITY_TIMEOUT_MS || "300000", 10),
  proxyUrl: PROXY_URL,
};

// ── Consensus Config ─────────────────────────────────────────────────────────
export const consensus = {
  sidecarUrl: (process.env.CONSENSUS_SIDECAR_URL || "http://10.10.10.100:8767").replace(/\/$/, ""),
  sidecarKey: process.env.CONSENSUS_SIDECAR_KEY || "sk-consensus-proxy-48d2f70b2c149",
};

// ── Medical Config ───────────────────────────────────────────────────────────
export const medical = {
  sidecarUrl: (process.env.MEDICAL_SIDECAR_URL || "http://localhost:8770").replace(/\/$/, ""),
};

// ── 9router General Config ───────────────────────────────────────────────────
// Shared api keys
export const NINE_ROUTER_API_KEY =
  process.env.NINE_ROUTER_API_KEY ||
  process.env["9ROUTER_API_KEY"] ||
  process.env["9ROUTER_IMAGE_API_KEY"] ||
  "";

const baseDir = (process.cwd() === "/" || !process.cwd()) ? "/Users/phongdang/home-server" : process.cwd();
const moduleRepoRoot = fileURLToPath(new URL("../../../../", import.meta.url));
const sshConfigPath = [process.env.OPS_SSH_CONFIG, path.join(moduleRepoRoot, ".ssh", "config"), path.join(os.homedir(), ".ssh", "config")].find(p => p && existsSync(p));

// ── Image Config (9router) ───────────────────────────────────────────────────
export const image = {
  apiKey: process.env["9ROUTER_IMAGE_API_KEY"] || NINE_ROUTER_API_KEY,
  baseUrl: (
    process.env["9ROUTER_IMAGE_BASE_URL"] ||
    process.env["9ROUTER_BASE_URL"] ||
    "https://ai-proxy.phongdang.io.vn/images"
  ).replace(/\/$/, ""),
  model: process.env["9ROUTER_IMAGE_MODEL"] || "cloudflare-ai/@cf/black-forest-labs/flux-1-schnell",
  timeoutMs: Number(process.env["9ROUTER_TIMEOUT_MS"] || process.env["9ROUTER_IMAGE_TIMEOUT_MS"] || 180000),
  outputDir: process.env["9ROUTER_IMAGE_OUTPUT_DIR"] || path.resolve(baseDir, "temp"),
};

// ── Distill Config (9router) ─────────────────────────────────────────────────
export const distill = {
  apiKey: NINE_ROUTER_API_KEY,
  baseUrl: (
    process.env.NINE_ROUTER_BASE_URL ||
    process.env["9ROUTER_BASE_URL"] ||
    "https://9router.phongdang.io.vn/v1"
  ).replace(/\/$/, ""),
  model: process.env.DISTILL_MODEL || "cx/gpt-5.4",
  inputBudgetTokens: parseInt(process.env.DISTILL_INPUT_BUDGET || "60000", 10),
  maxFileBytes: parseInt(process.env.DISTILL_MAX_FILE_BYTES || "5242880", 10), // 5 MB
  timeoutMs: parseInt(process.env.DISTILL_TIMEOUT_MS || "180000", 10),
};

// ── Content Gen Config ───────────────────────────────────────────────────────
export const contentGen = {
  apiKey: process.env.CONTENT_GEN_API_KEY || NINE_ROUTER_API_KEY,
  baseUrl: (
    process.env.CONTENT_GEN_BASE_URL ||
    process.env.NINE_ROUTER_BASE_URL ||
    process.env["9ROUTER_BASE_URL"] ||
    "https://9router.phongdang.io.vn/v1"
  ).replace(/\/$/, ""),
  model: process.env.CONTENT_GEN_MODEL || "gpt-4o",
  timeoutMs: 60000,
};

// ── Vietnamese Speech Cluster (TTS/ASR) Config ──────────────────────────────
export const speechCluster = {
  host: process.env.TTS_HOST || "10.10.10.40",
  unifiedPort: parseInt(process.env.TTS_PORT || "80", 10),
  get asrPort() {
    return parseInt(process.env.ASR_PORT || String(this.unifiedPort), 10);
  },
  defaultOutputDir: path.resolve(baseDir, "temp", "tts"),
};

// ── Server / Ops Config ──────────────────────────────────────────────────────
export const serverOps = {
  sshConfig: process.env.OPS_SSH_CONFIG || sshConfigPath || path.join(moduleRepoRoot, ".ssh", "config"),
  timeoutDefault: parseInt(process.env.OPS_SSH_TIMEOUT_DEFAULT || "10", 10),
  fleetDenylist: (process.env.OPS_FLEET_DENYLIST || "claudecode,elearning,do-xang")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean),
  fleetConcurrency: 5,
  maxRawBytes: 50 * 1024,
};

// ── File Conversion Config ───────────────────────────────────────────────────
export const fileConvert = {
  apiKey: process.env.FILE_CONVERT_API_KEY || NINE_ROUTER_API_KEY,
  baseUrl: (process.env.FILE_CONVERT_URL || "https://ai-proxy.phongdang.io.vn/file-convert").replace(/\/$/, ""),
  timeoutMs: 120000,
};

// ── PaperBanana Config ───────────────────────────────────────────────────────
export const paperbanana = {
  url: (process.env.PAPERBANANA_URL || "http://localhost:8782").replace(/\/$/, ""),
  apiKey: process.env.PAPERBANANA_API_KEY || process.env.PHONG_MCP_API_KEY || "",
};

// ── Academic Search Config ───────────────────────────────────────────────────
export const academic = {
  /** Semantic Scholar free API key (optional but recommended for 10x rate limit).
   *  Register: https://www.semanticscholar.org/product/api */
  semanticScholarApiKey: process.env.SEMANTIC_SCHOLAR_API_KEY || "",
  /** NCBI/PubMed API key (optional, increases rate limit 3→10 req/s).
   *  Register: https://www.ncbi.nlm.nih.gov/account/ */
  ncbiApiKey: process.env.NCBI_API_KEY || "",
  /** Email for polite-pool access to OpenAlex & Unpaywall (strongly recommended). */
  unpaywallEmail: process.env.UNPAYWALL_EMAIL || "",
  /** CORE.ac.uk API key for open-access full-text lookup and search.
   *  Optional but strongly recommended: 10x rate limit with free key.
   *  Register free: https://core.ac.uk/services/api
   *  Add to .env: CORE_API_KEY=your_key_here */
  coreApiKey: process.env.CORE_API_KEY || "",
  /** DOAJ & OpenAIRE require no API key — they are completely open. */

  /** Elsevier Scopus API key (required for scopus source).
   *  Free for researchers: https://dev.elsevier.com/
   *  Set SCOPUS_API_KEY in your .env file */
  scopusApiKey: process.env.SCOPUS_API_KEY || "",

  /** IEEE Xplore Digital Library API key (required for ieee source).
   *  Free registration: https://developer.ieee.org/
   *  Set IEEE_API_KEY in your .env file */
  ieeeApiKey: process.env.IEEE_API_KEY || "",

  /** Springer Nature Metadata API key (required for springer source).
   *  Free registration: https://dev.springernature.com/
   *  Set SPRINGER_API_KEY in your .env file */
  springerApiKey: process.env.SPRINGER_API_KEY || "",

  /** Dimensions API key (free tier, requires registration).
   *  Register: https://www.dimensions.ai/contact-us/
   *  Set DIMENSIONS_API_KEY in your .env file */
  dimensionsApiKey: process.env.DIMENSIONS_API_KEY || "",

  /** Web of Science Starter API key (free 50 req/day, institutional 5000/day).
   *  Register: https://developer.clarivate.com/
   *  Set WOS_API_KEY in your .env file */
  wosApiKey: process.env.WOS_API_KEY || "",

  /** 9router API key for SearXNG metasearch & academic discovery. */
  nineRouterApiKey: NINE_ROUTER_API_KEY,

  /** Perplexity key for the `perplexity` academic source.
   *  The source registry looks this up as `perplexityApiKey`; without the entry
   *  every search reported "PERPLEXITY_API_KEY not set" even when it was. */
  perplexityApiKey: process.env.PERPLEXITY_API_KEY || "",

  /** NIST NVD API key (optional, increases rate limit).
   *  Register free: https://nvd.nist.gov/developers/request-an-api-key */
  nvdApiKey: process.env.NVD_API_KEY || "",

  /** Second opinion for papers the deterministic stance engine cannot settle.
   *
   *  Off by default: the rule engine answers most papers instantly, offline and
   *  identically every time, and turning this on trades some of that for a
   *  network round trip on the ambiguous minority. Set STANCE_LLM=1 to enable.
   *  Only papers scoring "unclear" or below the confidence floor are ever sent. */
  stanceLlm: {
    enabled: process.env.STANCE_LLM === "1" || process.env.STANCE_LLM === "true",
    model: process.env.STANCE_LLM_MODEL || "gpt-5.6-luna",
    baseUrl: (
      process.env.STANCE_LLM_BASE_URL ||
      process.env.NINE_ROUTER_BASE_URL ||
      process.env["9ROUTER_BASE_URL"] ||
      "https://9router.phongdang.io.vn/v1"
    ).replace(/\/$/, ""),
    apiKey: process.env.STANCE_LLM_API_KEY || NINE_ROUTER_API_KEY,
    timeoutMs: parseInt(process.env.STANCE_LLM_TIMEOUT_MS || "30000", 10),
    concurrency: parseInt(process.env.STANCE_LLM_CONCURRENCY || "4", 10),
    maxEscalations: parseInt(process.env.STANCE_LLM_MAX || "8", 10),
  },
};

// ── Scrapling Config ────────────────────────────────────────────────────────
export const scrapling = {
  sidecarUrl: (process.env.SCRAPLING_SIDECAR_URL || "https://ai-proxy.phongdang.io.vn/scrapling").replace(/\/$/, ""),
  apiKey: process.env.SCRAPLING_API_KEY || process.env.PERPLEXITY_API_KEY || "aip_f-mqSroRt-XBUcoI4Gt3Dr1mjrNxCjjUe_hFYY8FA4Q",
  timeoutMs: parseInt(process.env.SCRAPLING_TIMEOUT_MS || "60000", 10),
};


