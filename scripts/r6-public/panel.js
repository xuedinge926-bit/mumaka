const dataset = JSON.parse(document.getElementById("mumaka-r6-data").textContent);
const trigger = document.getElementById("mumaka-r6-open");
const dialog = document.getElementById("mumaka-r6-dialog");
const trialContent = document.getElementById("mumaka-r6-content");
const styles = trialContent.querySelector("#mumaka-r6-style");
const message = trialContent.querySelector("#mumaka-r6-message");
const trial = trialContent.querySelector("#mumaka-r6-trial");
const configured = trialContent.querySelector("#mumaka-r6-configured");
const dimensions = trialContent.querySelector("#mumaka-r6-dimensions");
const score = trialContent.querySelector("#mumaka-r6-score");
const progress = trialContent.querySelector("#mumaka-r6-progress");
const modeReview = trialContent.querySelector("#mumaka-r6-mode-review");
const modeStatus = trialContent.querySelector("#mumaka-r6-mode-status");
const evidenceStatus = trialContent.querySelector("#mumaka-r6-evidence-status");
const method = dataset.method;
trialContent.querySelector("#mumaka-r6-coefficients").textContent = Object.entries(dataset.coefficient_by_grade)
  .map(([grade, coefficient]) => `${grade} ${coefficient}`).join(" · ");

const dimensionNames = Object.fromEntries(Object.entries(method.dimensions).map(([axis, [name]]) => [axis, name]));
const categoryNames = { song: "歌曲", instrumental: "乐曲" };
const statusLabels = {
  trial: "试算候选",
  core_review: "核心复核",
  revised_pending_approval: "已修订 · 待批准",
  inactive_historical_index: "历史索引",
  provisional_core_review: "暂定 · 核心复核",
  provisional: "暂定候选",
};
function newTrialContext() {
  return { drafts: new Map(), selectedStyles: new Map(), mode: "song", needsModeReview: false };
}

const standaloneTrial = newTrialContext();
let trialContext = standaloneTrial;
let mode = standaloneTrial.mode;
let dialogOpener = trigger;
let activeTrial;

function profileRows(record) {
  const weights = [...record.weights_pct.display_2_d1_d4, "15.00", "15.00"];
  return dataset.dimension_order[record.evaluation_mode].map((dimension, index) => ({
    name: dimensionNames[dimension],
    grade: record.grades_d1_d4[index] ?? "固定",
    weight: `${weights[index]}%`,
  }));
}

function attachTrial(host, context, category) {
  const moved = trialContent.parentElement !== host;
  if (!moved && trialContext === context && mode === category &&
      styles.value === (context.selectedStyles.get(category) ?? "")) return;
  if (moved) host.append(trialContent);
  trialContext = context;
  mode = category;
  trialContext.mode = category;
  modeReview.checked = context.needsModeReview;
  modeStatus.hidden = !context.needsModeReview;
  trialContent.querySelector(`input[name="mumaka-r6-mode"][value="${mode}"]`).checked = true;
  renderMode();
}

function openTrial(opener, record, category, context = standaloneTrial) {
  const evaluationMode = category ?? record?.evaluation_mode ?? context.mode;
  if (record) context.selectedStyles.set(evaluationMode, record.record_key);
  attachTrial(dialog, context, evaluationMode);
  dialogOpener = opener;
  dialog.showModal();
}

function updateScore(record, draft) {
  const axes = dataset.dimension_order[record.evaluation_mode];
  const quality = Object.fromEntries(axes.map((axis, index) => [axis, draft.ticks[index]]));
  const result = evaluateR6(record, axes, quality, {
    needs_mode_review: modeReview.checked,
    evidence: draft.evidence,
  });
  const rated = draft.ticks.filter((tick) => tick !== 0).length;
  score.textContent = result.total ?? "—";
  if (result.status === "needs_mode_review") progress.textContent = "模式待复核";
  else if (result.status === "needs_evidence_review") progress.textContent = "证据待复核";
  else progress.textContent = result.total === null ? `已选 ${rated}/6 维` : "六维已评分";

  if (result.sound_evidence.duplicate) {
    evidenceStatus.textContent = "发现重复的艺术命题。请分别说明实际唱奏、录音空间和最终声音关系。";
  } else if (result.sound_evidence.complete) {
    evidenceStatus.textContent = "两类声音证据已填写，内容仍需人工复核。工艺留空按未知处理。";
  } else {
    const missing = result.sound_evidence.missing.map((key) => method.evidence_fields[key]).join("、");
    evidenceStatus.textContent = `声音证据尚缺 ${missing}。仍可研究试算。`;
  }
}

