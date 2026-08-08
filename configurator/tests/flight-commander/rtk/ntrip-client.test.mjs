import assert from "node:assert/strict";
import net from "node:net";
import test from "node:test";

import {
  buildNtripRequest,
  buildNtripSourcetableRequest,
  fetchNtripSourcetable,
  NtripClient,
  NtripResponseDecoder,
} from "../../../js/main/ntripClient.js";

async function listen(server) {
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  return server.address().port;
}

async function closeServer(server) {
  await new Promise((resolve) => server.close(resolve));
}

test("NTRIP request selects the mountpoint and uses Basic authentication", () => {
  const request = buildNtripRequest({
    host: "caster.example.com",
    port: 2101,
    mountpoint: "/MY BASE",
    username: "pilot",
    password: "secret",
  }).toString("ascii");

  assert.match(request, /^GET \/MY%20BASE HTTP\/1\.1\r\n/);
  assert.match(request, /Host: caster\.example\.com:2101\r\n/);
  assert.match(request, /Ntrip-Version: Ntrip\/2\.0\r\n/);
  assert.match(request, /Authorization: Basic cGlsb3Q6c2VjcmV0\r\n/);
  assert.ok(request.endsWith("\r\n\r\n"));
});

test("NTRIP response decoder accepts an ICY stream split across chunks", () => {
  const received = [];
  const decoder = new NtripResponseDecoder({ onData: (data) => received.push(...data) });
  decoder.push(Buffer.from("ICY 200 OK\r\nServer: caster\r\n\r"));
  decoder.push(Buffer.from("\n\xd3\x00", "latin1"));
  decoder.push(Buffer.from("\x01\x42", "latin1"));
  assert.deepEqual(received, [0xd3, 0x00, 0x01, 0x42]);
});

test("NTRIP response decoder de-chunks HTTP/1.1 RTCM bodies", () => {
  const received = [];
  const decoder = new NtripResponseDecoder({ onData: (data) => received.push(...data) });
  decoder.push(Buffer.from(
    "HTTP/1.1 200 OK\r\nTransfer-Encoding: chunked\r\nContent-Type: gnss/data\r\n\r\n" +
    "2\r\n\xd3\x00\r\n3\r\n\x01\x02\x03\r\n0\r\n\r\n",
    "latin1",
  ));
  assert.deepEqual(received, [0xd3, 0x00, 0x01, 0x02, 0x03]);
});

test("NTRIP response decoder rejects authentication and mountpoint errors", () => {
  assert.throws(() => {
    const decoder = new NtripResponseDecoder();
    decoder.push(Buffer.from("HTTP/1.1 401 Unauthorized\r\n\r\n"));
  }, /status 401/);
  assert.throws(
    () => buildNtripRequest({ host: "https://caster.example.com", mountpoint: "MOUNT" }),
    /without http:\/\//,
  );
});

test("NTRIP sourcetable request uses the caster root without a mountpoint", () => {
  const request = buildNtripSourcetableRequest({
    host: "rtk2go.com",
    port: 2101,
  }).toString("ascii");
  assert.match(request, /^GET \/ HTTP\/1\.1\r\n/);
  assert.match(request, /Host: rtk2go\.com:2101\r\n/);
});

test("NTRIP response decoder accepts a sourcetable only when requested", () => {
  const received = [];
  const response = Buffer.from(
    "SOURCETABLE 200 OK\r\nContent-Type: text/plain\r\n\r\n" +
    "STR;BASE;Base;RTCM 3.2\r\nENDSOURCETABLE\r\n",
  );
  const decoder = new NtripResponseDecoder({
    allowSourcetable: true,
    onData: (data) => received.push(data),
  });
  decoder.push(response);
  assert.match(Buffer.concat(received).toString(), /STR;BASE/);
  assert.throws(() => new NtripResponseDecoder().push(response), /sourcetable instead/);
});

test("native NTRIP client discovers a caster and opens its RTCM stream", async () => {
  const requests = [];
  const server = net.createServer((socket) => {
    let request = "";
    socket.on("data", (data) => {
      request += data.toString("latin1");
      if (!request.includes("\r\n\r\n")) return;
      requests.push(request);
      if (request.startsWith("GET / HTTP/1.1")) {
        socket.end(
          "SOURCETABLE 200 OK\r\nContent-Type: text/plain\r\n\r\n" +
          "STR;FREE;Local free stream;RTCM 3.2;;;;;USA;40;-105;0;0;;none;N;N;9600;\r\n" +
          "ENDSOURCETABLE\r\n",
        );
      } else {
        socket.write(
          Buffer.concat([
            Buffer.from("ICY 200 OK\r\nServer: local-test\r\n\r\n", "ascii"),
            Buffer.from([0xd3, 0x00, 0x01, 0x42]),
          ]),
        );
        socket.on("end", () => socket.end());
      }
    });
  });
  const port = await listen(server);
  const received = [];
  const client = new NtripClient({
    emit(type, value) {
      if (type === "data") received.push(...value);
    },
  });
  try {
    const table = await fetchNtripSourcetable({ host: "127.0.0.1", port });
    assert.match(table, /STR;FREE/);
    await client.connect({ host: "127.0.0.1", port, mountpoint: "FREE" });
    assert.deepEqual(received, [0xd3, 0x00, 0x01, 0x42]);
    assert.match(requests[0], /^GET \/ HTTP\/1\.1/);
    assert.match(requests[1], /^GET \/FREE HTTP\/1\.1/);
  } finally {
    await client.close();
    await closeServer(server);
  }
});
