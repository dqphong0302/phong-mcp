/**
 * Academic source plugin registry.
 *
 * Each source plugin must implement:
 * {
 *   id:          string            — unique source identifier
 *   name:        string            — display name
 *   requiresKey: boolean           — whether an API key is needed
 *   keyEnvVar:   string|null       — env var name for the key
 *   domains:     string[]          — coverage domains
 *   search:      async (query, opts, config) => { papers, total }
 *   getById?:    async (id, config) => AcademicPaper|null  (optional)
 * }
 */

// ── Source imports ────────────────────────────────────────────────────────────
import * as openalex        from "./openalex.js";
import * as semanticScholar from "./semantic-scholar.js";
import * as arxiv           from "./arxiv.js";
import * as pubmed          from "./pubmed.js";
import * as crossref        from "./crossref.js";
import * as europePmc       from "./europe-pmc.js";
import * as dblp            from "./dblp.js";
import * as core            from "./core.js";
import * as doaj            from "./doaj.js";
import * as openaire        from "./openaire.js";
import * as scopus          from "./scopus.js";
import * as ieee            from "./ieee.js";
import * as springer        from "./springer.js";
import * as papersWithCode  from "./papers-with-code.js";
import * as dimensions      from "./dimensions.js";
import * as biorxiv         from "./biorxiv.js";
import * as webOfScience    from "./web-of-science.js";
import * as zenodo          from "./zenodo.js";
import * as hal             from "./hal.js";
import * as chemrxiv        from "./chemrxiv.js";
import * as huggingface     from "./huggingface.js";
import * as openreview      from "./openreview.js";
import * as searxng         from "./searxng.js";
import * as clinicaltrials  from "./clinicaltrials.js";
import * as medrxiv         from "./medrxiv.js";
import * as openfda         from "./openfda.js";
import * as cveNvd          from "./cve-nvd.js";
import * as cisaKev         from "./cisa-kev.js";
import * as osv             from "./osv.js";
import * as aclAnthology    from "./acl-anthology.js";
import * as usptoPatents    from "./uspto-patents.js";
import * as pubchem         from "./pubchem.js";
import * as uniprot         from "./uniprot.js";
import * as rcsbPdb         from "./rcsb-pdb.js";
import * as clinvar         from "./clinvar.js";
import * as hfDatasets      from "./hf-datasets.js";
import * as dataverse       from "./dataverse.js";
import * as stackexchange   from "./stackexchange.js";
import * as softwareHeritage from "./software-heritage.js";
import * as oatd            from "./oatd.js";
import * as whoIris         from "./who-iris.js";
import * as medpharmres      from "./medpharmres.js";
import * as tapchiYhocTphcm  from "./tapchi-yhoc-tphcm.js";
import * as vistaNasati      from "./vista-nasati.js";
import * as vjol             from "./vjol.js";
import * as vast             from "./vast.js";
import * as jstHust          from "./jst-hust.js";
import * as eric             from "./eric.js";
import * as econbiz          from "./econbiz.js";
import * as inspireHep       from "./inspire-hep.js";
import * as nasaAds          from "./nasa-ads.js";
import * as osfPreprints     from "./osf-preprints.js";
import * as doab             from "./doab.js";
import * as jstage           from "./jstage.js";
import * as datacite         from "./datacite.js";
import * as figshare         from "./figshare.js";
import * as worldBank        from "./world-bank.js";
import * as osti             from "./osti.js";
import * as pmc              from "./pmc.js";
import * as plos             from "./plos.js";
import * as ntrs             from "./ntrs.js";
import * as nihReporter      from "./nih-reporter.js";
import * as patentsview      from "./patentsview.js";
import * as baseSearch       from "./base-search.js";
import * as lens             from "./lens.js";
import * as philpapers       from "./philpapers.js";
import * as faoOkr           from "./fao-okr.js";
import * as dryad            from "./dryad.js";
import * as ncbiGeo          from "./ncbi-geo.js";
import * as secEdgar         from "./sec-edgar.js";
import * as fred             from "./fred.js";
import * as govinfo          from "./govinfo.js";
import * as consensus        from "./consensus.js";
import * as googleScholar    from "./google-scholar.js";
import * as openevidence     from "./openevidence.js";
import * as ajol             from "./ajol.js";
import * as banglajol        from "./banglajol.js";
import * as nepjol           from "./nepjol.js";
import * as philjol          from "./philjol.js";
import * as mongoliajol      from "./mongoliajol.js";
import * as sljol            from "./sljol.js";
import * as lamjol           from "./lamjol.js";
import * as thaijo           from "./thaijo.js";
import * as epistemonikos    from "./epistemonikos.js";
import * as isrctn           from "./isrctn.js";
import * as osfRegistries    from "./osf-registries.js";
import * as tapchiNghiencuuyhoc from "./tapchi-nghiencuuyhoc.js";
import * as vnuJs            from "./vnu-js.js";
import * as perplexity       from "./perplexity.js";
import * as ssrn             from "./ssrn.js";
import * as scielo           from "./scielo.js";
import * as cinii            from "./cinii.js";
import * as dailymed         from "./dailymed.js";
import * as reactome         from "./reactome.js";
import * as bindingdb        from "./bindingdb.js";
import * as zinc             from "./zinc.js";
import * as chembl           from "./chembl.js";
import * as vnulib           from "./vnulib.js";

