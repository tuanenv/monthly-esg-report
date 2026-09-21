"use strict";

const DRAFT_URL = "./data/default-report.json";
const HTML2CANVAS_SCALE = 2;

// ===== ใหม่: URL ของ Flow 2a (HTTP Trigger รับ JSON แล้วเขียนเข้า MonthlyReportControl) =====
// TODO: แทนที่ด้วย HTTP POST URL จริงจาก Power Automate (Flow 2a - Submit Report to List)
const FLOW2A_URL = "https://70e17b12a95ee69e8ba90c33b91031.87.environment.api.powerplatform.com:443/powerautomate/automations/direct/cu/00/workflows/5c14d22f0186473fa4a888a9ead0edad/triggers/manual/paths/invoke?api-version=1&sp=%2Ftriggers%2Fmanual%2Frun&sv=1.0&sig=D5RKJYWPuLIX7Lm_Tv0_4mhZxs7_CToRzCBszdEW9oU";

function slugifyForFilename(value) {
  return String(value ?? "report")
    .trim()
    .replace(/\s+/g, "-")
    .replace(/[^a-zA-Z0-9-]/g, "");
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
  const blob = new Blob([jsonText], { type: "application/json" });
  const url = URL.createObjectURL(blob);

  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);

  URL.revokeObjectURL(url);
}

function syncDomFieldsToData(data) {
  const subtitleField = document.querySelector('[data-field="subtitle"]');
  if (subtitleField) {
    data.subtitle = subtitleField.textContent.trim();
  }

  const summaryField = document.querySelector('[data-field="executiveSummary"]');
  if (summaryField) {
    data.executiveSummary = summaryField.textContent.trim();
  }

  document.querySelectorAll("[data-news-index]").forEach((element) => {
    const index = Number(element.dataset.newsIndex);
    const field = element.dataset.field;

    if (Number.isNaN(index) || !field || !data.news[index]) {
      return;
    }

    data.news[index][field] = element.textContent.trim();
  });

  document.querySelectorAll("[data-watch-index]").forEach((element) => {
    const index = Number(element.dataset.watchIndex);
    const field = element.dataset.field;

    if (
      Number.isNaN(index) ||
      !field ||
      !data.watchlist ||
      !data.watchlist[index]
    ) {
      return;
    }

    data.watchlist[index][field] = element.textContent.trim();
  });

  document.querySelectorAll("[data-trend-index]").forEach((element) => {
    const index = Number(element.dataset.trendIndex);
    const field = element.dataset.field;

    if (
      Number.isNaN(index) ||
      !field ||
      !data.trends ||
      !data.trends[index]
    ) {
      return;
    }

    data.trends[index][field] = element.textContent.trim();
  });

  return data;
}

function validateBeforeSave(data, reviewedBy) {
  const errors = [];

  if (!data.executiveSummary || !data.executiveSummary.trim()) {
    errors.push("กรุณาระบุบทสรุปข่าวสำคัญประจำเดือน");
  }

  if (Array.isArray(data.news)) {
    data.news.forEach((item, index) => {
      if (!item.title || !item.title.trim()) {
        errors.push(`ข่าวที่ ${index + 1}: กรุณาระบุหัวข้อข่าว`);
      }
      if (!item.summary || !item.summary.trim()) {
        errors.push(`ข่าวที่ ${index + 1}: กรุณาระบุสรุปข่าว`);
      }
      if (!item.implication || !item.implication.trim()) {
        errors.push(`ข่าวที่ ${index + 1}: กรุณาระบุนัยสำคัญต่อธุรกิจ`);
      }
    });
  }

  if (!reviewedBy || !reviewedBy.trim()) {
    errors.push("กรุณาระบุชื่อผู้ตรวจสอบ");
  }

  return { valid: errors.length === 0, errors };
}

