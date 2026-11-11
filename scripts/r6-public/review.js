const soundEvidenceKeys = ["recording_space", "final_sound_relationship"];
const evidenceKeys = ["performance", ...soundEvidenceKeys];

function auditSoundEvidence(evidence) {
  const missing = soundEvidenceKeys.filter((key) => !evidence[key]?.locator?.trim() || !evidence[key]?.claim?.trim());
  const claims = evidenceKeys.map((key) =>
    (evidence[key]?.claim ?? "").normalize("NFKC").toLowerCase().replace(/[\p{P}\s]/gu, "")
  ).filter(Boolean);
  const duplicate = new Set(claims).size !== claims.length;
  const technical_process = Object.fromEntries(soundEvidenceKeys.map((key) =>
    [key, evidence[key]?.process?.trim() || "未知"]));
  return { missing, duplicate, complete: missing.length === 0 && !duplicate, technical_process };
}

function evaluateR6(record, axes, quality, review) {
  const result = {
    scope: "research_only",
    production_eligible: false,
    total: null,
    sound_evidence: auditSoundEvidence(review.evidence),
  };
  if (record.approval_status !== "unapproved" || !record.trial_eligible) {
    return { ...result, status: "no_configuration" };
  }
  if (review.needs_mode_review || record.needs_mode_review) {
    return { ...result, status: "needs_mode_review" };
  }
  if (Object.keys(quality).length !== axes.length || axes.some((axis) => !Object.hasOwn(quality, axis))) {
    return { ...result, status: "invalid_quality_dimensions" };
  }
  if (result.sound_evidence.duplicate) return { ...result, status: "needs_evidence_review" };
  const total = scoreR6(record.weights_pct.exact, axes.map((axis) => quality[axis]));
  return { ...result, total, status: total === null ? "incomplete" : "research_trial" };
}
