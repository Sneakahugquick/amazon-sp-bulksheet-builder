import { createReadStream, existsSync, statSync } from "node:fs";
import { createServer } from "node:http";
import { extname, join, normalize, resolve, sep } from "node:path";
import process from "node:process";

function argument(name, fallback) {
  const index = process.argv.indexOf(name);
  return index >= 0 && process.argv[index + 1] ? process.argv[index + 1] : fallback;
}

const port = Number(argument("--port", "4173"));
const idleMinutes = Number(argument("--idle-minutes", "120"));
const root = resolve(new URL("./dist", import.meta.url).pathname.replace(/^\/(.:\/)/, "$1"));

if (!existsSync(root)) {
  console.error("找不到 dist 目录，请先运行 npm run build。");
  process.exit(1);
}

const mimeTypes = {
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
};

let idleTimer;
function resetIdleTimer() {
  if (!Number.isFinite(idleMinutes) || idleMinutes <= 0) return;
  clearTimeout(idleTimer);
  idleTimer = setTimeout(() => process.exit(0), idleMinutes * 60 * 1000);
  idleTimer.unref();
}

const server = createServer((request, response) => {
  resetIdleTimer();
  const requestUrl = new URL(request.url || "/", `http://${request.headers.host || "127.0.0.1"}`);
  if (requestUrl.pathname === "/__health") {
    response.writeHead(200, { "content-type": "application/json; charset=utf-8" });
    response.end(JSON.stringify({ ok: true, app: "amazon-sp-bulksheet-builder" }));
    return;
  }

  const requestedPath = requestUrl.pathname === "/"
    ? "index.html"
    : decodeURIComponent(requestUrl.pathname.replace(/^\/+/, ""));
  const filePath = normalize(join(root, requestedPath));
  if (filePath !== root && !filePath.startsWith(`${root}${sep}`)) {
    response.writeHead(403);
    response.end("Forbidden");
    return;
  }

  let resolvedPath = filePath;
  if (!existsSync(resolvedPath) || !statSync(resolvedPath).isFile()) {
    resolvedPath = join(root, "index.html");
  }
  response.writeHead(200, {
    "cache-control": "no-store",
    "content-type": mimeTypes[extname(resolvedPath).toLowerCase()] || "application/octet-stream",
  });
  createReadStream(resolvedPath).pipe(response);
});

server.listen(port, "127.0.0.1", () => {
  resetIdleTimer();
  console.log(`SP 批量广告表格生成器已启动：http://127.0.0.1:${port}`);
});

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => server.close(() => process.exit(0)));
}