async function exportPreviewAsPng(filenameBase) {
  if (!window.html2canvas) {
    window.alert("ไม่พบไลบรารี html2canvas");
    return;
  }

  const reportNode = document.getElementById("report");

  const canvas = await window.html2canvas(reportNode, {
    backgroundColor: "#ffffff",
    scale: HTML2CANVAS_SCALE,
    useCORS: true,
    logging: false
  });

  const link = document.createElement("a");
  link.download = `${filenameBase}.png`;
  link.href = canvas.toDataURL("image/png");
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
}

async function loadAndRenderDraft() {
  const reportRoot = document.getElementById("report");

  try {
    const response = await fetch(DRAFT_URL, { cache: "no-store" });

    if (!response.ok) {
      throw new Error(`โหลด Draft ไม่สำเร็จ: HTTP ${response.status}`);
    }

    const data = await response.json();

    window.ReportRenderer.renderReport(data);

    if (document.fonts?.ready) {
      await document.fonts.ready;
    }

    document.body.dataset.renderStatus = "ready";
  } catch (error) {
    console.error(error);

    if (reportRoot) {
      reportRoot.innerHTML = `
        <div class="error">
          <strong>ไม่สามารถแสดงรายงานได้</strong>
          <p>${window.ReportRenderer.escapeHtml(error.message)}</p>
        </div>
      `;
    }
  }
}

// ===== ใหม่: สร้าง payload สำหรับส่งไป Flow 2a =====
// บังคับ status = "pending_review" เสมอ (ไม่ใช่ "approved" แบบปุ่ม export เดิม)
// เพราะขั้นตอนนี้คือ "ส่งให้ Manager พิจารณา" ไม่ใช่ "อนุมัติแล้ว"
function buildSubmitPayload(data, reviewedBy) {
  const payload = JSON.parse(JSON.stringify(data));

  payload.status = "pending_review";
  payload.submittedBy = reviewedBy.trim();
  payload.reviewedBy = "";
  payload.reviewedDate = "";
  payload.approvalComment = "";

  // คง statistics เดิมไว้ตามที่ Flow 1 คำนวณมาให้แล้ว (keyStories, signposts, signalsReviewed)
  // ไม่ต้องคำนวณใหม่ฝั่ง client เพราะข้อมูลนี้มากับ draft อยู่แล้ว

  return payload;
}

// ===== ใหม่: ยิง HTTP POST ไปยัง Flow 2a =====
async function submitToFlow2a(payload) {
  const response = await fetch(FLOW2A_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload)
  });

  let result = null;
  try {
    result = await response.json();
  } catch (_err) {
    // บาง response (เช่น 202 Accepted จาก Power Automate ตอน test)
    // อาจไม่มี body กลับมาเป็น JSON เสมอ ปล่อยผ่านไม่ throw
  }

  if (!response.ok) {
    const message = result?.message || `HTTP ${response.status}`;
    throw new Error(message);
  }

  return result;
}

