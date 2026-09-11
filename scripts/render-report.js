"use strict";

const { chromium } = require("playwright");
const http = require("http");
const fs = require("fs");
const path = require("path");

const ROOT_DIR = path.resolve(__dirname, "..");
const OUTPUT_DIR = path.join(ROOT_DIR, "output");

const PUBLISH_OUTPUT =
  String(process.env.PUBLISH_OUTPUT || "").toLowerCase() === "true";

const HOST = "127.0.0.1";
const PORT = 4173;
const REPORT_URL = `http://${HOST}:${PORT}/index.html`;

const requestedFormat = String(
  process.argv[2] || "all"
).toLowerCase();

const validFormats = ["png", "pdf", "all"];

if (!validFormats.includes(requestedFormat)) {
  console.error(
    `Invalid format: ${requestedFormat}. Use png, pdf, or all.`
  );

  process.exit(1);
}

const mimeTypes = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".svg": "image/svg+xml",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".ttf": "font/ttf",
  ".otf": "font/otf"
};

function getMimeType(filePath) {
  const extension = path.extname(filePath).toLowerCase();

  return mimeTypes[extension] || "application/octet-stream";
}

function resolveRequestPath(requestUrl) {
  const url = new URL(
    requestUrl,
    `http://${HOST}:${PORT}`
  );

  let pathname = decodeURIComponent(url.pathname);

  if (pathname === "/") {
    pathname = "/index.html";
  }

  const resolvedPath = path.resolve(
    ROOT_DIR,
    `.${pathname}`
  );

  const relativePath = path.relative(
    ROOT_DIR,
    resolvedPath
  );

  if (
    relativePath.startsWith("..") ||
    path.isAbsolute(relativePath)
  ) {
    return null;
  }

  return resolvedPath;
}

function createStaticServer() {
  return http.createServer((request, response) => {
    const filePath = resolveRequestPath(request.url);

    if (!filePath) {
      response.writeHead(403, {
        "Content-Type": "text/plain; charset=utf-8"
      });

      response.end("Forbidden");
      return;
    }

    fs.stat(filePath, (statError, stats) => {
      if (statError || !stats.isFile()) {
        response.writeHead(404, {
          "Content-Type": "text/plain; charset=utf-8"
        });

        response.end("File not found");
        return;
      }

      response.writeHead(200, {
        "Content-Type": getMimeType(filePath),
        "Cache-Control": "no-store"
      });

      const stream = fs.createReadStream(filePath);

      stream.on("error", (streamError) => {
        console.error(
          `File stream error: ${streamError.message}`
        );

        if (!response.headersSent) {
          response.writeHead(500);
        }

        response.end();
      });

      stream.pipe(response);
    });
  });
}

function startServer(server) {
  return new Promise((resolve, reject) => {
    server.once("error", reject);

    server.listen(PORT, HOST, () => {
      console.log(`Local report server: ${REPORT_URL}`);
      resolve();
    });
  });
}

function stopServer(server) {
  return new Promise((resolve) => {
    if (!server.listening) {
      resolve();
      return;
    }

    server.close(() => resolve());
  });
}