function appendText(parent, tag, text) {
  const node = document.createElement(tag);
  node.textContent = text;
  parent.append(node);
}

function renderMethod() {
  const content = trialContent.querySelector("#mumaka-r6-method");
  content.replaceChildren();
  appendText(content, "h3", `${categoryNames[mode]}的六维定义`);
  for (const axis of dataset.dimension_order[mode]) {
    const [name, english, definition] = method.dimensions[axis];
    appendText(content, "p", `${name} ${english} · ${definition}`);
  }
  appendText(content, "h3", "风格重要性");
  for (const [grade, definition] of Object.entries(method.grade_criteria)) {
    appendText(content, "p", `${grade} · ${definition}`);
  }
  appendText(content, "h3", "整碟艺术质量");
  for (const [tick, criterion] of Object.entries(method.star_criteria)) {
    appendText(content, "p", `${(Number(tick) / 2).toFixed(1)} 星 · ${criterion}`);
  }
  appendText(content, "h3", "Sound-R2 取证与判断");
  appendText(content, "p", method.sound_entries.join("、"));
  appendText(content, "p", method.sound_questions.join("、"));
  appendText(content, "p", method.evidence_boundary);
  appendText(content, "p", method.rap_and_sampling);
  appendText(content, "p", method.mode_review);
}

function renderLedger(record) {
  const content = trialContent.querySelector("#mumaka-r6-ledger");
  const notes = record.evidence_notes;
  content.replaceChildren();
  appendText(content, "p", notes.scope);
  for (const text of Object.values(notes.dimension_responsibility)) appendText(content, "p", text);
  appendText(content, "p", `文献个案或复听候选 · ${notes.cases}`);
  appendText(content, "p", `分类与反例 · ${notes.boundary}`);
  appendText(content, "p", `待复核 · ${notes.open_question}`);
  for (const proposal of dataset.research_proposals.filter((item) => item.record_key === record.record_key)) {
    const grades = proposal.proposed_grades_d1_d4?.join("/") ?? "无完整向量";
    appendText(content, "p", `研究对照 · ${grades} · ${proposal.status} · ${proposal.reason_zh}`);
  }
  for (const key of notes.source_ids) {
    const source = dataset.evidence_sources[key];
    const link = document.createElement("a");
    link.href = source.url;
    link.target = "_blank";
    link.rel = "noopener noreferrer";
    link.textContent = source.title;
    content.append(link);
    for (const field of ["access", "object", "supports", "limit"]) appendText(content, "p", source[field]);
  }
  appendText(content, "p", "本轮未完成整碟听评，文献提供艺术机制证据，现行字母仍为未批准的研究判断。");
}

function renderEvidence(record, draft) {
  const content = trialContent.querySelector("#mumaka-r6-evidence");
  content.replaceChildren();
  for (const [key, title] of Object.entries(method.evidence_fields)) {
    const group = document.createElement("fieldset");
    group.className = "r6-evidence-field";
    appendText(group, "legend", title);
    const note = draft.evidence[key] ??= { locator: "", claim: "", process: "" };
    const fields = [["locator", "曲目／版本／位置", "input"], ["claim", "可听命题", "textarea"]];
    if (key !== "performance") fields.push(["process", "具体工艺与可核实依据", "input"]);
    for (const [field, label, tag] of fields) {
      const control = document.createElement(tag);
      control.setAttribute("aria-label", `${title} · ${label}`);
      if (field === "process") control.placeholder = "未知";
      control.value = note[field];
      control.addEventListener("input", () => {
        note[field] = control.value;
        updateScore(record, draft);
      });
      const wrapper = document.createElement("label");
      wrapper.append(label, control);
      group.append(wrapper);
    }
    content.append(group);
  }
}

