import assert from "node:assert/strict";
import { lookupJournalRank } from "../src/academic/journal-rank.ts";
import { compareTexts, deduplicateList } from "../src/academic/text-similarity.ts";
import { lookupMedicalAbbreviation, expandMedicalText } from "../src/medical/terms.ts";
import { convertTable } from "../src/utils/table-converter.ts";

console.log("=== 1. Test Journal Rank ===");
const lancet = lookupJournalRank("The Lancet", 2);
console.log("Lancet Rank:", lancet);
const issnLookup = lookupJournalRank("0028-0836", 1);
console.log("ISSN Lookup (0028-0836 -> NEJM):", issnLookup);

console.log("\n=== 2. Test Text Similarity & Deduplication ===");
const sim = compareTexts(
  "Deep learning for automatic detection of diabetic retinopathy",
  "Deep Learning for Automated Detection of Diabetic Retinopathy in Retinal Images"
);
console.log("Similarity Result:", sim);

const dupList = deduplicateList([
  { title: "Deep Learning for Diabetic Retinopathy Detection" },
  { title: "Deep learning for diabetic retinopathy detection" },
  { title: "Machine Learning in Cardiology" },
  { title: "Machine Learning in Cardiology: A Systematic Review" }
], (x) => x.title, 0.80);
console.log("Deduplicated List:", dupList);

console.log("\n=== 3. Test Medical Terms Lookup & Expand ===");
const tha = lookupMedicalAbbreviation("THA");
console.log("THA Lookup:", tha);
const expanded = expandMedicalText("Bệnh nhân có tiền sử THA, ĐTĐ type 2 và COPD nhập viện vì NMCT cấp. Đánh giá sCr và eGFR.");
console.log("Expanded Text:\n", expanded.expanded_text);
console.log("Found Abbreviations:", expanded.detected_terms);

console.log("\n=== 4. Test Table Converter ===");
const sampleCsv = `Study,Sample Size,Effect Size,P-Value\nSmith et al. (2023),150,0.45,0.012\nNguyen et al. (2024),320,0.62,<0.001`;
const mdTable = convertTable(sampleCsv, "markdown");
console.log("Markdown Table:\n" + mdTable);
const latexTable = convertTable(sampleCsv, "latex", "Comparison of Clinical Trials");
console.log("\nLaTeX Table:\n" + latexTable);
const jsonTable = convertTable(mdTable, "json");
console.log("\nJSON Output:\n" + jsonTable);

assert.ok(lancet);
assert.ok(issnLookup);
assert.ok(tha);
assert.ok(expanded.detected_terms.length > 0);
assert.equal(JSON.parse(jsonTable).length, 2);
console.log("\nZero-token assertions passed");
