"use strict";

const DRAFT_URL = "./data/default-report.json";
const DEBOUNCE_MS = 400;

const SIGNPOST_OPTIONS = [
  { value: "SP1", label: "SP1 · ราคาคาร์บอน" },
  { value: "SP2", label: "SP2 · เทคโนโลยี / พลังงาน" },
  { value: "SP3", label: "SP3 · กฎระเบียบ" }
];

let currentData = null;
let previewTimer = null;

/* ---------------------------------------------------------
   Utilities
--------------------------------------------------------- */

function deepClone(value) {
  return JSON.parse(JSON.stringify(value));
}

function getDeep(object, path) {
  return path.reduce((acc, key) => {
    return acc == null ? acc : acc[key];
  }, object);
}

function setDeep(object, path, value) {
  let target = object;

  for (let i = 0; i < path.length - 1; i += 1) {
    const key = path[i];

    if (typeof target[key] !== "object" || target[key] === null) {
      target[key] = {};
    }

    target = target[key];
  }

  target[path[path.length - 1]] = value;
}

function debounce(fn, wait) {
  return (...args) => {
    clearTimeout(previewTimer);
    previewTimer = setTimeout(() => fn(...args), wait);
  };
}

function todayIso() {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");

  return `${year}-${month}-${day}`;
}

function downloadJson(filename, dataObject) {
  const jsonText = JSON.stringify(dataObject, null, 2);

  const blob = new Blob([jsonText], {
    type: "application/json"
  });

  const url = URL.createObjectURL(blob);

  const link = document.createElement("a");

  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);

  URL.revokeObjectURL(url);
}

/* ---------------------------------------------------------
   DOM element builders (ป้องกัน HTML injection ด้วย DOM API)
--------------------------------------------------------- */

function createLabeledInput(config) {
  const label = document.createElement("label");
  label.textContent = config.label;

  const input = document.createElement("input");
  input.type = config.type || "text";
  input.name = config.name;
  input.value = config.value ?? "";

  if (config.min !== undefined) {
    input.min = config.min;
  }

  if (config.max !== undefined) {
    input.max = config.max;
  }

  if (config.placeholder) {
    input.placeholder = config.placeholder;
  }

  if (config.dataset) {
    Object.entries(config.dataset).forEach(([key, value]) => {
      input.dataset[key] = value;
    });
  }

  label.appendChild(input);

  return { label, input };
}

function createLabeledTextarea(config) {
  const label = document.createElement("label");
  label.textContent = config.label;

  const textarea = document.createElement("textarea");
  textarea.name = config.name;
  textarea.rows = config.rows || 3;
  textarea.value = config.value ?? "";

  if (config.dataset) {
    Object.entries(config.dataset).forEach(([key, value]) => {
      textarea.dataset[key] = value;
    });
  }

  label.appendChild(textarea);

  return { label, textarea };
}

function createLabeledSelect(config) {
  const label = document.createElement("label");
  label.textContent = config.label;

  const select = document.createElement("select");
  select.name = config.name;

  if (config.dataset) {
    Object.entries(config.dataset).forEach(([key, value]) => {
      select.dataset[key] = value;
    });
  }

  config.options.forEach((option) => {
    const optionElement = document.createElement("option");
    optionElement.value = option.value;
    optionElement.textContent = option.label;

    if (option.value === config.value) {
      optionElement.selected = true;
    }

    select.appendChild(optionElement);
  });

  label.appendChild(select);

  return { label, select };
}

/* ---------------------------------------------------------
   Top-level report fields (reportMonth, subtitle, ฯลฯ)
--------------------------------------------------------- */

const TOP_LEVEL_FIELD_MAP = [
  { name: "reportMonth", path: ["reportMonth"] },
  { name: "subtitle", path: ["subtitle"] },
  { name: "executiveSummary", path: ["executiveSummary"] },
  {
    name: "statKeyStories",
    path: ["statistics", "keyStories"],
    number: true
  },
  {
    name: "statSignposts",
    path: ["statistics", "signposts"],
    number: true
  },
  {
    name: "statSignalsReviewed",
    path: ["statistics", "signalsReviewed"],
    number: true
  }
];

