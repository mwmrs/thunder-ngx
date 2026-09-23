import { test } from "node:test";
import assert from "node:assert/strict";
import { originPattern, revokeOtherOrigins } from "../src/lib/settings.js";

test("originPattern lässt den Port weg (Firefox kennt keine Ports in Match-Patterns)", () => {
  assert.equal(originPattern("http://rohan:8000"), "http://rohan/*");
  assert.equal(originPattern("https://paperless.example.org/"), "https://paperless.example.org/*");
  assert.equal(originPattern("http://192.168.1.5:8000/paperless/"), "http://192.168.1.5/*");
  assert.throws(() => originPattern("ftp://rohan"));
  assert.throws(() => originPattern("rohan:8000"));
});

test("revokeOtherOrigins behält nur die aktuelle Adresse", async () => {
  let removed = null;
  globalThis.messenger = {
    permissions: {
      getAll: async () => ({
        permissions: ["messagesRead", "menus"],
        origins: ["http://rohan:8000/*", "http://rohan/*", "http://*/*", "https://alt.example/*"],
      }),
      remove: async ({ origins }) => { removed = origins; return true; },
    },
  };
  assert.deepEqual(await revokeOtherOrigins("http://rohan/*"), ["http://rohan:8000/*", "http://*/*", "https://alt.example/*"]);
  assert.deepEqual(removed, ["http://rohan:8000/*", "http://*/*", "https://alt.example/*"]);

  removed = null;
  globalThis.messenger.permissions.getAll = async () => ({ origins: ["http://rohan/*"] });
  assert.deepEqual(await revokeOtherOrigins("http://rohan/*"), []);
  assert.equal(removed, null, "nichts zu entfernen -> remove() nicht aufrufen");
});
