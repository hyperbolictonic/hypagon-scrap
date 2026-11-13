import { createServer } from "node:http";
import { existsSync } from "node:fs";
import { test } from "node:test";
import assert from "node:assert/strict";

import {
  CurlImpersonateTransport,
  curlImpersonateBinaryPath,
} from "../dist/index.js";

const binaryPath = curlImpersonateBinaryPath();
const available = existsSync(binaryPath);
const skip = available ? false : "run `npx hypagon-scrap-fetch-curl`";

const transport = available ? new CurlImpersonateTransport() : null;

function startServer() {
  const server = createServer((request, response) => {
    if (request.url === "/redirect") {
      response.writeHead(302, { location: "/final" });
      response.end();
      return;
    }
    if (request.url === "/slow") {
      return; // never responds
    }
    if (request.url === "/404") {
      response.writeHead(404, { "content-type": "text/plain" });
      response.end("missing");
      return;
    }
    if (request.url === "/echo") {
      const chunks = [];
      request.on("data", (chunk) => chunks.push(chunk));
      request.on("end", () => {
        response.writeHead(200, { "content-type": "application/json" });
        response.end(
          JSON.stringify({
            method: request.method,
            body: Buffer.concat(chunks).toString("utf8"),
            contentType: request.headers["content-type"] ?? null,
          }),
        );
      });
      return;
    }
    response.writeHead(200, { "content-type": "text/html; charset=utf-8" });
    response.end("<html><body><h1>ok</h1></body></html>");
  });

  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () =>
      resolve({ server, port: server.address().port }),
    );
  });
}

test("uses the vendored binary by default", { skip }, () => {
  assert.equal(transport.name, "curl-impersonate");
  assert.equal(transport.profile, "chrome131");
});

test("GET returns status, headers and body", { skip }, async () => {
  const { server, port } = await startServer();
  try {
    const response = await transport.request({ url: `http://127.0.0.1:${port}/` });
    assert.equal(response.status, 200);
    assert.match(response.headers["content-type"], /text\/html/);
    assert.match(Buffer.from(response.body).toString(), /<h1>ok<\/h1>/);
    assert.ok(response.elapsedMs >= 0);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test("POST forwards method, body and headers", { skip }, async () => {
  const { server, port } = await startServer();
  try {
    const response = await transport.request({
      url: `http://127.0.0.1:${port}/echo`,
      method: "POST",
      headers: { "content-type": "application/json" },
      body: '{"hello":"world"}',
    });
    assert.equal(response.status, 200);
    assert.deepEqual(JSON.parse(Buffer.from(response.body).toString()), {
      method: "POST",
      body: '{"hello":"world"}',
      contentType: "application/json",
    });
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test("follows redirects and reports the final URL", { skip }, async () => {
  const { server, port } = await startServer();
  try {
    const response = await transport.request({ url: `http://127.0.0.1:${port}/redirect` });
    assert.equal(response.status, 200);
    assert.match(response.url, /\/final$/);
    assert.match(Buffer.from(response.body).toString(), /<h1>ok<\/h1>/);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test("HTTP error statuses are returned, not thrown", { skip }, async () => {
  const { server, port } = await startServer();
  try {
    const response = await transport.request({ url: `http://127.0.0.1:${port}/404` });
    assert.equal(response.status, 404);
    assert.equal(Buffer.from(response.body).toString(), "missing");
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test("HEAD returns headers with an empty body", { skip }, async () => {
  const { server, port } = await startServer();
  try {
    const response = await transport.request({
      url: `http://127.0.0.1:${port}/`,
      method: "HEAD",
    });
    assert.equal(response.status, 200);
    assert.equal(response.body.byteLength, 0);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test("times out", { skip }, async () => {
  const { server, port } = await startServer();
  try {
    await assert.rejects(
      transport.request({ url: `http://127.0.0.1:${port}/slow`, timeoutMs: 300 }),
      /exited with 28|timed out/i,
    );
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test("explains a missing binary instead of failing obscurely", async () => {
  const broken = new CurlImpersonateTransport({
    binaryPath: "C:/definitely/not/here/curl-impersonate.exe",
  });
  await assert.rejects(broken.request({ url: "http://127.0.0.1:1/" }), /not found.*hypagon-scrap-fetch-curl/is);
});