function populateTopLevelFields(form, data) {
  TOP_LEVEL_FIELD_MAP.forEach((field) => {
    const element = form.elements.namedItem(field.name);

    if (!element) {
      return;
    }

    const value = getDeep(data, field.path);
    element.value = value ?? (field.number ? 0 : "");
  });
}

function bindTopLevelFields(form) {
  TOP_LEVEL_FIELD_MAP.forEach((field) => {
    const element = form.elements.namedItem(field.name);

    if (!element) {
      return;
    }

    element.addEventListener("input", () => {
      const rawValue = element.value;
      const value = field.number ? Number(rawValue) || 0 : rawValue;

      setDeep(currentData, field.path, value);
      scheduleUpdatePreview();
    });
  });
}

/* ---------------------------------------------------------
   News item editors
--------------------------------------------------------- */

function buildNewsItemEditor(item, index) {
  const wrapper = document.createElement("div");
  wrapper.className = "news-item-editor";
  wrapper.dataset.index = String(index);
  wrapper.dataset.signpost = (item.signpost || "SP2").toUpperCase();

  const head = document.createElement("div");
  head.className = "news-item-head";

  const badge = document.createElement("span");
  badge.className = "news-item-badge";
  badge.textContent = String(item.index ?? index + 1);

  const title = document.createElement("strong");
  title.textContent = `ข่าวที่ ${item.index ?? index + 1}`;

  head.appendChild(badge);
  head.appendChild(title);
  wrapper.appendChild(head);

  const row1 = document.createElement("div");
  row1.className = "news-item-row-3";

  const categoryField = createLabeledInput({
    label: "หมวดข่าว",
    name: "category",
    value: item.category,
    dataset: { field: "category" }
  });

  const signpostField = createLabeledSelect({
    label: "Signpost",
    name: "signpost",
    value: (item.signpost || "SP2").toUpperCase(),
    options: SIGNPOST_OPTIONS,
    dataset: { field: "signpost" }
  });

  const dateField = createLabeledInput({
    label: "วันที่ข่าว",
    name: "date",
    value: item.date,
    placeholder: "เช่น 19 Aug 2026",
    dataset: { field: "date" }
  });

  row1.appendChild(categoryField.label);
  row1.appendChild(signpostField.label);
  row1.appendChild(dateField.label);
  wrapper.appendChild(row1);

  const titleField = createLabeledInput({
    label: "หัวข้อข่าว",
    name: "title",
    value: item.title,
    dataset: { field: "title" }
  });
  wrapper.appendChild(titleField.label);

  const imageField = createLabeledInput({
    label: "พาธรูปภาพ (เช่น ./assets/images/news-01.png)",
    name: "image",
    value: item.image,
    dataset: { field: "image" }
  });

  const imagePreview = document.createElement("img");
  imagePreview.className = "news-item-image-preview";
  imagePreview.src = item.image || "";
  imagePreview.alt = "ตัวอย่างรูปข่าว";
  imagePreview.loading = "lazy";
  imagePreview.dataset.role = "image-preview";

  imageField.label.appendChild(imagePreview);
  wrapper.appendChild(imageField.label);

  const summaryField = createLabeledTextarea({
    label: "สรุปข่าวแบบย่อ",
    name: "summary",
    value: item.summary,
    rows: 3,
    dataset: { field: "summary" }
  });
  wrapper.appendChild(summaryField.label);

  const implicationField = createLabeledTextarea({
    label: "นัยสำคัญต่อธุรกิจ",
    name: "implication",
    value: item.implication,
    rows: 3,
    dataset: { field: "implication" }
  });
  wrapper.appendChild(implicationField.label);

  const row2 = document.createElement("div");
  row2.className = "news-item-row-2";

  const sourceField = createLabeledInput({
    label: "แหล่งข่าว",
    name: "source",
    value: item.source,
    dataset: { field: "source" }
  });

  const scoreField = createLabeledInput({
    label: "คะแนน (0-9)",
    name: "score",
    type: "number",
    value: item.score,
    min: 0,
    max: 9,
    dataset: { field: "score" }
  });

  row2.appendChild(sourceField.label);
  row2.appendChild(scoreField.label);
  wrapper.appendChild(row2);

  return wrapper;
}

