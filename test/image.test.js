// Testet Bildanhänge: Erkennung, EXIF-Drehung (pixelgenau über das gerenderte PDF)
// und das Aussortieren von Logos. Benötigt poppler-utils (pdftoppm, pdftotext, pdfinfo).
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, writeFileSync, mkdtempSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
import * as PDFLib from "pdf-lib";
import fontkit from "@pdf-lib/fontkit";

import { buildMailPdf } from "../src/lib/pdf.js";
import { readImageInfo } from "../src/lib/image.js";

const root = new URL("..", import.meta.url).pathname;
const fixture = (name) => new Uint8Array(readFileSync(join(root, "test/fixtures", name)));
const fonts = {
  regular: readFileSync(join(root, "src/fonts/DejaVuSans.ttf")),
  bold: readFileSync(join(root, "src/fonts/DejaVuSans-Bold.ttf")),
};
const dir = mkdtempSync(join(tmpdir(), "thunder-ngx-img-"));

test("readImageInfo erkennt Format, Größe und EXIF-Ausrichtung", () => {
  for (const o of [1, 2, 3, 6, 8]) {
    assert.deepEqual(readImageInfo(fixture(`orient-${o}.jpg`)), { type: "jpeg", width: 400, height: 200, orientation: o });
  }
  assert.deepEqual(readImageInfo(fixture("scan.png")), { type: "png", width: 240, height: 400, orientation: 1 });
  assert.equal(readImageInfo(new TextEncoder().encode("kein Bild")), null);
  assert.equal(readImageInfo(fixture("orient-1.jpg").slice(0, 100)), null); // abgeschnitten
});

/** Rendert eine PDF-Seite und liefert die Farbe (R/B/G/Y) an relativen Positionen. */
function sampleColors(pdfFile, pageNo, points) {
  const base = join(dir, `page-${pageNo}`);
  execFileSync("pdftoppm", ["-r", "30", "-f", String(pageNo), "-l", String(pageNo), "-singlefile", pdfFile, base]);
  const ppm = readFileSync(`${base}.ppm`);
  // Header: "P6\n<w> <h>\n255\n"
  const [, w, h] = ppm.toString("latin1", 0, 30).match(/^P6\s+(\d+)\s+(\d+)\s+255\s/);
  const headerLength = ppm.toString("latin1", 0, 30).match(/^P6\s+\d+\s+\d+\s+255\s/)[0].length;
  const palette = { R: [220, 30, 30], B: [30, 30, 220], G: [30, 200, 30], Y: [230, 220, 30] };
  return points.map(([fx, fy]) => {
    const i = headerLength + (Math.round(fy * h) * w + Math.round(fx * w)) * 3;
    const px = [ppm[i], ppm[i + 1], ppm[i + 2]];
    const dist = (c) => c.reduce((sum, v, k) => sum + (v - px[k]) ** 2, 0);
    return Object.entries(palette).sort((a, b) => dist(a[1]) - dist(b[1]))[0][0];
  });
}

function pageSize(pdfFile, pageNo) {
  const out = execFileSync("pdfinfo", ["-f", String(pageNo), "-l", String(pageNo), pdfFile], { encoding: "utf8" });
  const [, w, h] = out.match(/Page\s+\d+ size:\s+([\d.]+) x ([\d.]+)/);
  return Number(w) > Number(h) ? "quer" : "hoch";
}

test("Bilder werden richtig ausgerichtet angehängt, Logos aussortiert", async () => {
  const image = (name, extra = {}) => {
    const bytes = fixture(name);
    return { name, size: bytes.length, kind: "image", bytes, ...extra };
  };
  const mail = {
    subject: "Fotos",
    from: "a@example.org",
    to: ["b@example.org"],
    cc: [],
    date: new Date("2026-09-01T10:00:00Z"),
    bodyText: "Anbei die Fotos.",
    attachments: [
      image("orient-1.jpg"),
      image("orient-2.jpg"),
      image("orient-3.jpg"),
      image("orient-6.jpg"),
      image("orient-8.jpg"),
      image("scan.png"),
      image("logo.png"), // zu klein -> keine Seite
      image("orient-1.jpg", { name: "signatur.jpg", inline: true }), // Inline-Logo -> gar nicht aufgeführt
      image("orient-6.jpg", { name: "IMG_0001.jpeg", inline: true, size: 150 * 1024 }), // iPhone-Foto
      { name: "bild.heic", size: 50_000, kind: null }, // nicht unterstützt
    ],
    eml: { name: "Fotos.eml", bytes: new TextEncoder().encode("Subject: Fotos\r\n\r\n") },
  };
  const file = join(dir, "bilder.pdf");
  writeFileSync(file, await buildMailPdf(mail, { PDFLib, fontkit, fonts }));

  const text = execFileSync("pdftotext", ["-layout", "-f", "1", "-l", "1", file, "-"], { encoding: "utf8" });
  assert.match(text, /orient-6\.jpg .* als Bild angehängt/);
  assert.match(text, /scan\.png .* als Bild angehängt/);
  assert.match(text, /logo\.png .* sehr klein/);
  assert.match(text, /IMG_0001\.jpeg .* als Bild angehängt/);
  assert.match(text, /bild\.heic .* nur in der Original-Mail/);
  assert.doesNotMatch(text, /signatur\.jpg/);

  // Seite 1: Mail; danach je Bild eine Seite, Logos ohne Seite.
  assert.match(execFileSync("pdfinfo", [file], { encoding: "utf8" }), /Pages:\s+8/);

  // Abtastpunkte: Quadranten oben links, oben rechts, unten links, unten rechts
  const quadrants = [[0.35, 0.35], [0.65, 0.35], [0.35, 0.65], [0.65, 0.65]];
  // Gespeichert: oben links rot, oben rechts blau, unten links grün, unten rechts gelb.
  const expected = {
    2: ["quer", ["R", "B", "G", "Y"]], // 1: unverändert
    3: ["quer", ["B", "R", "Y", "G"]], // 2: horizontal gespiegelt
    4: ["quer", ["Y", "G", "B", "R"]], // 3: 180°
    5: ["hoch", ["G", "R", "Y", "B"]], // 6: 90° im Uhrzeigersinn
    6: ["hoch", ["B", "Y", "R", "G"]], // 8: 90° gegen den Uhrzeigersinn
    8: ["hoch", ["G", "R", "Y", "B"]], // iPhone-Foto (Ausrichtung 6)
  };
  for (const [pageNo, [format, colors]] of Object.entries(expected)) {
    assert.equal(pageSize(file, pageNo), format, `Seite ${pageNo}: Format`);
    assert.deepEqual(sampleColors(file, pageNo, quadrants), colors, `Seite ${pageNo}: Ausrichtung`);
  }
  // PNG hochkant: oben grün, unten gelb
  assert.equal(pageSize(file, 7), "hoch");
  assert.deepEqual(sampleColors(file, 7, [[0.5, 0.3], [0.5, 0.7]]), ["G", "Y"]);
});

