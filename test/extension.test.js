// Lädt den Thunderbird-seitigen Code mit einer nachgebauten messenger-API.
// Ersetzt keinen Test in Thunderbird, fängt aber Pfad-, Import- und Formfehler ab.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, writeFileSync, mkdtempSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
import * as PDFLib from "pdf-lib";

const root = new URL("..", import.meta.url).pathname;
const listeners = {};
const on = (name) => ({ addListener: (fn) => { listeners[name] = fn; } });

async function pdfBytes() {
  const doc = await PDFLib.PDFDocument.create();
  doc.addPage();
  return await doc.save();
}

const jpeg = readFileSync(join(root, "test/fixtures/orient-6.jpg"));
const fetchedParts = [];
const eml = "From: a@example.org\r\nSubject: Test\r\n\r\nHallo\r\n";
const header = {
  id: 42,
  subject: "Test / mit: Sonderzeichen",
  author: "Anna <a@example.org>",
  recipients: ["b@example.org"],
  ccList: [],
  date: new Date(2026, 8, 23, 0, 30), // kurz nach Mitternacht Ortszeit
};

globalThis.self = globalThis;
globalThis.messenger = {
  runtime: {
    onInstalled: on("onInstalled"),
    getURL: (p) => new URL(`src/${p}`, `file://${root}`).href,
    openOptionsPage: async () => {},
  },
  menus: { create: () => {}, onClicked: on("menus.onClicked") },
  messageDisplayAction: { onClicked: on("messageDisplayAction.onClicked") },
  messageDisplay: { getDisplayedMessages: async () => ({ id: null, messages: [header] }) },
  notifications: { create: async () => {} },
  permissions: { contains: async () => true },
  storage: { local: { get: async (d) => d, set: async () => {} } },
  messages: {
    continueList: async () => { throw new Error("nicht erwartet"); },
    getRaw: async (_id, opts) => {
      assert.equal(opts.data_format, "File");
      return new File([eml], "raw.eml");
    },
    listInlineTextParts: async () => [{ contentType: "text/plain", content: "Hallo Welt" }],
    listAttachments: async () => [
      { name: "beleg.pdf", contentType: "application/pdf", partName: "1.2", size: 500 },
      { name: "liste.xlsx", contentType: "application/octet-stream", partName: "1.3", size: 900 },
      { name: "foto.jpg", contentType: "image/jpeg", partName: "1.4", size: jpeg.length },
      { name: "logo.png", contentType: "image/png", partName: "1.5", size: 3000, contentDisposition: "inline", contentId: "logo@x" },
      { name: "alt.pdf", contentType: "application/pdf", partName: "1.6", size: 500, type: "deleted" },
    ],
    getAttachmentFile: async (_id, partName) => {
      fetchedParts.push(partName);
      if (partName === "1.4") return new File([jpeg], "foto.jpg");
      return new File([await pdfBytes()], "beleg.pdf");
    },
  },
};

test("background.js lädt und registriert alle Listener", async () => {
  await import("../src/background.js");
  assert.equal(typeof self.PDFLib?.PDFDocument, "function");
  assert.equal(typeof self.fontkit?.create, "function");
  for (const name of ["onInstalled", "menus.onClicked", "messageDisplayAction.onClicked"]) {
    assert.equal(typeof listeners[name], "function", name);
  }
});

test("collectMail + buildMailPdf ergeben ein PDF mit .eml", async () => {
  const { collectMail } = await import("../src/lib/mail.js");
  const { buildMailPdf } = await import("../src/lib/pdf.js");
  const fontkit = (await import("@pdf-lib/fontkit")).default;

  const mail = await collectMail(header);
  assert.equal(mail.pdfFilename, "2026-09-23 Test _ mit_ Sonderzeichen.pdf");
  assert.equal(mail.bodyText, "Hallo Welt");
  assert.ok(mail.attachments[0].bytes);
  assert.equal(mail.attachments[1].bytes, undefined);
  // PDF und Foto werden geladen; xlsx, Inline-Logo und gelöschter Anhang nicht.
  assert.deepEqual(fetchedParts, ["1.2", "1.4"]);
  assert.equal(mail.attachments[3].inline, true);

  const bytes = await buildMailPdf(mail, {
    PDFLib,
    fontkit,
    fonts: {
      regular: readFileSync(join(root, "src/fonts/DejaVuSans.ttf")),
      bold: readFileSync(join(root, "src/fonts/DejaVuSans-Bold.ttf")),
    },
  });
  const file = join(mkdtempSync(join(tmpdir(), "thunder-ngx-")), "out.pdf");
  writeFileSync(file, bytes);
  assert.match(execFileSync("pdfdetach", ["-list", file], { encoding: "utf8" }), /2026-09-23 Test _ mit_ Sonderzeichen\.eml/);
  assert.match(execFileSync("pdfinfo", [file], { encoding: "utf8" }), /Pages:\s+3/);
});