function buildNewsEditors(container, data) {
  container.innerHTML = "";

  const news = Array.isArray(data.news) ? data.news : [];

  news.forEach((item, index) => {
    const editor = buildNewsItemEditor(item, index);
    container.appendChild(editor);
  });
}

function handleNewsFieldEvent(event, container) {
  const editor = event.target.closest(".news-item-editor");

  if (!editor || !container.contains(editor)) {
    return;
  }

  const index = Number(editor.dataset.index);
  const field = event.target.dataset.field;

  if (!field || Number.isNaN(index)) {
    return;
  }

  let value = event.target.value;

  if (field === "score") {
    value = Math.min(9, Math.max(0, Number(value) || 0));
  }

  currentData.news[index][field] = value;

  if (field === "signpost") {
    editor.dataset.signpost = String(value).toUpperCase();
  }

  if (field === "image") {
    const preview = editor.querySelector(
      '[data-role="image-preview"]'
    );

    if (preview) {
      preview.src = value;
    }
  }

  scheduleUpdatePreview();
}

/* ---------------------------------------------------------
   Watchlist editors
--------------------------------------------------------- */

function buildWatchItemEditor(item, index) {
  const wrapper = document.createElement("div");
  wrapper.className = "watch-item-editor";
  wrapper.dataset.index = String(index);

  const fields = document.createElement("div");
  fields.className = "watch-item-fields";

  const titleField = createLabeledInput({
    label: `ประเด็นที่ ${index + 1}: หัวข้อ`,
    name: "title",
    value: item.title,
    dataset: { field: "title" }
  });

  const detailField = createLabeledTextarea({
    label: "รายละเอียด",
    name: "detail",
    value: item.detail,
    rows: 2,
    dataset: { field: "detail" }
  });

  fields.appendChild(titleField.label);
  fields.appendChild(detailField.label);

  const removeButton = document.createElement("button");
  removeButton.type = "button";
  removeButton.className = "btn btn-danger btn-small watch-item-remove";
  removeButton.textContent = "ลบ";
  removeButton.dataset.action = "remove-watch-item";

  wrapper.appendChild(fields);
  wrapper.appendChild(removeButton);

  return wrapper;
}

function reindexWatchlist() {
  currentData.watchlist.forEach((item, index) => {
    item.index = index + 1;
  });
}

function buildWatchlistEditors(container, data) {
  container.innerHTML = "";

  if (!Array.isArray(data.watchlist)) {
    data.watchlist = [];
  }

  data.watchlist.forEach((item, index) => {
    const editor = buildWatchItemEditor(item, index);
    container.appendChild(editor);
  });
}

function handleWatchlistFieldEvent(event, container) {
  if (event.target.dataset.action === "remove-watch-item") {
    const editor = event.target.closest(".watch-item-editor");
    const index = Number(editor.dataset.index);

    currentData.watchlist.splice(index, 1);
    reindexWatchlist();
    buildWatchlistEditors(container, currentData);
    scheduleUpdatePreview();
    return;
  }

  const editor = event.target.closest(".watch-item-editor");

  if (!editor || !container.contains(editor)) {
    return;
  }

  const index = Number(editor.dataset.index);
  const field = event.target.dataset.field;

  if (!field || Number.isNaN(index)) {
    return;
  }

  currentData.watchlist[index][field] = event.target.value;
  scheduleUpdatePreview();
}

