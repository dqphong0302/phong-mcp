/**
 * Zero-Token Medical Term & Clinical Abbreviation Expander
 * Comprehensive Vietnamese & English Clinical Abbreviation Lookup.
 */

import type { Raw } from "../academic/types.ts";
export const MEDICAL_ABBREVIATIONS: Record<string, Raw> = {
  // Tim mạch & Huyết áp
  "THA": { vn: "Tăng huyết áp", en: "Hypertension (HTN)", category: "Cardiology" },
  "HTN": { vn: "Tăng huyết áp", en: "Hypertension", category: "Cardiology" },
  "NMCT": { vn: "Nhồi máu cơ tim", en: "Myocardial Infarction (MI)", category: "Cardiology" },
  "MI": { vn: "Nhồi máu cơ tim", en: "Myocardial Infarction", category: "Cardiology" },
  "ST": { vn: "Suy tim", en: "Heart Failure (HF)", category: "Cardiology" },
  "HF": { vn: "Suy tim", en: "Heart Failure", category: "Cardiology" },
  "HFrEF": { vn: "Suy tim phân suất tống máu giảm", en: "Heart Failure with Reduced Ejection Fraction", category: "Cardiology" },
  "HFpEF": { vn: "Suy tim phân suất tống máu bảo tồn", en: "Heart Failure with Preserved Ejection Fraction", category: "Cardiology" },
  "RHF": { vn: "Suy tim phải", en: "Right Heart Failure", category: "Cardiology" },
  "LHF": { vn: "Suy tim trái", en: "Left Heart Failure", category: "Cardiology" },
  "EF": { vn: "Phân suất tống máu", en: "Ejection Fraction", category: "Cardiology" },
  "LVEF": { vn: "Phân suất tống máu thất trái", en: "Left Ventricular Ejection Fraction", category: "Cardiology" },
  "Rung nhĩ": { vn: "Rung nhĩ", en: "Atrial Fibrillation (AFib)", category: "Cardiology" },
  "AF": { vn: "Rung nhĩ", en: "Atrial Fibrillation", category: "Cardiology" },
  "CAD": { vn: "Bệnh động mạch vành", en: "Coronary Artery Disease", category: "Cardiology" },
  "PCI": { vn: "Can thiệp mạch vành qua da", en: "Percutaneous Coronary Intervention", category: "Cardiology" },
  "CABG": { vn: "Phẫu thuật bắc cầu động mạch vành", en: "Coronary Artery Bypass Grafting", category: "Cardiology" },

  // Nội tiết & Chuyển hóa
  "DTD": { vn: "Đái tháo đường", en: "Diabetes Mellitus (DM)", category: "Endocrinology" },
  "ĐTĐ": { vn: "Đái tháo đường", en: "Diabetes Mellitus (DM)", category: "Endocrinology" },
  "DM": { vn: "Đái tháo đường", en: "Diabetes Mellitus", category: "Endocrinology" },
  "T2D": { vn: "Đái tháo đường tuýp 2", en: "Type 2 Diabetes", category: "Endocrinology" },
  "T2DM": { vn: "Đái tháo đường tuýp 2", en: "Type 2 Diabetes Mellitus", category: "Endocrinology" },
  "T1D": { vn: "Đái tháo đường tuýp 1", en: "Type 1 Diabetes", category: "Endocrinology" },
  "HbA1c": { vn: "Hemoglobin glycated (đường huyết trung bình 3 tháng)", en: "Glycated Hemoglobin", category: "Endocrinology" },
  "RLTD": { vn: "Rối loạn lipid máu", en: "Dyslipidemia", category: "Endocrinology" },
  "DKA": { vn: "Nhiễm toan ceton do đái tháo đường", en: "Diabetic Ketoacidosis", category: "Endocrinology" },

  // Hô hấp & Hồi sức cấp cứu
  "COPD": { vn: "Bệnh phổi tắc nghẽn mạn tính", en: "Chronic Obstructive Pulmonary Disease", category: "Pulmonology" },
  "ARDS": { vn: "Hội chứng suy hô hấp cấp tiến triển", en: "Acute Respiratory Distress Syndrome", category: "Critical Care" },
  "SHH": { vn: "Suy hô hấp", en: "Respiratory Failure", category: "Pulmonology" },
  "VP": { vn: "Viêm phổi", en: "Pneumonia", category: "Pulmonology" },
  "VAP": { vn: "Viêm phổi thở máy", en: "Ventilator-Associated Pneumonia", category: "Critical Care" },
  "HAP": { vn: "Viêm phổi bệnh viện", en: "Hospital-Acquired Pneumonia", category: "Pulmonology" },
  "CAP": { vn: "Viêm phổi cộng đồng", en: "Community-Acquired Pneumonia", category: "Pulmonology" },
  "ICU": { vn: "Khoa Hồi sức tích cực", en: "Intensive Care Unit", category: "Critical Care" },
  "NKH": { vn: "Nhiễm khuẩn huyết", en: "Sepsis", category: "Infectious Diseases" },

  // Thận & Tiết niệu
  "sCr": { vn: "Creatinine huyết thanh", en: "Serum Creatinine", category: "Nephrology" },
  "eGFR": { vn: "Độ lọc cầu thận ước tính", en: "Estimated Glomerular Filtration Rate", category: "Nephrology" },
  "CKD": { vn: "Bệnh thận mạn", en: "Chronic Kidney Disease", category: "Nephrology" },
  "BTM": { vn: "Bệnh thận mạn", en: "Chronic Kidney Disease", category: "Nephrology" },
  "AKI": { vn: "Tổn thương thận cấp", en: "Acute Kidney Injury", category: "Nephrology" },
  "ESRD": { vn: "Bệnh thận giai đoạn cuối", en: "End-Stage Renal Disease", category: "Nephrology" },
  "HD": { vn: "Thận nhân tạo / Chạy thận chu kỳ", en: "Hemodialysis", category: "Nephrology" },

  // Thần kinh & Đột quỵ
  "ĐQ": { vn: "Đột quỵ não", en: "Stroke", category: "Neurology" },
  "TBMMN": { vn: "Tai biến mạch máu não", en: "Cerebrovascular Accident (Stroke)", category: "Neurology" },
  "CVA": { vn: "Tai biến mạch máu não", en: "Cerebrovascular Accident", category: "Neurology" },
  "TIA": { vn: "Cơn thiếu máu não thoáng qua", en: "Transient Ischemic Attack", category: "Neurology" },
  "XHN": { vn: "Xuất huyết não", en: "Intracerebral Hemorrhage (ICH)", category: "Neurology" },
  "ICH": { vn: "Xuất huyết não", en: "Intracerebral Hemorrhage", category: "Neurology" },
  "GCS": { vn: "Thang điểm hôn mê Glasgow", en: "Glasgow Coma Scale", category: "Neurology" },
  "NIHSS": { vn: "Thang điểm đột quỵ NIH", en: "National Institutes of Health Stroke Scale", category: "Neurology" },

  // Tiêu hóa & Gan mật
  "XG": { vn: "Xơ gan", en: "Cirrhosis", category: "Gastroenterology" },
  "VGB": { vn: "Viêm gan B", en: "Hepatitis B", category: "Gastroenterology" },
  "VGC": { vn: "Viêm gan C", en: "Hepatitis C", category: "Gastroenterology" },
  "HCC": { vn: "Ung thư biểu mô tế bào gan", en: "Hepatocellular Carcinoma", category: "Oncology" },
  "XHTH": { vn: "Xuất huyết tiêu hóa", en: "Gastrointestinal Bleeding", category: "Gastroenterology" },
  "GI": { vn: "Đường tiêu hóa", en: "Gastrointestinal", category: "Gastroenterology" },

  // Chẩn đoán hình ảnh & Xét nghiệm
  "CT": { vn: "Chụp cắt lớp vi tính", en: "Computed Tomography", category: "Radiology" },
  "MRI": { vn: "Chụp cộng hưởng từ", en: "Magnetic Resonance Imaging", category: "Radiology" },
  "XQ": { vn: "Chụp X-quang", en: "X-Ray / Radiography", category: "Radiology" },
  "SA": { vn: "Siêu âm", en: "Ultrasound", category: "Radiology" },
  "ECG": { vn: "Điện tâm đồ", en: "Electrocardiogram (EKG)", category: "Cardiology" },
  "EKG": { vn: "Điện tâm đồ", en: "Electrocardiogram", category: "Cardiology" },
  "CBC": { vn: "Tổng phân tích tế bào máu ngoại vi", en: "Complete Blood Count", category: "Hematology" },
  "CRP": { vn: "Protein phản ứng C (chỉ số viêm)", en: "C-Reactive Protein", category: "Immunology" },
  "PCT": { vn: "Procalcitonin (chỉ số nhiễm khuẩn)", en: "Procalcitonin", category: "Infectious Diseases" },
};