test("Original-JPEG-Daten landen unverändert im PDF", async () => {
  const jpeg = fixture("orient-6.jpg");
  const bytes = await buildMailPdf(
    {
      subject: "x", from: "", to: [], cc: [], date: new Date(0), bodyText: "",
      attachments: [{ name: "foto.jpg", size: jpeg.length, kind: "image", bytes: jpeg }],
      eml: { name: "x.eml", bytes: new Uint8Array([1]) },
    },
    { PDFLib, fontkit, fonts },
  );
  const haystack = Buffer.from(bytes);
  assert.ok(haystack.includes(Buffer.from(jpeg)), "JPEG-Bytes 1:1 im PDF enthalten");
});

test("defekte Bilder und Anhänge verhindern nie das PDF", async () => {
  // gültiger Anfang, aber abgeschnittenes SOF-Segment
  const truncatedSof = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x04, 0x00, 0x00, 0xff, 0xc0, 0x00, 0x02]);
  assert.equal(readImageInfo(truncatedSof), null);

  const throwing = { name: "boese.pdf", size: 1, kind: "pdf", get bytes() { throw new Error("kaputt"); } };
  const file = join(dir, "defekt.pdf");
  writeFileSync(file, await buildMailPdf(
    {
      subject: "Defekt", from: "", to: [], cc: [], date: new Date(0), bodyText: "",
      attachments: [
        { name: "abgeschnitten.jpg", size: 20_000, kind: "image", bytes: truncatedSof },
        throwing,
        { name: "ok.jpg", size: 48_000, kind: "image", bytes: fixture("orient-1.jpg") },
      ],
      eml: { name: "x.eml", bytes: new Uint8Array([1]) },
    },
    { PDFLib, fontkit, fonts },
  ));
  const text = execFileSync("pdftotext", ["-layout", "-f", "1", "-l", "1", file, "-"], { encoding: "utf8" });
  assert.match(text, /abgeschnitten\.jpg .* kein lesbares JPEG\/PNG/);
  assert.match(text, /boese\.pdf .* nicht verarbeitbar/);
  assert.match(text, /ok\.jpg .* als Bild angehängt/);
});

test("gleiche Mail mit Bildern ergibt byte-identisches PDF", async () => {
  const build = () => buildMailPdf(
    {
      subject: "x", from: "", to: [], cc: [], date: new Date(0), bodyText: "",
      attachments: [
        { name: "a.jpg", size: 48_000, kind: "image", bytes: fixture("orient-6.jpg") },
        { name: "b.png", size: 190_000, kind: "image", bytes: fixture("scan.png") },
      ],
      eml: { name: "x.eml", bytes: new Uint8Array([1]) },
    },
    { PDFLib, fontkit, fonts },
  );
  assert.deepEqual(Buffer.from(await build()), Buffer.from(await build()));
});

test("die mitgelieferte pdf-lib (src/vendor) kann Bilder ausgerichtet zeichnen", async () => {
  globalThis.self ??= globalThis;
  await import("../src/vendor/pdf-lib.min.js");
  const bytes = await buildMailPdf(
    {
      subject: "x", from: "", to: [], cc: [], date: new Date(0), bodyText: "",
      attachments: [{ name: "a.jpg", size: 48_000, kind: "image", bytes: fixture("orient-6.jpg") }],
      eml: { name: "x.eml", bytes: new Uint8Array([1]) },
    },
    { PDFLib: self.PDFLib, fontkit, fonts },
  );
  const file = join(dir, "vendor.pdf");
  writeFileSync(file, bytes);
  assert.deepEqual(sampleColors(file, 2, [[0.35, 0.35], [0.65, 0.35], [0.35, 0.65], [0.65, 0.65]]), ["G", "R", "Y", "B"]);
});