function addWatchlistItem(container) {
  const nextIndex = currentData.watchlist.length + 1;

  currentData.watchlist.push({
    index: nextIndex,
    title: "",
    detail: ""
  });

  buildWatchlistEditors(container, currentData);
  scheduleUpdatePreview();
}

/* ---------------------------------------------------------
   Preview rendering
--------------------------------------------------------- */

function updatePreviewNow() {
  const previewRoot = document.getElementById("report");

  if (!window.ReportRenderer || !window.ReportRenderer.renderReport) {
    if (previewRoot) {
      previewRoot.innerHTML = `
        <div class="error">
          <strong>ไม่พบ window.ReportRenderer</strong>
          <p>
            กรุณาเพิ่มโค้ดส่งออกฟังก์ชันท้ายไฟล์ js/report.js
            ตามคำแนะนำ ก่อนใช้งานหน้า Review
          </p>
        </div>
      `;
    }

    return;
  }

  try {
    window.ReportRenderer.renderReport(currentData);
  } catch (error) {
    console.error(error);

    if (previewRoot) {
      previewRoot.innerHTML = `
        <div class="error">
          <strong>ไม่สามารถแสดง Preview ได้</strong>
          <p>${window.ReportRenderer.escapeHtml(error.message)}</p>
        </div>
      `;
    }
  }
}

const scheduleUpdatePreview = debounce(updatePreviewNow, DEBOUNCE_MS);

/* ---------------------------------------------------------
   Approval validation and export
--------------------------------------------------------- */

function validateBeforeApprove(data, reviewedBy) {
  const errors = [];

  if (!data.reportMonth || !data.reportMonth.trim()) {
    errors.push("กรุณาระบุเดือนของรายงาน (reportMonth)");
  }

  if (!data.subtitle || !data.subtitle.trim()) {
    errors.push("กรุณาระบุคำโปรย (subtitle)");
  }

  if (!data.executiveSummary || !data.executiveSummary.trim()) {
    errors.push("กรุณาระบุบทสรุปข่าวสำคัญประจำเดือน");
  }

  if (!Array.isArray(data.news) || data.news.length === 0) {
    errors.push("ต้องมีข่าวอย่างน้อย 1 รายการ");
  } else {
    data.news.forEach((item, index) => {
      const label = `ข่าวที่ ${index + 1}`;

      if (!item.title || !item.title.trim()) {
        errors.push(`${label}: กรุณาระบุหัวข้อข่าว`);
      }

      if (!item.summary || !item.summary.trim()) {
        errors.push(`${label}: กรุณาระบุสรุปข่าว`);
      }

      if (!item.implication || !item.implication.trim()) {
        errors.push(`${label}: กรุณาระบุนัยสำคัญต่อธุรกิจ`);
      }
    });
  }

  if (!reviewedBy || !reviewedBy.trim()) {
    errors.push("กรุณาระบุชื่อผู้ตรวจสอบ (Reviewed By)");
  }

  return {
    valid: errors.length === 0,
    errors
  };
}

function handleDownloadApproved(form, statusPill) {
  const reviewedBy = form.elements.namedItem("reviewedBy").value;
  const approvalComment = form.elements.namedItem(
    "approvalComment"
  ).value;

  const validation = validateBeforeApprove(currentData, reviewedBy);

  if (!validation.valid) {
    window.alert(
      "กรุณาแก้ไขก่อนดาวน์โหลด:\n\n" +
        validation.errors.map((item) => `• ${item}`).join("\n")
    );

    return;
  }

  const approvedData = deepClone(currentData);

  approvedData.status = "approved";
  approvedData.reviewedBy = reviewedBy;
  approvedData.reviewedDate = todayIso();
  approvedData.approvalComment = approvalComment;

  downloadJson("approved-report.json", approvedData);

  statusPill.textContent = "APPROVED";
  statusPill.classList.remove("status-draft");
  statusPill.classList.add("status-approved");

  updatePreviewNow();
}

