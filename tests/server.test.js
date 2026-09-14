import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { request } from "node:http";
import { createServer, connect } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

async function reservePort() {
  const server = createServer();
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  const port = typeof address === "object" && address ? address.port : 0;
  await new Promise((resolve) => server.close(resolve));
  return port;
}

function waitForReady(child) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("server startup timed out")), 5000);
    child.once("exit", (code) => {
      clearTimeout(timer);
      reject(new Error(`server exited before ready: ${code}`));
    });
    child.stdout.on("data", (chunk) => {
      if (!String(chunk).includes("已启动")) return;
      clearTimeout(timer);
      resolve();
    });
  });
}

function rawRequest(port, path) {
  return new Promise((resolve, reject) => {
    const socket = connect(port, "127.0.0.1");
    let response = "";
    socket.setEncoding("utf8");
    socket.on("connect", () => socket.end(`GET ${path} HTTP/1.1\r\nHost: attacker.invalid\r\nConnection: close\r\n\r\n`));
    socket.on("data", (chunk) => { response += chunk; });
    socket.on("end", () => resolve(response));
    socket.on("error", reject);
  });
}

function healthRequest(port) {
  return new Promise((resolve, reject) => {
    const req = request({ host: "127.0.0.1", port, path: "/__health" }, (response) => {
      let body = "";
      response.setEncoding("utf8");
      response.on("data", (chunk) => { body += chunk; });
      response.on("end", () => resolve({ status: response.statusCode, body }));
    });
    req.on("error", reject);
    req.end();
  });
}

test("malformed local request paths return 400 without terminating the preview server", async () => {
  const root = await mkdtemp(join(tmpdir(), "amazon-sp-server-test-"));
  const port = await reservePort();
  await writeFile(join(root, "index.html"), "<!doctype html><title>test</title>", "utf8");
  const child = spawn(process.execPath, [
    new URL("../server.mjs", import.meta.url).pathname.replace(/^\/(.:\/)/, "$1"),
    "--root", root,
    "--port", String(port),
    "--idle-minutes", "0",
  ], { stdio: ["ignore", "pipe", "pipe"] });

  try {
    await waitForReady(child);
    assert.match(await rawRequest(port, "/%"), /^HTTP\/1\.1 400 /);
    assert.match(await rawRequest(port, "/%00"), /^HTTP\/1\.1 400 /);
    assert.equal(child.exitCode, null);
    const health = await healthRequest(port);
    assert.equal(health.status, 200);
    assert.deepEqual(JSON.parse(health.body), { ok: true, app: "amazon-sp-bulksheet-builder" });
  } finally {
    child.kill("SIGTERM");
    await new Promise((resolve) => child.once("exit", resolve));
    await rm(root, { recursive: true, force: true });
  }
});
