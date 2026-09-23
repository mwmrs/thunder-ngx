import { test } from "node:test";
import assert from "node:assert/strict";
import { originPattern, parseTagIds } from "../src/lib/settings.js";

test("originPattern lässt den Port weg (Firefox kennt keine Ports in Match-Patterns)", () => {
  assert.equal(originPattern("http://rohan:8000"), "http://rohan/*");
  assert.equal(originPattern("https://paperless.example.org/"), "https://paperless.example.org/*");
  assert.equal(originPattern("http://192.168.1.5:8000/paperless/"), "http://192.168.1.5/*");
  assert.throws(() => originPattern("ftp://rohan"));
  assert.throws(() => originPattern("rohan:8000"));
});

test("parseTagIds", () => {
  assert.deepEqual(parseTagIds("3, 7 12;x,0"), [3, 7, 12]);
});