/* ---------------------------------------------------------
   Draft loading
--------------------------------------------------------- */

async function loadDraft() {
  const formLoading = document.getElementById("form-loading");
  const form = document.getElementById("review-form");
  const statusPill = document.getElementById("review-status-pill");

  const newsContainer = document.getElementById(
    "news-items-container"
  );

  const watchlistContainer = document.getElementById(
    "watchlist-items-container"
  );

  formLoading.textContent = "กำลังโหลดข้อมูล Draft...";
  formLoading.classList.remove("hidden");
  form.classList.add("hidden");

  try {
    const response = await fetch(DRAFT_URL, {
      cache: "no-store"
    });

    if (!response.ok) {
      throw new Error(`โหลด Draft ไม่สำเร็จ: HTTP ${response.status}`);
    }

    const data = await response.json();

    currentData = deepClone(data);

    if (!currentData.statistics) {
      currentData.statistics = {
        keyStories: 0,
        signposts: 0,
        signalsReviewed: 0
      };
    }

    if (!Array.isArray(currentData.watchlist)) {
      currentData.watchlist = [];
    }

    populateTopLevelFields(form, currentData);
    buildNewsEditors(newsContainer, currentData);
    buildWatchlistEditors(watchlistContainer, currentData);

    statusPill.textContent = "DRAFT";
    statusPill.classList.remove("status-approved");
    statusPill.classList.add("status-draft");

    formLoading.classList.add("hidden");
    form.classList.remove("hidden");

    updatePreviewNow();
  } catch (error) {
    console.error(error);

    formLoading.textContent = `ไม่สามารถโหลด Draft ได้: ${error.message}`;
    formLoading.classList.remove("hidden");
    form.classList.add("hidden");
  }
}

/* ---------------------------------------------------------
   Bootstrap
--------------------------------------------------------- */

function initReviewPage() {
  const form = document.getElementById("review-form");
  const statusPill = document.getElementById("review-status-pill");

  const newsContainer = document.getElementById(
    "news-items-container"
  );

  const watchlistContainer = document.getElementById(
    "watchlist-items-container"
  );

  const btnReloadDraft = document.getElementById("btn-reload-draft");
  const btnRefreshPreview = document.getElementById(
    "btn-refresh-preview"
  );

  const btnDownloadApproved = document.getElementById(
    "btn-download-approved"
  );

  const btnAddWatchItem = document.getElementById(
    "btn-add-watchitem"
  );

  bindTopLevelFields(form);

  newsContainer.addEventListener("input", (event) => {
    handleNewsFieldEvent(event, newsContainer);
  });

  newsContainer.addEventListener("change", (event) => {
    handleNewsFieldEvent(event, newsContainer);
  });

  watchlistContainer.addEventListener("input", (event) => {
    handleWatchlistFieldEvent(event, watchlistContainer);
  });

  watchlistContainer.addEventListener("click", (event) => {
    handleWatchlistFieldEvent(event, watchlistContainer);
  });

  btnReloadDraft.addEventListener("click", () => {
    const confirmed = window.confirm(
      "การแก้ไขทั้งหมดจะหายไป ต้องการโหลด Draft ใหม่หรือไม่?"
    );

    if (confirmed) {
      loadDraft();
    }
  });

  btnRefreshPreview.addEventListener("click", () => {
    updatePreviewNow();
  });

  btnDownloadApproved.addEventListener("click", () => {
    handleDownloadApproved(form, statusPill);
  });

  if (btnAddWatchItem) {
    btnAddWatchItem.addEventListener("click", () => {
      addWatchlistItem(watchlistContainer);
    });
  }

  loadDraft();
}

document.addEventListener("DOMContentLoaded", initReviewPage);