// ── Registry ──────────────────────────────────────────────────────────────────

/** @type {Map<string, Object>} */
export const SOURCES = new Map([
  ["vnulib",            vnulib],
  ["openalex",          openalex],
  ["semantic_scholar",  semanticScholar],
  ["arxiv",             arxiv],
  ["pubmed",            pubmed],
  ["vjol",              vjol],
  ["vast",              vast],
  ["jst_hust",          jstHust],
  ["medpharmres",       medpharmres],
  ["tapchi_yhoc_tphcm", tapchiYhocTphcm],
  ["vista_nasati",      vistaNasati],
  ["perplexity",        perplexity],
  ["crossref",          crossref],
  ["europe_pmc",        europePmc],
  ["dblp",              dblp],
  ["core",              core],
  ["doaj",              doaj],
  ["openaire",          openaire],
  ["scopus",            scopus],
  ["ieee",              ieee],
  ["springer",          springer],
  ["papers_with_code",  papersWithCode],
  ["dimensions",        dimensions],
  ["biorxiv",           biorxiv],
  ["web_of_science",    webOfScience],
  ["zenodo",            zenodo],
  ["hal",               hal],
  ["chemrxiv",          chemrxiv],
  ["huggingface",       huggingface],
  ["openreview",        openreview],
  ["searxng",           searxng],
  ["clinicaltrials",    clinicaltrials],
  ["medrxiv",           medrxiv],
  ["openfda",           openfda],
  ["cve_nvd",           cveNvd],
  ["cisa_kev",          cisaKev],
  ["osv",               osv],
  ["acl_anthology",     aclAnthology],
  ["uspto_patents",     usptoPatents],
  ["pubchem",           pubchem],
  ["uniprot",           uniprot],
  ["rcsb_pdb",          rcsbPdb],
  ["clinvar",           clinvar],
  ["hf_datasets",       hfDatasets],
  ["dataverse",         dataverse],
  ["stackexchange",     stackexchange],
  ["software_heritage", softwareHeritage],
  ["oatd",              oatd],
  ["who_iris",          whoIris],
  ["eric",              eric],
  ["econbiz",           econbiz],
  ["inspire_hep",       inspireHep],
  ["nasa_ads",          nasaAds],
  ["osf_preprints",     osfPreprints],
  ["doab",              doab],
  ["jstage",            jstage],
  ["datacite",          datacite],
  ["figshare",          figshare],
  ["world_bank",        worldBank],
  ["osti",              osti],
  ["pmc",               pmc],
  ["plos",              plos],
  ["ntrs",              ntrs],
  ["nih_reporter",      nihReporter],
  ["patentsview",       patentsview],
  ["base_search",       baseSearch],
  ["lens",              lens],
  ["philpapers",        philpapers],
  ["fao_okr",           faoOkr],
  ["dryad",             dryad],
  ["ncbi_geo",          ncbiGeo],
  ["sec_edgar",         secEdgar],
  ["fred",              fred],
  ["govinfo",           govinfo],
  ["consensus",         consensus],
  ["google_scholar",    googleScholar],
  ["openevidence",      openevidence],
  ["ajol",              ajol],
  ["banglajol",         banglajol],
  ["nepjol",            nepjol],
  ["philjol",           philjol],
  ["mongoliajol",       mongoliajol],
  ["sljol",             sljol],
  ["lamjol",            lamjol],
  ["thaijo",            thaijo],
  ["epistemonikos",     epistemonikos],
  ["isrctn",            isrctn],
  ["osf_registries",    osfRegistries],
  ["tapchi_nghiencuuyhoc", tapchiNghiencuuyhoc],
  ["vnu_js",            vnuJs],
  ["ssrn",              ssrn],
  ["scielo",            scielo],
  ["cinii",             cinii],
  ["dailymed",          dailymed],
  ["reactome",          reactome],
  ["bindingdb",         bindingdb],
  ["zinc",              zinc],
  ["chembl",            chembl],
]);

