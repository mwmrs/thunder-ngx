// Testet die Rechteprüfung gegen nachgebaute Paperless-Antworten.
import { test } from "node:test";
import assert from "node:assert/strict";
import { testConnection } from "../src/lib/paperless.js";

const settings = { paperlessUrl: "http://rohan:8000/", apiToken: "t", tagIds: [], waitForResult: true };

/** routes: { "POST /api/documents/post_document/": status, ... } */
function fakeFetch(routes) {
  globalThis.fetch = async (url, init = {}) => {
    const key = `${init.method ?? "GET"} ${new URL(url).pathname}`;
    assert.equal(init.headers.Authorization, "Token t");
    assert.equal(init.credentials, "omit");
    const status = routes[key] ?? 404;
    return new Response("{}", { status, headers: { "X-Version": "3.2.1" } });
  };
}

test("alle Rechte vorhanden", async () => {
  fakeFetch({ "POST /api/documents/post_document/": 400, "GET /api/tasks/": 200 });
  assert.deepEqual(await testConnection(settings), { version: "3.2.1" });
});

test("ungültiger Token", async () => {
  fakeFetch({ "POST /api/documents/post_document/": 401 });
  await assert.rejects(testConnection(settings), /Token ungültig/);
});

test("Upload-Recht fehlt", async () => {
  fakeFetch({ "POST /api/documents/post_document/": 403 });
  await assert.rejects(testConnection(settings), /add_document/);
});

test("Task-Recht fehlt, wird aber nur beim Warten verlangt", async () => {
  fakeFetch({ "POST /api/documents/post_document/": 400, "GET /api/tasks/": 403 });
  await assert.rejects(testConnection(settings), /view_paperlesstask/);
  assert.deepEqual(await testConnection({ ...settings, waitForResult: false }), { version: "3.2.1" });
});
