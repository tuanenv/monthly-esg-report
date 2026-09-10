"use strict";

const DATA_URL = "./data/default-report.json";

/**
 * ป้องกันข้อความจาก JSON ถูกตีความเป็น HTML
 */
function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

/**
 * อนุญาตเฉพาะ SP1, SP2 และ SP3
 */
function normalizeSignpost(value) {
  const signpost = String(value ?? "").toUpperCase();

  if (["SP1", "SP2", "SP3"].includes(signpost)) {
    return signpost;
  }

  return "SP2";
}

/**
 * จำกัดคะแนนให้อยู่ระหว่าง 0 ถึง 9
 */
function normalizeScore(value) {
  const score = Number(value);

  if (!Number.isFinite(score)) {
    return 0;
  }

  return Math.min(9, Math.max(0, score));
}

/**
 * สร้างสถิติด้านบนของรายงาน
 */
function createStatistics(statistics = {}) {
  return `
    <div class="statistics">
      <div class="statistic">
        <strong>${escapeHtml(statistics.keyStories ?? 0)}</strong>
        <span>ข่าวสำคัญ</span>
      </div>

      <div class="statistic">
        <strong>${escapeHtml(statistics.signposts ?? 0)}</strong>
        <span>Signpost</span>
      </div>

      <div class="statistic">
        <strong>${escapeHtml(statistics.signalsReviewed ?? 0)}</strong>
        <span>ข่าวที่พิจารณา</span>
      </div>
    </div>
  `;
}

/**
 * สร้างการ์ดข่าวแต่ละรายการ
 */
function createNewsCard(item) {
  const signpost = normalizeSignpost(item.signpost);
  const score = normalizeScore(item.score);

  return `
    <article class="card card-${signpost.toLowerCase()}">
      <div class="card-image-wrapper">
        "
          alt="ภาพประกอบข่าว ${escapeHtml(item.title)}"
          loading="eager"
          onerror="this.onerror=null; this.src='./assets/images/news-01.png';"
        >

        <span class="card-image-label">
          AI-GENERATED VISUAL
        </span>
      </div>

      <div class="card-meta">
        <span class="card-index">
          ${escapeHtml(item.index)}
        </span>

        <span class="card-category">
          ${escapeHtml(item.category)} (${signpost})
        </span>

        <time class="card-date">
          ${escapeHtml(item.date)}
        </time>
      </div>

      <h2>${escapeHtml(item.title)}</h2>

      <p class="card-summary">
        ${escapeHtml(item.summary)}
      </p>

      <div class="card-implication">
        <strong>นัยสำคัญต่อธุรกิจ</strong>

        <p>
          ${escapeHtml(item.implication)}
        </p>
      </div>

      <footer class="card-footer">
        <span>
          แหล่งข่าว: ${escapeHtml(item.source)}
        </span>

        <span class="card-score">
          คะแนน ${score}/9
        </span>
      </footer>
    </article>
  `;
}

/**
 * สร้างส่วนประเด็นที่ควรจับตา
 */
function createWatchlist(watchlist = []) {
  if (!Array.isArray(watchlist) || watchlist.length === 0) {
    return "";
  }

  const items = watchlist
    .map(
      (item) => `
        <div class="watch-item">
          <span class="watch-number">
            ${escapeHtml(item.index)}
          </span>

          <div class="watch-content">
            <strong>${escapeHtml(item.title)}</strong>

            <p>${escapeHtml(item.detail)}</p>
          </div>
        </div>
      `
    )
    .join("");

  return `
    <section class="watchlist">
      <h3>${watchlist.length} ประเด็นที่ควรจับตา</h3>

      <div class="watchlist-grid">
        ${items}
      </div>
    </section>
  `;
}

/**
 * ประกอบหน้า Report ทั้งหมด
 */
function renderReport(data) {
  const report = document.getElementById("report");

  if (!report) {
    throw new Error("ไม่พบ element ที่มี id='report'");
  }

  const news = Array.isArray(data.news) ? data.news : [];
  const cards = news.map(createNewsCard).join("");

  document.title =
    `${data.title ?? "Monthly ESG Intelligence"} | ` +
    `${data.reportMonth ?? ""}`;

  report.innerHTML = `
    <header class="hero">
      <small>ZASA • ESG FORESIGHT AGENT</small>

      <h1>
        Monthly
        <span class="highlight">ESG Intelligence</span>
      </h1>

      <p>${escapeHtml(data.subtitle)}</p>

      <span class="period">
        ${escapeHtml(data.reportMonth)} • Hybrid Prototype
      </span>
    </header>

    <section class="executive-summary">
      <div class="executive-content">
        <h3>บทสรุปข่าวสำคัญประจำเดือน</h3>

        <p>
          ${escapeHtml(data.executiveSummary)}
        </p>
      </div>

      ${createStatistics(data.statistics)}
    </section>

    <section class="news-grid">
      ${cards}
    </section>

    ${createWatchlist(data.watchlist)}

    <footer class="report-footer">
      Hybrid Report:
      ภาพประกอบจาก AI ไม่มีข้อความ •
      เนื้อหาทั้งหมดแสดงด้วย HTML •
      Font: PTT 45 Pride
    </footer>
  `;
}

/**
 * รอภาพทั้งหมดโหลดเสร็จ
 * ใช้รองรับการ Capture เป็น PNG/PDF ในขั้นต่อไป
 */
async function waitForImages() {
  const images = Array.from(document.images);

  await Promise.all(
    images.map((image) => {
      if (image.complete) {
        return Promise.resolve();
      }

      return new Promise((resolve) => {
        image.addEventListener("load", resolve, { once: true });
        image.addEventListener("error", resolve, { once: true });
      });
    })
  );
}

/**
 * โหลด JSON และเริ่ม Render
 */
async function loadReport() {
  const report = document.getElementById("report");

  try {
    const response = await fetch(DATA_URL, {
      cache: "no-store"
    });

    if (!response.ok) {
      throw new Error(
        `โหลดข้อมูลไม่สำเร็จ: HTTP ${response.status}`
      );
    }

    const data = await response.json();

    renderReport(data);

    if (document.fonts?.ready) {
      await document.fonts.ready;
    }

    await waitForImages();

    document.body.dataset.renderStatus = "ready";

    window.dispatchEvent(
      new CustomEvent("report-ready", {
        detail: {
          reportMonth: data.reportMonth,
          newsCount: Array.isArray(data.news)
            ? data.news.length
            : 0
        }
      })
    );
  } catch (error) {
    console.error(error);

    document.body.dataset.renderStatus = "error";

    if (report) {
      report.innerHTML = `
        <div class="error">
          <strong>ไม่สามารถแสดงรายงานได้</strong>
          <p>${escapeHtml(error.message)}</p>
        </div>
      `;
    }
  }
}

document.addEventListener("DOMContentLoaded", loadReport);
