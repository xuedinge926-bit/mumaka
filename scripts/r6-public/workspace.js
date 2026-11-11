const r6Profiles = dataset.records.filter((record) => record.trial_eligible);
const profilesById = new Map(r6Profiles.filter((record) => record.stable_genre_id).map((record) =>
  [`${record.stable_genre_id}|${record.evaluation_mode}`, record]));
const referenceTemplate = document.getElementById("mumaka-r6-reference-template");
const referenceViews = new WeakMap();
const studioTemplate = document.getElementById("mumaka-r6-studio-template");
const studioDrafts = new Map();
let soundStudio;

function activeCategory(root, label) {
  const active = root.querySelector(`[aria-label="${label}"] button[aria-pressed="true"]`);
  return Object.keys(categoryNames).find((category) => categoryNames[category] === active?.textContent.trim());
}

function otherCategory(category) {
  return category === "song" ? "instrumental" : "song";
}

function profileForId(id, category) {
  return profilesById.get(`${id}|${category}`) ?? profilesById.get(`${id}|${otherCategory(category)}`);
}

function profileForSearch(query, category) {
  const normalized = query.trim().normalize("NFKC").toLowerCase();
  if (!normalized) return undefined;
  const matches = r6Profiles.filter((record) =>
    [record.name_zh, record.name_en, record.catalog_name_zh, record.stable_genre_id, record.record_key]
      .some((name) => name?.normalize("NFKC").toLowerCase() === normalized));
  return matches.find((record) => record.evaluation_mode === category) ?? matches[0];
}

function syncStudioBody(view) {
  if (dialog.open) return;
  if (view.version === "sound") {
    attachTrial(view.content, view.state.trial, view.category);
  } else if (trialContent.parentElement !== dialog) {
    dialog.append(trialContent);
  }
}

function setStudioVersion(view, version) {
  view.version = version;
  view.root.dataset.mumakaR6View = version;
  for (const button of view.panel.querySelectorAll("[data-r6-view]")) {
    button.setAttribute("aria-pressed", String(button.dataset.r6View === version));
  }
  view.content.hidden = version === "legacy";
  view.panel.querySelector(".r6-studio-legacy").hidden = version !== "legacy";
  syncStudioBody(view);
}

function clearSoundStudio(root) {
  if (!soundStudio) return;
  if (!dialog.open && trialContent.parentElement === soundStudio.content) dialog.append(trialContent);
  soundStudio.panel.remove();
  soundStudio = undefined;
  delete root.dataset.mumakaR6View;
  trigger.setAttribute("aria-haspopup", "dialog");
  trigger.setAttribute("aria-controls", "mumaka-r6-dialog");
}

function syncSoundStudio(root) {
  const ratings = root.querySelector("#dual-ratings");
  const category = activeCategory(root, "作品类别");
  const tabs = root.querySelector('[role="tablist"][aria-label="评分草稿"]');
  if (!ratings || !category || !tabs) {
    clearSoundStudio(root);
    return;
  }

  const route = window.location.hash;
  const key = route.startsWith("#/studio/draft/") ? route : ratings;
  const needsMount = !soundStudio || soundStudio.key !== key || soundStudio.ratings !== ratings;
  if (needsMount) {
    clearSoundStudio(root);
    const state = studioDrafts.get(key) ?? { trial: newTrialContext(), genres: new Map() };
    studioDrafts.set(key, state);
    const panel = studioTemplate.content.firstElementChild.cloneNode(true);
    const content = panel.querySelector(".r6-studio-content");
    const view = { root, key, ratings, panel, content, category, state, version: "sound" };
    soundStudio = view;
    for (const button of panel.querySelectorAll("[data-r6-view]")) {
      button.addEventListener("click", () => setStudioVersion(view, button.dataset.r6View));
    }
    trigger.removeAttribute("aria-haspopup");
    trigger.setAttribute("aria-controls", "mumaka-r6-studio");
  }

  const view = soundStudio;
  if (view.panel.nextElementSibling !== ratings) ratings.before(view.panel);
  view.category = category;
  const caption = view.panel.querySelector(".r6-studio-category");
  const label = `R6 声音 · ${categoryNames[category]}`;
  if (caption.textContent !== label) caption.textContent = label;
  const genre = root.querySelector('#dual-genres select[aria-label="二级风格"]')?.value ?? "";
  if (view.state.genres.get(category) !== genre) {
    view.state.genres.set(category, genre);
    const record = profilesById.get(`${genre}|${category}`);
    view.state.trial.selectedStyles.set(category, record?.record_key ?? "");
  }
  if (needsMount) setStudioVersion(view, "sound");
  else syncStudioBody(view);
}

function focusSoundStudio(record) {
  const view = soundStudio;
  if (!view?.panel.isConnected || (record && record.evaluation_mode !== view.category)) return false;
  if (record) view.state.trial.selectedStyles.set(view.category, record.record_key);
  setStudioVersion(view, "sound");
  view.panel.focus({ preventScroll: true });
  view.panel.scrollIntoView({
    behavior: document.documentElement.dataset.reduceMotion === "true" ? "auto" : "smooth",
  });
  return true;
}

function clearReference(anchor) {
  referenceViews.get(anchor)?.element.remove();
  referenceViews.delete(anchor);
}

function previewTrialContext(context) {
  return {
    drafts: context.drafts,
    selectedStyles: new Map(context.selectedStyles),
    mode: context.mode,
    get needsModeReview() { return context.needsModeReview; },
    set needsModeReview(value) { context.needsModeReview = value; },
  };
}