function initReviewPage() {
  const toggleButton = document.getElementById("btn-toggle-edit");
  const saveButton = document.getElementById("btn-save-export");
  const submitButton = document.getElementById("btn-submit-approval"); // ใหม่
  const reviewedByInput = document.getElementById("input-reviewed-by");
  const commentInput = document.getElementById("input-approval-comment");
  const statusPill = document.getElementById("edit-status-pill");

  // ===== ซ่อนปุ่ม "บันทึกและส่งออก (JSON + PNG)" ไว้ก่อน =====
  // หมายเหตุ: ซ่อนด้วย CSS (display: none) เท่านั้น ไม่ได้ลบ element หรือ event listener ออก
  // เพื่อให้สามารถเปิดกลับมาใช้งานได้ง่ายในภายหลัง เพียงลบ/comment บรรทัดด้านล่างนี้ทิ้ง
  if (saveButton) {
    saveButton.style.display = "none";
  }

  
  let editModeOn = false;

  toggleButton.addEventListener("click", () => {
    editModeOn = !editModeOn;

    window.ReportRenderer.setFieldEditable(editModeOn);

    toggleButton.textContent = editModeOn ? "ปิดโหมดแก้ไข" : "เปิดโหมดแก้ไข";
    toggleButton.classList.toggle("btn-editing", editModeOn);
  });

  // ===== ปุ่มเดิม: บันทึกและส่งออก (JSON + PNG) แบบ local — ไม่แก้ไขใดๆ =====
  saveButton.addEventListener("click", async () => {
    const reviewedBy = reviewedByInput.value;
    const approvalComment = commentInput.value;

    let data = window.ReportRenderer.getCurrentData();

    if (!data) {
      window.alert("ยังไม่มีข้อมูลรายงาน");
      return;
    }

    data = syncDomFieldsToData(data);

    const validation = validateBeforeSave(data, reviewedBy);

    if (!validation.valid) {
      window.alert(
        "กรุณาแก้ไขก่อนบันทึก:\n\n" +
          validation.errors.map((item) => `• ${item}`).join("\n")
      );
      return;
    }

    const originalLabel = saveButton.textContent;
    saveButton.disabled = true;
    saveButton.textContent = "กำลังสร้างไฟล์...";

    try {
      const approvedData = JSON.parse(JSON.stringify(data));
      approvedData.status = "approved";
      approvedData.reviewedBy = reviewedBy.trim();
      approvedData.reviewedDate = todayIso();
      approvedData.approvalComment = approvalComment.trim();

      const filenameBase = `monthly-esg-report-${slugifyForFilename(data.reportMonth)}`;

      downloadJson(`${filenameBase}.json`, approvedData);

      await new Promise((resolve) => setTimeout(resolve, 150));

      await exportPreviewAsPng(filenameBase);

      statusPill.textContent = "APPROVED";
      statusPill.classList.remove("status-draft");
      statusPill.classList.add("status-approved");
    } catch (error) {
      console.error(error);
      window.alert(`เกิดข้อผิดพลาด: ${error.message}`);
    } finally {
      saveButton.disabled = false;
      saveButton.textContent = originalLabel;
    }
  });

  // ===== ใหม่: ปุ่มส่งขออนุมัติ → ยิงไป Flow 2a =====
  if (submitButton) {
    submitButton.addEventListener("click", async () => {
      const reviewedBy = reviewedByInput.value;

      let data = window.ReportRenderer.getCurrentData();

      if (!data) {
        window.alert("ยังไม่มีข้อมูลรายงาน");
        return;
      }

      data = syncDomFieldsToData(data);

      // ใช้ validation ชุดเดิม (เกณฑ์เดียวกับปุ่ม export)
      const validation = validateBeforeSave(data, reviewedBy);

      if (!validation.valid) {
        window.alert(
          "กรุณาแก้ไขก่อนส่งขออนุมัติ:\n\n" +
            validation.errors.map((item) => `• ${item}`).join("\n")
        );
        return;
      }

      const originalLabel = submitButton.textContent;
      submitButton.disabled = true;
      submitButton.textContent = "กำลังส่ง...";

      try {
        const payload = buildSubmitPayload(data, reviewedBy);
        const result = await submitToFlow2a(payload);

        statusPill.textContent = "PENDING REVIEW";
        statusPill.classList.remove("status-draft", "status-approved");
        statusPill.classList.add("status-pending");

        window.alert(
          "ส่งขออนุมัติสำเร็จ! Manager จะได้รับแจ้งเตือนเพื่อพิจารณาต่อไป" +
            (result?.message ? `\n\n${result.message}` : "")
        );
      } catch (error) {
        console.error(error);
        window.alert(`ส่งขออนุมัติไม่สำเร็จ: ${error.message}`);
      } finally {
        submitButton.disabled = false;
        submitButton.textContent = originalLabel;
      }
    });
  }

  loadAndRenderDraft();
}

document.addEventListener("DOMContentLoaded", initReviewPage);