export function lookupMedicalAbbreviation(term: Raw) {
  const clean = String(term || "").trim().toUpperCase();
  if (MEDICAL_ABBREVIATIONS[clean]) {
    return { term: clean, found: true, ...MEDICAL_ABBREVIATIONS[clean] };
  }

  // Case-insensitive search
  for (const [k, v] of Object.entries(MEDICAL_ABBREVIATIONS)) {
    if (k.toLowerCase() === term.toLowerCase() || v.vn.toLowerCase().includes(term.toLowerCase()) || v.en.toLowerCase().includes(term.toLowerCase())) {
      return { term: k, found: true, ...v };
    }
  }

  return { term, found: false, message: "Term not found in standard dictionary" };
}

export function expandMedicalText(text: Raw) {
  const original = String(text || "");
  const foundTerms: Raw = [];
  const foundSet = new Set();

  // Sort keys by length descending so longer acronyms match first (e.g. NSTEMI before STEMI before MI)
  const keys = Object.keys(MEDICAL_ABBREVIATIONS).sort((a, b) => b.length - a.length);
  const pattern = new RegExp(`\\b(${keys.map(k => k.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|')})\\b`, 'g');

  const expanded = original.replace(pattern, (match) => {
    const v = MEDICAL_ABBREVIATIONS[match];
    if (v) {
      if (!foundSet.has(match)) {
        foundSet.add(match);
        foundTerms.push({ abbreviation: match, meaning_vn: v.vn, meaning_en: v.en, category: v.category });
      }
      return `${match} [${v.vn} / ${v.en}]`;
    }
    return match;
  });

  return {
    original_text: original,
    expanded_text: expanded,
    detected_abbreviations_count: foundTerms.length,
    detected_terms: foundTerms,
  };
}
