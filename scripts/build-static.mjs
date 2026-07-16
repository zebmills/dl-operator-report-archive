import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";

const root = process.cwd();
const workspace = path.resolve(root, "../../..");
const localSourceDir = path.join(root, "source");
const workspaceReportDir = path.join(workspace, "reports", "operator-stack-web-archive");
const distDir = path.join(root, "dist");
const workerDir = path.join(root, ".open-next");
const workerPath = path.join(workerDir, "worker.js");

const reportDate = process.env.OPERATOR_STACK_REPORT_DATE || "";
const reportFilename = reportDate
  ? `dl-operator-report-${reportDate}.html`
  : "";

async function reportFiles(reportDir) {
  const { readdir } = await import("node:fs/promises");
  return (await readdir(reportDir))
    .filter((name) => /^dl-operator-report-\d{4}-\d{2}-\d{2}\.html$/.test(name))
    .sort();
}

async function findLatestReport() {
  let reportDir = localSourceDir;
  let files = await reportFiles(reportDir).catch(() => []);
  if (files.length === 0) {
    reportDir = workspaceReportDir;
    files = await reportFiles(reportDir);
  }
  if (files.length === 0) {
    throw new Error(`No protected operator report HTML files found in ${reportDir}`);
  }
  const selected = reportFilename || files[files.length - 1];
  if (!files.includes(selected)) {
    throw new Error(`Requested report ${selected} was not found in ${reportDir}`);
  }
  return {
    filename: selected,
    date: selected.replace("dl-operator-report-", "").replace(".html", ""),
    html: await readFile(path.join(reportDir, selected), "utf8"),
  };
}

function chunkString(value, size = 48 * 1024) {
  const chunks = [];
  for (let offset = 0; offset < value.length; offset += size) {
    chunks.push(value.slice(offset, offset + size));
  }
  return chunks;
}

const latest = await findLatestReport();
const noIndex = '<meta name="robots" content="noindex, nofollow">';
if (!latest.html.includes(noIndex)) {
  throw new Error("Protected report shell is missing noindex/nofollow metadata.");
}
if (/Shopify revenue|Top Campaigns|Risk Flags|Paid spend/.test(latest.html)) {
  throw new Error("Protected report shell appears to contain plaintext report content.");
}

await rm(distDir, { recursive: true, force: true });
await mkdir(distDir, { recursive: true });
await writeFile(path.join(distDir, "index.html"), latest.html);
await mkdir(path.join(distDir, latest.date), { recursive: true });
await writeFile(path.join(distDir, latest.date, "index.html"), latest.html);
await writeFile(path.join(distDir, ".nojekyll"), "");

const worker = `const REPORT_DATE = ${JSON.stringify(latest.date)};
const REPORT_CHUNKS = ${JSON.stringify(chunkString(latest.html))};

function htmlStream() {
  const encoder = new TextEncoder();
  return new ReadableStream({
    start(controller) {
      for (const chunk of REPORT_CHUNKS) {
        controller.enqueue(encoder.encode(chunk));
      }
      controller.close();
    },
  });
}

function reportResponse() {
  return new Response(htmlStream(), {
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      "Cache-Control": "no-store",
      "X-Robots-Tag": "noindex, nofollow",
    },
  });
}

export default {
  async fetch(request) {
    const url = new URL(request.url);

    if (url.pathname === "/healthz") {
      return new Response(JSON.stringify({ ok: true, report_date: REPORT_DATE }), {
        headers: {
          "Content-Type": "application/json; charset=utf-8",
          "Cache-Control": "no-store",
          "X-Robots-Tag": "noindex, nofollow",
        },
      });
    }

    const datePath = "/" + REPORT_DATE;
    if (url.pathname === "/" || url.pathname === datePath || url.pathname === datePath + "/") {
      return reportResponse();
    }

    return new Response("Not found", {
      status: 404,
      headers: {
        "Content-Type": "text/plain; charset=utf-8",
        "Cache-Control": "no-store",
        "X-Robots-Tag": "noindex, nofollow",
      },
    });
  },
};
`;

await rm(workerDir, { recursive: true, force: true });
await mkdir(workerDir, { recursive: true });
await writeFile(workerPath, worker);

console.log(JSON.stringify({ ok: true, report_date: latest.date, source: latest.filename }, null, 2));