function showReference(anchor, category, record, unavailable = false) {
  const previous = referenceViews.get(anchor);
  if (previous && previous.category === category && previous.record === record && previous.unavailable === unavailable) {
    if (previous.element.nextElementSibling !== anchor) anchor.before(previous.element);
    return;
  }
  clearReference(anchor);
  const element = referenceTemplate.content.firstElementChild.cloneNode(true);
  const status = element.querySelector(".r6-reference-status");
  const button = element.querySelector(".r6-reference-open");
  if (record) {
    const recordCategory = categoryNames[record.evaluation_mode];
    const sameCategory = record.evaluation_mode === category;
    status.textContent = `${record.name_zh} · ${recordCategory} · ${statusLabels[record.research_status]}`;
    if (!sameCategory) status.textContent += ` · 当前${categoryNames[category]}暂无 R6 配置`;
    button.textContent = sameCategory ? "用 R6 试算" : `查看${recordCategory}试算`;
    if (sameCategory) {
      const weights = element.querySelector(".r6-reference-weights");
      for (const { name, grade, weight } of profileRows(record)) {
        const item = document.createElement("li");
        const label = document.createElement("span");
        label.className = "r6-reference-dimension";
        label.textContent = name;
        const letter = document.createElement("strong");
        letter.textContent = grade;
        item.append(label, letter, ` ${weight}`);
        weights.append(item);
      }
      weights.hidden = false;
    }
  } else {
    status.textContent = unavailable
      ? `当前风格暂无 R6 ${categoryNames[category]}配置。可选择已收录的研究风格，或切换旧版评分。`
      : "在新版声音里选择已收录的 R6 研究风格。";
    button.textContent = "选 R6 风格";
  }
  const inStudio = Boolean(anchor.closest("#dual-genres"));
  if (inStudio && (!record || record.evaluation_mode === category)) {
    button.removeAttribute("aria-haspopup");
    button.setAttribute("aria-controls", "mumaka-r6-studio");
  }
  button.addEventListener("click", () => {
    if (inStudio && focusSoundStudio(record)) return;
    // A preview belongs to this work, while leaving its selected styles intact.
    const context = inStudio && soundStudio ? previewTrialContext(soundStudio.state.trial) : standaloneTrial;
    openTrial(button, record, record?.evaluation_mode ?? category, context);
  });
  anchor.before(element);
  referenceViews.set(anchor, { element, category, record, unavailable });
}

function syncStudioReference(root) {
  const weights = root.querySelector('#dual-genres [aria-label="当前六维权重"]');
  if (!weights) return;
  const category = activeCategory(root, "作品类别");
  if (!category || !root.querySelector('[role="tablist"][aria-label="评分草稿"]')) {
    clearReference(weights);
    return;
  }
  const style = root.querySelector('#dual-genres select[aria-label="二级风格"]');
  const search = root.querySelector('#dual-genres input[aria-label="检索双体系风格"]');
  const record = profileForSearch(search?.value ?? "", category) ?? profileForId(style?.value, category);
  showReference(weights, category, record, !record && Boolean(style?.value));
}

function syncCatalogReferences(root) {
  const category = activeCategory(root, "风格体系");
  const results = root.querySelector(".dual-records");
  if (!category || !results) return;
  const listedIds = new Set();
  for (const article of results.querySelectorAll(":scope > article")) {
    const metadata = article.querySelector(":scope > div > p");
    const anchor = article.querySelector(":scope > div > details");
    if (!metadata || !anchor) continue;
    const id = metadata.textContent.split("·", 1)[0].trim();
    listedIds.add(id);
    const record = profileForId(id, category);
    if (record) showReference(anchor, category, record);
  }
  const search = root.querySelector('input[aria-label="搜索565风格"]');
  const record = profileForSearch(search?.value ?? "", category);
  if (record && !listedIds.has(record.stable_genre_id)) showReference(results, category, record);
  else clearReference(results);
}

document.addEventListener("DOMContentLoaded", () => {
  const root = document.getElementById("root");
  let scheduled = false;
  const scheduleSync = () => {
    if (scheduled) return;
    scheduled = true;
    requestAnimationFrame(() => {
      scheduled = false;
      syncSoundStudio(root);
      syncStudioReference(root);
      syncCatalogReferences(root);
    });
  };
  // The standalone React bundle owns the legacy scoring fields and saved data.
  // The R6 view observes album identity, mode and style without importing scores.
  const observer = new MutationObserver(scheduleSync);
  observer.observe(root, { subtree: true, childList: true, attributes: true, attributeFilter: ["aria-pressed"] });
  root.addEventListener("change", (event) => {
    if (event.target.matches('select[aria-label="二级风格"]')) scheduleSync();
  });
  root.addEventListener("input", (event) => {
    if (event.target.matches('input[aria-label="检索双体系风格"], input[aria-label="搜索565风格"]')) scheduleSync();
  });
  root.addEventListener("click", (event) => {
    if (soundStudio?.version === "sound" && event.target.closest('a[href="#dual-ratings"]')) {
      event.preventDefault();
      event.stopPropagation();
      focusSoundStudio();
    }
  }, true);
  dialog.addEventListener("close", scheduleSync);
  window.addEventListener("hashchange", scheduleSync);
  scheduleSync();
}, { once: true });
