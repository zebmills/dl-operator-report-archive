import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";

const root = process.cwd();
const workspace = path.resolve(root, "../../..");
const localSourceDir = path.join(root, "source");
const workspaceReportDir = path.join(workspace, "reports", "operator-stack-web-archive");
const workspaceDashboardDir = path.join(workspace, "reports", "operator-stack-dashboard");
const distDir = path.join(root, "dist");
const workerDir = path.join(root, ".open-next");
const workerPath = path.join(workerDir, "worker.js");

const reportDate = process.env.OPERATOR_STACK_REPORT_DATE || "";
const dashboardDate = process.env.OPERATOR_STACK_DASHBOARD_DATE || "";
const reportFilename = reportDate
  ? `dl-operator-report-${reportDate}.html`
  : "";
const dashboardFilename = dashboardDate
  ? `dl-operator-dashboard-${dashboardDate}.html`
  : "";

async function artifactFiles(reportDir, pattern) {
  const { readdir } = await import("node:fs/promises");
  return (await readdir(reportDir))
    .filter((name) => pattern.test(name))
    .sort();
}

async function findLatestArtifact({ localPattern, workspaceDir, workspacePattern, requestedFilename, label, prefix }) {
  const localFiles = await artifactFiles(localSourceDir, localPattern).catch(() => []);
  const workspaceFiles = await artifactFiles(workspaceDir, workspacePattern).catch(() => []);
  const candidates = [
    ...localFiles.map((filename) => ({ filename, dir: localSourceDir })),
    ...workspaceFiles.map((filename) => ({ filename, dir: workspaceDir })),
  ];
  if (candidates.length === 0) {
    throw new Error(`No protected ${label} HTML files found in ${localSourceDir} or ${workspaceDir}`);
  }
  const selected = requestedFilename || candidates.map((item) => item.filename).sort().at(-1);
  const candidate = candidates
    .filter((item) => item.filename === selected)
    .sort((a, b) => Number(a.dir === workspaceDir) - Number(b.dir === workspaceDir))
    .at(-1);
  if (!candidate) {
    throw new Error(`Requested ${label} ${selected} was not found in ${localSourceDir} or ${workspaceDir}`);
  }
  return {
    filename: selected,
    date: selected.replace(prefix, "").replace(".html", ""),
    html: await readFile(path.join(candidate.dir, selected), "utf8"),
  };
}

function chunkString(value, size = 48 * 1024) {
  const chunks = [];
  for (let offset = 0; offset < value.length; offset += size) {
    chunks.push(value.slice(offset, offset + size));
  }
  return chunks;
}

const latest = await findLatestArtifact({
  localPattern: /^dl-operator-report-\d{4}-\d{2}-\d{2}\.html$/,
  workspaceDir: workspaceReportDir,
  workspacePattern: /^dl-operator-report-\d{4}-\d{2}-\d{2}\.html$/,
  requestedFilename: reportFilename,
  label: "operator report",
  prefix: "dl-operator-report-",
});
const latestDashboard = await findLatestArtifact({
  localPattern: /^dl-operator-dashboard-\d{4}-\d{2}-\d{2}\.html$/,
  workspaceDir: workspaceDashboardDir,
  workspacePattern: /^dl-operator-dashboard-\d{4}-\d{2}-\d{2}\.html$/,
  requestedFilename: dashboardFilename,
  label: "operator dashboard",
  prefix: "dl-operator-dashboard-",
});
const noIndex = '<meta name="robots" content="noindex, nofollow">';
if (!latest.html.includes(noIndex)) {
  throw new Error("Protected report shell is missing noindex/nofollow metadata.");
}
if (/Shopify revenue|Top Campaigns|Risk Flags|Paid spend/.test(latest.html)) {
  throw new Error("Protected report shell appears to contain plaintext report content.");
}
if (!latestDashboard.html.includes(noIndex)) {
  throw new Error("Protected dashboard shell is missing noindex/nofollow metadata.");
}
if (/Shopify revenue|Top Campaigns|Recommendations|Automation Health|Retargeting - Sales|Paid spend/.test(latestDashboard.html)) {
  throw new Error("Protected dashboard shell appears to contain plaintext dashboard content.");
}

await rm(distDir, { recursive: true, force: true });
await mkdir(distDir, { recursive: true });
await writeFile(path.join(distDir, "index.html"), latest.html);
await mkdir(path.join(distDir, latest.date), { recursive: true });
await writeFile(path.join(distDir, latest.date, "index.html"), latest.html);
await mkdir(path.join(distDir, "dashboard"), { recursive: true });
await writeFile(path.join(distDir, "dashboard", "index.html"), latestDashboard.html);
await mkdir(path.join(distDir, "dashboard", latestDashboard.date), { recursive: true });
await writeFile(path.join(distDir, "dashboard", latestDashboard.date, "index.html"), latestDashboard.html);
await writeFile(path.join(distDir, ".nojekyll"), "");

const worker = `const REPORT_DATE = ${JSON.stringify(latest.date)};
const DASHBOARD_DATE = ${JSON.stringify(latestDashboard.date)};
const REPORT_CHUNKS = ${JSON.stringify(chunkString(latest.html))};
const DASHBOARD_CHUNKS = ${JSON.stringify(chunkString(latestDashboard.html))};

function htmlStream(chunks) {
  const encoder = new TextEncoder();
  return new ReadableStream({
    start(controller) {
      for (const chunk of chunks) {
        controller.enqueue(encoder.encode(chunk));
      }
      controller.close();
    },
  });
}

function htmlResponse(chunks) {
  return new Response(htmlStream(chunks), {
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
      return new Response(JSON.stringify({ ok: true, report_date: REPORT_DATE, dashboard_date: DASHBOARD_DATE }), {
        headers: {
          "Content-Type": "application/json; charset=utf-8",
          "Cache-Control": "no-store",
          "X-Robots-Tag": "noindex, nofollow",
        },
      });
    }

    const datePath = "/" + REPORT_DATE;
    if (url.pathname === "/" || url.pathname === datePath || url.pathname === datePath + "/") {
      return htmlResponse(REPORT_CHUNKS);
    }

    const dashboardPath = "/dashboard";
    const dashboardDatePath = "/dashboard/" + DASHBOARD_DATE;
    if (
      url.pathname === dashboardPath ||
      url.pathname === dashboardPath + "/" ||
      url.pathname === dashboardDatePath ||
      url.pathname === dashboardDatePath + "/"
    ) {
      return htmlResponse(DASHBOARD_CHUNKS);
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

console.log(JSON.stringify({
  ok: true,
  report_date: latest.date,
  dashboard_date: latestDashboard.date,
  source: latest.filename,
  dashboard_source: latestDashboard.filename,
}, null, 2));