// ── Presets ───────────────────────────────────────────────────────────────────

/**
 * 8 Core Domain Presets + 4 Utility Modes.
 * Provides clean, comprehensive, domain-optimized querying with 100% backward-compatible aliases.
 */
export const SOURCE_PRESETS = {
  // ── ⚡ 4 Chế Độ Tiện Ích Chung ───────────────────────────────────────────────
  /** Default: Đa ngành nhanh, không cần API key */
  default:           ["openalex", "semantic_scholar", "crossref"],

  /** Open Access: Chỉ quét các nguồn bài báo 100% Free Full-Text PDF */
  open_access:       ["scielo", "ssrn", "cinii", "vjol", "vast", "doaj", "core", "openaire", "openalex", "europe_pmc", "zenodo", "doab", "plos", "pmc", "base_search", "ajol", "thaijo"],

  /** Preprints: Toàn bộ bản thảo sớm đa ngành (arXiv, bioRxiv, medRxiv, ChemRxiv, SSRN, OSF) */
  preprints:         ["arxiv", "ssrn", "biorxiv", "medrxiv", "osf_preprints", "chemrxiv", "papers_with_code", "huggingface"],

  /** Exhaustive: Quét cạn kiệt toàn bộ các nguồn dữ liệu */
  exhaustive:        [
    "openalex", "semantic_scholar", "arxiv", "pubmed", "crossref",
    "europe_pmc", "dblp", "core", "doaj", "openaire",
    "scopus", "ieee", "springer", "papers_with_code", "dimensions",
    "biorxiv", "medrxiv", "clinicaltrials", "openfda", "cve_nvd", "cisa_kev", "osv", "acl_anthology",
    "uspto_patents", "pubchem", "uniprot", "rcsb_pdb", "clinvar", "hf_datasets", "dataverse",
    "stackexchange", "software_heritage", "oatd", "who_iris", "vjol", "vast", "jst_hust", "medpharmres", "tapchi_yhoc_tphcm", "vista_nasati",
    "web_of_science", "zenodo", "hal", "chemrxiv",
    "huggingface", "openreview", "searxng", "perplexity",
    "osti", "pmc", "plos", "ntrs", "nih_reporter",
    "patentsview", "base_search", "lens", "philpapers",
    "fao_okr", "dryad", "ncbi_geo", "sec_edgar", "fred", "govinfo",
    "consensus", "google_scholar", "openevidence",
    "ajol", "banglajol", "nepjol", "philjol", "mongoliajol", "sljol", "lamjol", "thaijo",
    "epistemonikos", "isrctn", "osf_registries", "tapchi_nghiencuuyhoc", "vnu_js", "vnulib",
    "eric", "econbiz", "inspire_hep", "nasa_ads", "osf_preprints",
    "doab", "jstage", "datacite", "figshare", "world_bank",
    "ssrn", "scielo", "cinii",
    "dailymed", "reactome", "bindingdb", "zinc", "chembl",
  ],

  // ── 🌟 8 Nhóm Chuyên Ngành Trụ Cột (Core Domains) ───────────────────────────
  /** 1. Vietnam: Toàn bộ học thuật, kỹ thuật & y tế Việt Nam (130+ tạp chí VJOL, VAST, HUST, VNU, UMP, NASATI) */
  vietnam:           ["vnulib", "vjol", "vast", "jst_hust", "vnu_js", "vista_nasati", "tapchi_yhoc_tphcm", "tapchi_nghiencuuyhoc", "medpharmres", "openalex", "searxng", "perplexity"],

  /** 1B. VNU-HCM: Thư viện ĐHQG-HCM + các tạp chí ĐHQG/VN. Chỉ riêng thư viện: dùng nguồn "vnulib". */
  vnu_hcm:           ["vnulib", "vnu_js", "vjol", "vast", "vista_nasati", "openalex"],

  /** 2. Biomedical: Y - Dược, Sinh học, Lâm sàng, Thử nghiệm thuốc & Genomics toàn diện */
  biomedical:        ["pubmed", "pmc", "plos", "europe_pmc", "clinicaltrials", "isrctn", "medrxiv", "biorxiv", "openfda", "dailymed", "pubchem", "chembl", "uniprot", "clinvar", "rcsb_pdb", "reactome", "bindingdb", "ncbi_geo", "who_iris"],

  /** 3. AI & Computer Science: Trí tuệ nhân tạo, LLM, Computer Vision, Dữ liệu & An ninh mạng */
  ai_cs:             ["semantic_scholar", "openalex", "arxiv", "dblp", "papers_with_code", "huggingface", "openreview", "acl_anthology", "hf_datasets", "dataverse", "zenodo", "cve_nvd", "osv"],

  /** 4. STEM & Nature: Vật lý, Hóa học, Kỹ thuật năng lượng, Vật liệu, Hàng không vũ trụ & Nông nghiệp */
  stem_nature:       ["inspire_hep", "nasa_ads", "osti", "ntrs", "chemrxiv", "pubchem", "chembl", "zinc", "bindingdb", "fao_okr", "dryad", "ieee", "springer", "openalex"],

  /** 5. Social Sciences & Humanities: Kinh tế, Tài chính, Giáo dục, Xã hội, Nhân văn & Luận án */
  social_humanities: ["econbiz", "ssrn", "world_bank", "sec_edgar", "fred", "eric", "doab", "oatd", "hal", "philpapers", "osf_preprints", "openalex"],

  /** 6. Evidence Review: Tổng quan hệ thống, Y học chứng cứ (EBM), Thử nghiệm lâm sàng & Đồng thuận */
  evidence_review:   ["epistemonikos", "consensus", "osf_registries", "clinicaltrials", "isrctn", "pmc", "pubmed", "europe_pmc"],

  /** 7. Patents & Gov: Sáng chế quốc tế, Báo cáo chính phủ, Bản đồ tài trợ & Pháp lý */
  patents_gov:       ["patentsview", "lens", "uspto_patents", "govinfo", "nih_reporter", "world_bank", "sec_edgar"],

  /** 8. Global Regional: Mạng tạp chí Châu Á - TBD, Nam bán cầu, Châu Phi & Mỹ Latinh */
  global_regional:   ["jstage", "cinii", "thaijo", "scielo", "ajol", "banglajol", "nepjol", "philjol", "sljol", "lamjol", "mongoliajol"],
};

