import { EventEmitter } from "node:events";
import { test } from "node:test";
import assert from "node:assert/strict";

import { ElectronNetTransport, createElectronNetTransport } from "../dist/index.js";

function fakeNet(respond) {
  const calls = [];
  return {
    calls,
    request(options) {
      calls.push(options);
      const client = new EventEmitter();
      client.headers = {};
      client.written = [];
      client.setHeader = (name, value) => {
        client.headers[name] = value;
      };
      client.write = (chunk) => {
        client.written.push(chunk);
      };
      client.abort = () => {
        client.aborted = true;
        client.emit("error", new Error("aborted"));
      };
      client.end = () => respond(client, options);
      return client;
    },
  };
}

test("maps request options, headers and body; collects the response", async () => {
  let captured;
  const net = fakeNet((client) => {
    captured = client;
    const response = new EventEmitter();
    response.statusCode = 201;
    response.headers = { "content-type": ["text/html"], "x-single": "yes" };
    client.emit("response", response);
    response.emit("data", Buffer.from("<p>hi"));
    response.emit("data", Buffer.from("</p>"));
    response.emit("end");
  });

  const transport = new ElectronNetTransport(net);
  const response = await transport.request({
    url: "https://example.com/x",
    method: "POST",
    headers: { accept: "text/html" },
    body: "q=1",
  });

  assert.equal(transport.name, "electron-net");
  assert.equal(response.status, 201);
  assert.equal(Buffer.from(response.body).toString(), "<p>hi</p>");
  assert.equal(response.headers["content-type"], "text/html");
  assert.equal(response.headers["x-single"], "yes");
  assert.ok(response.elapsedMs >= 0);

  assert.equal(net.calls[0].url, "https://example.com/x");
  assert.equal(net.calls[0].method, "POST");
  assert.equal(captured.headers.accept, "text/html");
  assert.deepEqual(captured.written, ["q=1"]);
});

test("surfaces request errors", async () => {
  const net = fakeNet((client) => client.emit("error", new Error("boom")));
  await assert.rejects(
    new ElectronNetTransport(net).request({ url: "https://example.com" }),
    /boom/,
  );
});

test("aborts on timeout", async () => {
  let captured;
  const net = fakeNet((client) => {
    captured = client; // never responds
  });

  await assert.rejects(
    new ElectronNetTransport(net).request({ url: "https://example.com", timeoutMs: 10 }),
    /timed out/,
  );
  assert.equal(captured.aborted, true);
});

test("explains itself when Electron is not available", async () => {
  await assert.rejects(createElectronNetTransport(), /Electron is not available/);
});
