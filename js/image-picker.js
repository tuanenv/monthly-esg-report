"use strict";

/**
 * Image Picker — เปิดโหมดให้ Analyst เลือกรูปจาก Library (SP1/SP2/SP3/MULTI)
 * มาแทนที่รูปที่ดึงจาก web หรือรูป fallback เดิม ต่อข่าวแต่ละรายการ
 *
 * ไฟล์นี้โหลดเฉพาะใน review.html เท่านั้น (ไม่โหลดใน index.html)
 * เพื่อไม่ให้ปุ่ม "เปลี่ยนรูป" หลุดไปติดในภาพ PNG/PDF ที่ Render ผ่าน Playwright
 */
(function () {
  const MANIFEST_URL = "./assets/images/library/manifest.json";

  let manifestCache = null;
  let activeNewsIndex = null;
  let activeSignpost = null;
  let modalEl = null;

  function injectStyles() {
    if (document.getElementById("image-picker-styles")) {
      return;
    }

    const style = document.createElement("style");
    style.id = "image-picker-styles";
    style.textContent = `
      body.review-mode .btn-change-image {
        display: inline-flex !important;
        align-items: center;
        gap: 6px;
        position: absolute;
        bottom: 10px;
        right: 10px;
        padding: 7px 14px;
        font-size: 13px;
        font-weight: 600;
        color: #ffffff;
        background: rgba(6, 59, 52, 0.88);
        border: none;
        border-radius: 999px;
        cursor: pointer;
        z-index: 5;
        transition: background 0.15s ease, transform 0.15s ease;
      }
      body.review-mode .btn-change-image:hover {
        background: #063b34;
        transform: translateY(-1px);
      }

      .image-picker-overlay {
        position: fixed;
        inset: 0;
        background: rgba(6, 20, 18, 0.65);
        display: none;
        align-items: center;
        justify-content: center;
        z-index: 9999;
        padding: 24px;
      }
      .image-picker-overlay.open {
        display: flex;
      }
      .image-picker-modal {
        background: #ffffff;
        width: min(920px, 100%);
        max-height: 86vh;
        border-radius: 16px;
        display: flex;
        flex-direction: column;
        overflow: hidden;
        box-shadow: 0 24px 60px rgba(0, 0, 0, 0.35);
      }
      .image-picker-header {
        display: flex;
        align-items: center;
        justify-content: space-between;
        padding: 18px 24px;
        border-bottom: 1px solid #e5e5e5;
      }
      .image-picker-header h3 {
        margin: 0;
        font-size: 18px;
        color: #063b34;
      }
      .image-picker-close {
        border: none;
        background: none;
        font-size: 22px;
        line-height: 1;
        cursor: pointer;
        color: #52555b;
        padding: 4px 10px;
        border-radius: 8px;
      }
      .image-picker-close:hover {
        background: #f1f4f8;
      }
      .image-picker-tabs {
        display: flex;
        gap: 8px;
        padding: 14px 24px 0;
        border-bottom: 1px solid #e5e5e5;
        flex-wrap: wrap;
      }
      .image-picker-tab {
        border: 1px solid transparent;
        background: #f1f4f8;
        color: #52555b;
        padding: 8px 16px;
        border-radius: 10px 10px 0 0;
        font-size: 13px;
        font-weight: 600;
        cursor: pointer;
        margin-bottom: -1px;
      }
      .image-picker-tab.active {
        background: #ffffff;
        color: #008577;
        border-color: #e5e5e5;
        border-bottom-color: #ffffff;
      }
      .image-picker-body {
        padding: 20px 24px;
        overflow-y: auto;
        flex: 1;
        min-height: 240px;
      }
      .image-picker-grid {
        display: grid;
        grid-template-columns: repeat(auto-fill, minmax(160px, 1fr));
        gap: 14px;
      }
      .image-picker-item {
        border: 2px solid transparent;
        border-radius: 10px;
        overflow: hidden;
        cursor: pointer;
        background: #f1f4f8;
        position: relative;
        aspect-ratio: 4 / 3;
      }
      .image-picker-item img {
        width: 100%;
        height: 100%;
        object-fit: cover;
        display: block;
      }
      .image-picker-item:hover {
        border-color: #00aeef;
      }
      .image-picker-item.selected {
        border-color: #008577;
      }
      .image-picker-item.selected::after {
        content: "\\2713";
        position: absolute;
        top: 6px;
        right: 6px;
        width: 22px;
        height: 22px;
        border-radius: 50%;
        background: #008577;
        color: #ffffff;
        font-size: 13px;
        font-weight: 700;
        display: flex;
        align-items: center;
        justify-content: center;
      }
      .image-picker-footer {
        padding: 12px 24px;
        border-top: 1px solid #e5e5e5;
        font-size: 12px;
        color: #808080;
      }
      .image-picker-loading,
      .image-picker-error {
        padding: 40px;
        text-align: center;
        color: #808080;
        font-size: 14px;
      }
    `;
    document.head.appendChild(style);
  }

  async function loadManifest() {
    if (manifestCache) {
      return manifestCache;
    }

    const response = await fetch(MANIFEST_URL, { cache: "no-store" });

    if (!response.ok) {
      throw new Error(`โหลด manifest ไม่สำเร็จ: HTTP ${response.status}`);
    }

    manifestCache = await response.json();
    return manifestCache;
  }

  function buildModal() {
    if (modalEl) {
      return modalEl;
    }

    const overlay = document.createElement("div");
    overlay.className = "image-picker-overlay";
    overlay.innerHTML = `
      <div class="image-picker-modal" role="dialog" aria-modal="true" aria-label="เลือกรูปภาพ">
        <div class="image-picker-header">
          <h3>เลือกรูปภาพสำหรับข่าวนี้</h3>
          <button type="button" class="image-picker-close" aria-label="ปิด">&times;</button>
        </div>
        <div class="image-picker-tabs"></div>
        <div class="image-picker-body">
          <div class="image-picker-loading">กำลังโหลดรูปภาพ...</div>
        </div>
        <div class="image-picker-footer">
          คลิกรูปเพื่อเลือกใช้ทันที — ระบบจะบันทึกการเปลี่ยนแปลงเมื่อกด "ส่งขออนุมัติ"
        </div>
      </div>
    `;

    document.body.appendChild(overlay);
    modalEl = overlay;

    overlay.addEventListener("click", (event) => {
      if (event.target === overlay) {
        closeModal();
      }
    });

    overlay
      .querySelector(".image-picker-close")
      .addEventListener("click", closeModal);

    document.addEventListener("keydown", (event) => {
      if (event.key === "Escape" && overlay.classList.contains("open")) {
        closeModal();
      }
    });

    return overlay;
  }

  function closeModal() {
    if (modalEl) {
      modalEl.classList.remove("open");
    }
    activeNewsIndex = null;
    activeSignpost = null;
  }

  function renderTabs(categories) {
    const tabsWrap = modalEl.querySelector(".image-picker-tabs");
    tabsWrap.innerHTML = categories
      .map(
        (category) => `
          <button type="button" class="image-picker-tab${
            category.signpost === activeSignpost ? " active" : ""
          }" data-signpost="${category.signpost}">
            ${category.label}
          </button>
        `
      )
      .join("");

    tabsWrap.querySelectorAll(".image-picker-tab").forEach((tabButton) => {
      tabButton.addEventListener("click", () => {
        activeSignpost = tabButton.dataset.signpost;
        const category = categories.find(
          (item) => item.signpost === activeSignpost
        );
        renderTabs(categories);
        renderGrid(category);
      });
    });
  }

  function renderGrid(category) {
    const body = modalEl.querySelector(".image-picker-body");

    if (!category || !Array.isArray(category.images) || category.images.length === 0) {
      body.innerHTML = `<div class="image-picker-error">ไม่พบรูปภาพในหมวดนี้</div>`;
      return;
    }

    const basePath = manifestCache.basePath || "assets/images/library";

    const cardImage = document.querySelector(
      `.card-image[data-news-index="${activeNewsIndex}"]`
    );
    const currentImagePath = cardImage ? cardImage.getAttribute("src") || "" : "";

    body.innerHTML = `
      <div class="image-picker-grid">
        ${category.images
          .map((image) => {
            const fullPath = `${basePath}/${category.folder}/${image.file}`;
            const thumbPath = `${basePath}/${image.thumb}`;
            const isSelected = currentImagePath.includes(image.file);
            return `
              <div class="image-picker-item${isSelected ? " selected" : ""}" data-full-path="${fullPath}" data-image-id="${image.id}">
                <img src="${thumbPath}" alt="${image.alt || image.id}" loading="lazy">
              </div>
            `;
          })
          .join("")}
      </div>
    `;

    body.querySelectorAll(".image-picker-item").forEach((itemEl) => {
      itemEl.addEventListener("click", () => {
        selectImage(itemEl.dataset.fullPath);
      });
    });
  }

  function selectImage(fullPath) {
    if (activeNewsIndex === null) {
      return;
    }

    const cardImage = document.querySelector(
      `.card-image[data-news-index="${activeNewsIndex}"]`
    );
    if (cardImage) {
      cardImage.src = fullPath;
    }

    const data = window.ReportRenderer?.getCurrentData?.();
    if (data && Array.isArray(data.news) && data.news[activeNewsIndex]) {
      data.news[activeNewsIndex].image = fullPath;
    }

    closeModal();
  }

  function guessSignpostForNews(newsIndex) {
    const cardEl = document.querySelector(
      `.card-image-wrapper[data-news-index="${newsIndex}"]`
    );
    const articleEl = cardEl ? cardEl.closest("article") : null;

    if (!articleEl) {
      return null;
    }

    if (articleEl.classList.contains("card-sp1")) return "SP1";
    if (articleEl.classList.contains("card-sp2")) return "SP2";
    if (articleEl.classList.contains("card-sp3")) return "SP3";
    return null;
  }

  async function openPickerFor(newsIndex) {
    activeNewsIndex = newsIndex;
    buildModal();
    injectStyles();

    modalEl.classList.add("open");
    modalEl.querySelector(".image-picker-body").innerHTML =
      '<div class="image-picker-loading">กำลังโหลดรูปภาพ...</div>';

    try {
      const manifest = await loadManifest();
      const categories = Array.isArray(manifest.categories)
        ? manifest.categories
        : [];

      if (categories.length === 0) {
        modalEl.querySelector(".image-picker-body").innerHTML =
          '<div class="image-picker-error">ไม่พบ Library รูปภาพ (manifest.json ว่างเปล่า)</div>';
        return;
      }

      const guessed = guessSignpostForNews(newsIndex);
      activeSignpost =
        categories.find((category) => category.signpost === guessed)
          ?.signpost || categories[0].signpost;

      renderTabs(categories);
      renderGrid(
        categories.find((category) => category.signpost === activeSignpost)
      );
    } catch (error) {
      console.error(error);
      modalEl.querySelector(".image-picker-body").innerHTML =
        `<div class="image-picker-error">โหลด Library ไม่สำเร็จ: ${error.message}</div>`;
    }
  }

  function initImagePicker() {
    injectStyles();
    buildModal();

    document.body.addEventListener("click", (event) => {
      const button = event.target.closest(".btn-change-image");
      if (!button) {
        return;
      }

      const newsIndex = Number(button.dataset.newsIndex);
      if (Number.isNaN(newsIndex)) {
        return;
      }

      openPickerFor(newsIndex);
    });
  }

  document.addEventListener("DOMContentLoaded", initImagePicker);

  window.ImagePicker = { openPickerFor };
})();