// ── 🔄 Backward Compatibility Aliases ──────────────────────────────────────────
export const PRESET_ALIASES = {
  // VNULIB & VNU-HCM
  // "vnulib" is deliberately NOT a preset: it names the single OPAC source.
  dhqg_hcm:            "vnu_hcm",
  vietnam_theses:      "vnu_hcm",

  // Vietnam
  vietnam_academic:    "vietnam",
  vietnam_medical:     "vietnam",
  vietnam_science:     "vietnam",
  vietnam_engineering: "vietnam",
  vietnam_agriculture: "vietnam",
  vietnam_economics:   "vietnam",
  vietnam_education:   "vietnam",
  vietnam_social:      "vietnam",

  // Biomedical & Health
  biomedical_full:     "biomedical",
  clinical_trials:     "biomedical",
  pharma_clinical:     "biomedical",
  pharma_deep:         "biomedical",
  bioinformatics:      "biomedical",
  global_health:       "biomedical",
  fulltext_biomedical: "biomedical",

  // AI & CS
  cs_ai:               "ai_cs",
  ml_ai_deep:          "ai_cs",
  nlp_llm:             "ai_cs",
  nlp_acl:             "ai_cs",
  cv_vision:           "ai_cs",
  code_knowledge:      "ai_cs",
  cyber_security:      "ai_cs",
  datasets:            "ai_cs",

  // STEM
  physics:             "stem_nature",
  chemistry:           "stem_nature",
  energy_materials:    "stem_nature",
  aerospace:           "stem_nature",
  agriculture:         "stem_nature",

  // Social & Humanities
  economics:           "social_humanities",
  education:           "social_humanities",
  humanities:          "social_humanities",
  books:               "social_humanities",
  theses:              "social_humanities",

  // Evidence
  systematic_review:   "evidence_review",
  evidence_based:      "evidence_review",

  // Patents & Gov
  patents:             "patents_gov",
  us_gov:              "patents_gov",
  funding:             "patents_gov",

  // Regional
  asia_pacific:        "global_regional",
  global_south:        "global_regional",
  africa:              "global_regional",
  latin_america:       "global_regional",

  // Misc
  science_web:         "default",
  ai_search:           "default",
  openalex_deep:       "default",
  reputable:           "stem_nature",
  eu_research:         "stem_nature",
};

