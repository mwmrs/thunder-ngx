// Testet die PDF-Erzeugung unter Node, ohne Thunderbird.
// Benötigt poppler-utils (pdftotext, pdfdetach, pdfinfo).
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, writeFileSync, mkdtempSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { tmpdir } from "node:os";
import { join } from "node:path";
import * as PDFLib from "pdf-lib";
import fontkit from "@pdf-lib/fontkit";

import { buildMailPdf } from "../src/lib/pdf.js";
import { wrapText } from "../src/lib/text.js";

const root = new URL("..", import.meta.url).pathname;
const fonts = {
  regular: readFileSync(join(root, "src/fonts/DejaVuSans.ttf")),
  bold: readFileSync(join(root, "src/fonts/DejaVuSans-Bold.ttf")),
};
const deps = { PDFLib, fontkit, fonts };
const dir = mkdtempSync(join(tmpdir(), "thunder-ngx-"));

async function attachmentPdf(text, pages) {
  const doc = await PDFLib.PDFDocument.create();
  const font = await doc.embedFont(PDFLib.StandardFonts.Helvetica);
  for (let i = 1; i <= pages; i++) doc.addPage().drawText(`${text} ${i}`, { x: 50, y: 700, font, size: 20 });
  return await doc.save();
}

const eml = "From: Jörg Müller <joerg@example.org>\r\nSubject: Rechnung\r\n\r\nHallo\r\n";

async function sampleMail() {
  return {
    subject: "Rechnung März – Größenänderung 😀",
    from: "Jörg Müller <joerg@example.org>",
    to: ["Meinolf <m@example.org>"],
    cc: [],
    date: new Date("2026-09-01T10:15:00Z"),
    bodyText:
      "Sehr geehrte Damen und Herren,\n\nanbei die Rechnung für Übergrößen. Grüße 😀\n\n" +
      "https://example.org/" + "a".repeat(300) + "\n" +
      "Lorem ipsum dolor sit amet. ".repeat(400),
    attachments: [
      { name: "rechnung.pdf", size: 12345, bytes: await attachmentPdf("ANHANGSEITE", 2) },
      { name: "kaputt.pdf", size: 10, bytes: new TextEncoder().encode("kein pdf") },
      { name: "tabelle.xlsx", size: 999 },
    ],
    eml: { name: "Rechnung.eml", bytes: new TextEncoder().encode(eml) },
  };
}

test("wrapText hält die Breite ein und bricht lange Wörter", async () => {
  const doc = await PDFLib.PDFDocument.create();
  doc.registerFontkit(fontkit);
  const font = await doc.embedFont(fonts.regular, { subset: true });
  const lines = wrapText("kurz " + "x".repeat(500) + " ende", font, 10, 200);
  assert.ok(lines.length > 3);
  for (const l of lines) assert.ok(font.widthOfTextAtSize(l, 10) <= 200, l);
  assert.equal(lines.join("").replace(/\s/g, ""), "kurz" + "x".repeat(500) + "ende");
});

test("PDF enthält Mailtext, Anhangsseiten und eingebettete .eml", async () => {
  const bytes = await buildMailPdf(await sampleMail(), deps);
  const file = join(dir, "out.pdf");
  writeFileSync(file, bytes);

  const text = execFileSync("pdftotext", ["-layout", file, "-"], { encoding: "utf8" });
  assert.match(text, /Rechnung März – Größenänderung/);
  assert.match(text, /Jörg Müller/);
  assert.match(text, /Übergrößen/);
  assert.match(text, /rechnung\.pdf .* angehängt, 2 Seiten/);
  assert.match(text, /kaputt\.pdf .* kein lesbares PDF/);
  assert.match(text, /tabelle\.xlsx .* nur in der Original-Mail/);
  assert.match(text, /ANHANGSEITE 1/);
  assert.match(text, /ANHANGSEITE 2/);

  // Anhangsseiten stehen hinter den Mailseiten
  const pagesText = text.split("\f");
  assert.match(pagesText[0], /Sehr geehrte/);
  assert.match(pagesText.at(-2), /ANHANGSEITE 2/);

  const list = execFileSync("pdfdetach", ["-list", file], { encoding: "utf8" });
  assert.match(list, /Rechnung\.eml/);
  execFileSync("pdfdetach", ["-save", "1", "-o", join(dir, "x.eml"), file]);
  assert.equal(readFileSync(join(dir, "x.eml"), "utf8"), eml);
});

test("gleiche Mail ergibt byte-identisches PDF", async () => {
  const hash = async () =>
    createHash("sha256").update(await buildMailPdf(await sampleMail(), deps)).digest("hex");
  assert.equal(await hash(), await hash());
});