async function ensureReportReady(page) {
  await page.goto(REPORT_URL, {
    waitUntil: "networkidle",
    timeout: 60000
  });

  await page.waitForFunction(
    () => {
      return (
        document.body.dataset.renderStatus === "ready" ||
        document.body.dataset.renderStatus === "error"
      );
    },
    null,
    {
      timeout: 60000
    }
  );

  const renderStatus = await page.evaluate(() => {
    return document.body.dataset.renderStatus;
  });

  if (renderStatus === "error") {
    const errorText = await page
      .locator(".error")
      .innerText()
      .catch(() => "Unknown report rendering error");

    throw new Error(errorText);
  }

  await page.evaluate(async () => {
    if (document.fonts?.ready) {
      await document.fonts.ready;
    }

    const images = Array.from(document.images);

    await Promise.all(
      images.map((image) => {
        if (image.complete) {
          return Promise.resolve();
        }

        return new Promise((resolve) => {
          image.addEventListener(
            "load",
            resolve,
            { once: true }
          );

          image.addEventListener(
            "error",
            resolve,
            { once: true }
          );
        });
      })
    );
  });

  const missingImages = await page.evaluate(() => {
    return Array.from(document.images)
      .filter((image) => {
        return !image.complete || image.naturalWidth === 0;
      })
      .map((image) => image.getAttribute("src"));
  });

  if (missingImages.length > 0) {
    throw new Error(
      `Images failed to load: ${missingImages.join(", ")}`
    );
  }

  const reportStatus = await page.evaluate(() => {
    return window.ReportRenderer?.getCurrentData?.()?.status ?? null;
  });

  const allowUnapproved =
    String(process.env.ALLOW_UNAPPROVED_RENDER || "").toLowerCase() ===
    "true";

  if (reportStatus !== "approved" && !allowUnapproved) {
    throw new Error(
      `Render blocked: report status is "${reportStatus ?? "unknown"}", ` +
        `not "approved". Analyst must approve the report before rendering. ` +
        `(Set ALLOW_UNAPPROVED_RENDER=true to bypass for testing.)`
    );
  }

  console.log(`Report status check passed: ${reportStatus ?? "bypassed"}`);
  
  console.log("Report, images, and fonts are ready.");
}

async function createPng(page) {
  const outputPath = path.join(
    OUTPUT_DIR,
    "monthly-esg-report.png"
  );

  const report = page.locator("#report");

  await report.screenshot({
    path: outputPath,
    type: "png",
    animations: "disabled"
  });

  console.log(`PNG created: ${outputPath}`);

  if (PUBLISH_OUTPUT) {
    const draftPreviewPath = path.join(
      OUTPUT_DIR,
      "draft-preview.png"
    );

    fs.copyFileSync(outputPath, draftPreviewPath);
    console.log(`Draft preview copy created: ${draftPreviewPath}`);
  }
}

async function createPdf(page) {
  const outputPath = path.join(
    OUTPUT_DIR,
    "monthly-esg-report.pdf"
  );

  await page.emulateMedia({
    media: "print"
  });

  await page.pdf({
    path: outputPath,
    format: "A3",
    landscape: false,
    printBackground: true,
    preferCSSPageSize: true,
    margin: {
      top: "0mm",
      right: "0mm",
      bottom: "0mm",
      left: "0mm"
    }
  });

  console.log(`PDF created: ${outputPath}`);
}

async function main() {
  fs.mkdirSync(OUTPUT_DIR, {
    recursive: true
  });

  const server = createStaticServer();
  let browser;

  try {
    await startServer(server);

    browser = await chromium.launch({
      headless: true
    });

    const context = await browser.newContext({
      viewport: {
        width: 1500,
        height: 2100
      },
      deviceScaleFactor: 1,
      locale: "th-TH",
      colorScheme: "light"
    });

    const page = await context.newPage();

    page.on("console", (message) => {
      const type = message.type();

      if (type === "error" || type === "warning") {
        console.log(
          `[Browser ${type}] ${message.text()}`
        );
      }
    });

    page.on("pageerror", (error) => {
      console.error(
        `[Browser page error] ${error.message}`
      );
    });

    page.on("requestfailed", (request) => {
      console.error(
        `[Request failed] ${request.url()}`
      );
    });

    await ensureReportReady(page);

    if (
      requestedFormat === "png" ||
      requestedFormat === "all"
    ) {
      await createPng(page);
    }

    if (
      requestedFormat === "pdf" ||
      requestedFormat === "all"
    ) {
      await createPdf(page);
    }

    await context.close();

    console.log(
      `Render completed successfully: ${requestedFormat}`
    );
  } catch (error) {
    console.error(`Render failed: ${error.message}`);
    process.exitCode = 1;
  } finally {
    if (browser) {
      await browser.close();
    }

    await stopServer(server);
  }
}

main();