// Merge aliases directly into SOURCE_PRESETS for instant O(1) resolution
for (const [alias, target] of Object.entries(PRESET_ALIASES)) {
  if (SOURCE_PRESETS[target]) {
    SOURCE_PRESETS[alias] = SOURCE_PRESETS[target];
  }
}

// A preset that shares a source's name would silently expand when the caller
// asked for that one source (this happened with "vnulib"). Refuse at load time.
for (const name of Object.keys(SOURCE_PRESETS)) {
  if (SOURCES.has(name)) throw new Error(`Preset "${name}" shadows the source of the same name — rename the preset.`);
}

// ── Helpers ───────────────────────────────────────────────────────────────────

/**
 * Resolve a source list — accepts source IDs or a preset name.
 * @param {string[]|string} sources
 * @returns {string[]}
 */
export function resolveSources(sources) {
  if (!sources) return SOURCE_PRESETS.default || [];
  if (typeof sources === "string") {
    const preset = SOURCE_PRESETS[sources];
    if (!preset && SOURCES.has(sources)) return [sources];
    if (!preset) throw new Error(`Unknown preset: "${sources}". Valid presets: ${Object.keys(SOURCE_PRESETS).join(", ")}`);
    return preset;
  }
  if (Array.isArray(sources)) {
    const flat = [];
    for (const s of sources) {
      if (typeof s === "string" && SOURCE_PRESETS[s]) {
        flat.push(...SOURCE_PRESETS[s]);
      } else if (typeof s === "string") {
        flat.push(s);
      }
    }
    return [...new Set(flat)];
  }
  return sources;
}

/**
 * Get sources that are available given the current config (have required keys).
 * Sources without keys are always available. Sources missing required keys are skipped with a warning.
 *
 * @param {string[]} sourceIds
 * @param {Object} config  — academic config object from config.js
 * @returns {{ available: string[], skipped: Array<{id, reason}> }}
 */
export function filterAvailableSources(sourceIds, config) {
  const available = [];
  const skipped = [];

  for (const id of sourceIds) {
    const plugin = SOURCES.get(id);
    if (!plugin) {
      skipped.push({ id, reason: `Unknown source "${id}"` });
      continue;
    }
    if (plugin.available === false) {
      skipped.push({ id, reason: `${id} is currently unavailable` });
      continue;
    }
    if (plugin.requiresKey) {
      const keyVal = config[_keyConfigProp(plugin.keyEnvVar)];
      if (!keyVal) {
        skipped.push({ id, reason: `${plugin.keyEnvVar} not set` });
        continue;
      }
    }
    available.push(id);
  }

  return { available, skipped };
}

/**
 * Get the config object key for an env var name.
 * e.g. "SCOPUS_API_KEY" → "scopusApiKey"
 * @param {string} envVar
 * @returns {string}
 */
function _keyConfigProp(envVar) {
  if (!envVar) return "";
  return envVar
    .toLowerCase()
    .replace(/_([a-z])/g, (_, c) => c.toUpperCase());
}

/**
 * Get a source plugin by ID. Throws if not found.
 * @param {string} id
 * @returns {Object}
 */
export function getSource(id) {
  const plugin = SOURCES.get(id);
  if (!plugin) throw new Error(`Unknown academic source: "${id}"`);
  return plugin;
}

/**
 * Get the API key value for a source plugin from config.
 * @param {Object} plugin
 * @param {Object} config
 * @returns {string|undefined}
 */
export function getKeyForSource(plugin, config) {
  if (!plugin.requiresKey || !plugin.keyEnvVar) return undefined;
  return config[_keyConfigProp(plugin.keyEnvVar)];
}