function dimensionRow(label, letter = "—", percentage = "—", stars = "—") {
  const row = document.createElement("tr");
  const name = document.createElement("th");
  name.scope = "row";
  name.textContent = label;
  const grade = document.createElement("td");
  grade.className = "r6-grade";
  grade.textContent = letter;
  const weight = document.createElement("td");
  weight.className = "r6-weight";
  weight.textContent = percentage;
  const input = document.createElement("td");
  input.append(stars);
  row.append(name, grade, weight, input);
  return row;
}

function renderStyle() {
  const record = dataset.records.find((entry) => entry.record_key === styles.value && entry.evaluation_mode === mode);
  activeTrial = undefined;
  const inStudio = trialContent.parentElement !== dialog;
  trial.hidden = !inStudio && !record?.trial_eligible;
  configured.hidden = !record?.trial_eligible;
  dimensions.replaceChildren();
  if (!record?.trial_eligible) {
    message.textContent = record
      ? `${record.name_zh}仅作历史索引，暂无试算配置。`
      : "选择已收录的 R6 风格后可填写星级并试算。";
    if (inStudio) {
      for (const axis of dataset.dimension_order[mode]) dimensions.append(dimensionRow(dimensionNames[axis]));
    }
    return;
  }

  const status = [
    statusLabels[record.research_status],
    `优先级置信度 ${record.priority_confidence}`,
    `证据强度 ${record.evidence_strength}`,
  ];
  if (record.id_resolution_status !== "matched") status.push("正式风格 ID 待核对");
  message.textContent = status.join(" · ");

  const draft = trialContext.drafts.get(record.record_key) ?? { ticks: [0, 0, 0, 0, 0, 0], evidence: {} };
  trialContext.drafts.set(record.record_key, draft);
  const rows = profileRows(record);
  rows.forEach(({ name: label, grade: letter, weight: percentage }, index) => {
    const stars = document.createElement("select");
    stars.setAttribute("aria-label", `${label}星级`);
    stars.add(new Option("选星级", "0"));
    for (let tick = 1; tick <= 10; tick += 1) {
      stars.add(new Option(`${tick / 2} 星`, String(tick)));
    }
    stars.value = String(draft.ticks[index]);
    stars.addEventListener("change", () => {
      draft.ticks[index] = Number(stars.value);
      updateScore(record, draft);
    });
    dimensions.append(dimensionRow(label, letter, percentage, stars));
  });

  trialContent.querySelector("#mumaka-r6-basis").textContent = record.basis;
  const exactWeights = rows.map(({ name }, index) => `${name} ${record.weights_pct.exact[index]}%`);
  trialContent.querySelector("#mumaka-r6-key").textContent = `${record.record_key} · ${exactWeights.join(" · ")}`;
  renderLedger(record);
  renderEvidence(record, draft);
  activeTrial = { record, draft };
  updateScore(record, draft);
}

function renderMode() {
  renderMethod();
  styles.replaceChildren(new Option("请选择风格", ""));
  dataset.records.filter((record) => record.evaluation_mode === mode).forEach((record) => {
    const suffix = record.trial_eligible ? "" : " · 历史索引";
    styles.add(new Option(`${record.name_zh} · ${record.name_en}${suffix}`, record.record_key));
  });
  styles.value = trialContext.selectedStyles.get(mode) ?? "";
  renderStyle();
}

trialContent.querySelectorAll('input[name="mumaka-r6-mode"]').forEach((control) => {
  control.addEventListener("change", () => {
    if (!control.checked) return;
    mode = control.value;
    trialContext.mode = mode;
    renderMode();
  });
});
styles.addEventListener("change", () => {
  trialContext.selectedStyles.set(mode, styles.value);
  renderStyle();
});
modeReview.addEventListener("change", () => {
  trialContext.needsModeReview = modeReview.checked;
  modeStatus.hidden = !modeReview.checked;
  if (activeTrial) updateScore(activeTrial.record, activeTrial.draft);
});
trigger.addEventListener("click", () => {
  if (!focusSoundStudio()) openTrial(trigger);
});
dialog.querySelector("#mumaka-r6-close").addEventListener("click", () => dialog.close());
dialog.addEventListener("close", () => (dialogOpener.isConnected ? dialogOpener : trigger).focus());
renderMode();
