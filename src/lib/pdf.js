// Baut aus einer Mail ein einziges PDF:
//   1. Mailseite(n) mit Kopfdaten, Anhangsübersicht und Mailtext
//   2. dahinter die Seiten aller PDF-Anhänge und JPEG/PNG-Bilder (je eine Seite),
//      in der Reihenfolge der Anhänge
//   3. die Original-Mail als eingebettete .eml-Datei
//
// Die Funktion ist frei von Thunderbird-APIs, damit sie auch unter Node testbar ist.

import { formatBytes, formatDate, wrapText } from "./text.js";
import { IMAGE_LIMITS, orientationMatrix, readImageInfo, swapsAxes } from "./image.js";

const PAGE_WIDTH = 595.28; // A4
const PAGE_HEIGHT = 841.89;
const MARGIN = 50;
const CONTENT_WIDTH = PAGE_WIDTH - 2 * MARGIN;
const LABEL_WIDTH = 62;
const LEADING = 1.35;
const SIZE = { subject: 15, header: 9.5, body: 10, footer: 7.5 };
const IMAGE_MARGIN = 36;
const CAPTION_SPACE = 16;

/**
 * @param {object} mail
 * @param {string} mail.subject
 * @param {string} mail.from
 * @param {string[]} mail.to
 * @param {string[]} mail.cc
 * @param {Date} mail.date
 * @param {string} mail.bodyText
 * @param {{name: string, size: number, kind?: "pdf" | "image", inline?: boolean, bytes?: Uint8Array}[]} mail.attachments
 *        kind: erkannter Typ; inline: im Mailtext eingebettetes Bild (beliebiges Format, Content-ID);
 *        bytes nur bei Anhängen, die eingebunden werden sollen
 * @param {{name: string, bytes: Uint8Array}} mail.eml
 * @param {object} deps  { PDFLib, fontkit, fonts: { regular, bold } } (Font-Bytes als TTF)
 * @returns {Promise<Uint8Array>}
 */
export async function buildMailPdf(mail, { PDFLib, fontkit, fonts }) {
  const { PDFDocument, rgb } = PDFLib;
  const date = mail.date ?? new Date();

  const pdf = await PDFDocument.create({ updateMetadata: false });
  pdf.registerFontkit(fontkit);
  const regular = await pdf.embedFont(fonts.regular, { subset: true });
  const bold = await pdf.embedFont(fonts.bold, { subset: true });

  // 1. Anhänge zuerst übernehmen, damit die Übersicht auf der Mailseite
  //    den tatsächlichen Status (übernommen / fehlgeschlagen) anzeigen kann.
  const attachmentLines = [];
  for (const att of mail.attachments) {
    // Kleine, im Mailtext eingebettete Bilder (Signatur-Logos) gehören zum Mailtext.
    if (att.inline && att.size < IMAGE_LIMITS.inlineMinBytes) continue;

    const label = `${att.name} (${formatBytes(att.size)})`;
    let status;
    try {
      if (!att.bytes) status = "nur in der Original-Mail";
      else if (att.kind === "image") status = await addImagePage(pdf, att, { PDFLib, font: regular });
      else status = await addPdfPages(pdf, att, PDFDocument);
    } catch (err) {
      // Ein defekter Anhang darf nie die ganze Mail verhindern.
      console.warn(`thunder-ngx: Anhang ${att.name} nicht übernommen`, err);
      status = "nicht verarbeitbar, nur in der Original-Mail";
    }
    attachmentLines.push(`${label} – ${status}`);
  }

  // 2. Mailseiten vorne einfügen.
  const footer = `Original-Mail eingebettet als Dateianhang: ${mail.eml.name}`;
  let pageIndex = 0;
  let page = null;
  let y = 0;

  const newPage = () => {
    page = pdf.insertPage(pageIndex++, [PAGE_WIDTH, PAGE_HEIGHT]);
    y = PAGE_HEIGHT - MARGIN;
    page.drawText(footer, {
      x: MARGIN, y: MARGIN / 2, size: SIZE.footer, font: regular, color: rgb(0.45, 0.45, 0.45),
    });
  };
  const advance = (lineHeight) => {
    if (!page || y - lineHeight < MARGIN) newPage();
    y -= lineHeight;
  };
  const drawLines = (lines, { font, size, x = MARGIN, color = rgb(0, 0, 0) }) => {
    for (const line of lines) {
      advance(size * LEADING);
      if (line) page.drawText(line, { x, y, size, font, color });
    }
  };
  const drawField = (label, values) => {
    const list = (Array.isArray(values) ? values : [values]).filter(Boolean);
    if (!list.length) return;
    const lines = list.flatMap((v) => wrapText(v, regular, SIZE.header, CONTENT_WIDTH - LABEL_WIDTH));
    advance(SIZE.header * LEADING);
    page.drawText(label, { x: MARGIN, y, size: SIZE.header, font: bold, color: rgb(0.3, 0.3, 0.3) });
    y += SIZE.header * LEADING; // erste Wertzeile auf gleiche Höhe wie das Label
    drawLines(lines, { font: regular, size: SIZE.header, x: MARGIN + LABEL_WIDTH });
  };

  drawLines(wrapText(mail.subject || "(ohne Betreff)", bold, SIZE.subject, CONTENT_WIDTH), {
    font: bold, size: SIZE.subject,
  });
  advance(6);
  drawField("Von:", mail.from);
  drawField("An:", mail.to);
  drawField("Cc:", mail.cc);
  drawField("Datum:", formatDate(date));
  drawField("Anhänge:", attachmentLines.map((l) => `• ${l}`));

  advance(10);
  page.drawLine({
    start: { x: MARGIN, y: y + 4 }, end: { x: PAGE_WIDTH - MARGIN, y: y + 4 },
    thickness: 0.5, color: rgb(0.6, 0.6, 0.6),
  });
  drawLines(wrapText(mail.bodyText || "(kein Textinhalt)", regular, SIZE.body, CONTENT_WIDTH), {
    font: regular, size: SIZE.body,
  });

  // 3. Original-Mail einbetten.
  await pdf.attach(mail.eml.bytes, mail.eml.name, {
    mimeType: "message/rfc822",
    description: "Original-E-Mail",
    creationDate: date,
    modificationDate: date,
  });

  // Metadaten mit festen Datumswerten: gleiche Mail -> gleiches PDF,
  // damit die Duplikaterkennung von Paperless greifen kann.
  pdf.setTitle(mail.subject || "(ohne Betreff)");
  pdf.setAuthor(mail.from || "");
  pdf.setSubject("E-Mail");
  pdf.setCreator("Thunder-ngx");
  pdf.setProducer("Thunder-ngx (pdf-lib)");
  pdf.setCreationDate(date);
  pdf.setModificationDate(date);

  return await pdf.save();
}

/**
 * Hängt alle Seiten eines PDF-Anhangs an.
 * @returns {Promise<string>} Status für die Anhangsübersicht
 */
async function addPdfPages(pdf, att, PDFDocument) {
  let doc;
  try {
    doc = await PDFDocument.load(att.bytes, { ignoreEncryption: true, updateMetadata: false });
  } catch (err) {
    console.warn(`thunder-ngx: ${att.name} ist kein lesbares PDF`, err);
    return "kein lesbares PDF, nur in der Original-Mail";
  }
  if (doc.isEncrypted) {
    // pdf-lib kann verschlüsselte Inhalte nicht entschlüsseln; kopierte Seiten wären leer.
    return "verschlüsselt, nur in der Original-Mail";
  }
  const pages = await pdf.copyPages(doc, doc.getPageIndices());
  pages.forEach((p) => pdf.addPage(p));
  return `angehängt, ${pages.length} ${pages.length === 1 ? "Seite" : "Seiten"}`;
}

/**
 * Hängt ein JPEG/PNG als eigene A4-Seite an (Hoch- oder Querformat passend zum Bild).
 * Volle Auflösung für die Texterkennung; JPEG-Daten bleiben byte-genau erhalten,
 * PNG wird von pdf-lib verlustfrei neu kodiert;
 * die EXIF-Ausrichtung wird über die Transformationsmatrix angewendet.
 * @returns {Promise<string>} Status für die Anhangsübersicht
 */
async function addImagePage(pdf, att, { PDFLib, font }) {
  const { rgb, pushGraphicsState, popGraphicsState, concatTransformationMatrix, drawObject } = PDFLib;

  const info = readImageInfo(att.bytes);
  if (!info) return "kein lesbares JPEG/PNG, nur in der Original-Mail";
  if (att.size < IMAGE_LIMITS.minBytes || Math.min(info.width, info.height) < IMAGE_LIMITS.minEdge) {
    return "sehr klein (vermutlich Logo oder Symbol), nur in der Original-Mail";
  }

  let image;
  try {
    image = info.type === "png" ? await pdf.embedPng(att.bytes) : await pdf.embedJpg(att.bytes);
  } catch (err) {
    console.warn(`thunder-ngx: ${att.name} lässt sich nicht einbetten`, err);
    return "kein lesbares JPEG/PNG, nur in der Original-Mail";
  }

  // Maße so, wie das Bild richtig ausgerichtet aussieht.
  const [width, height] = swapsAxes(info.orientation) ? [info.height, info.width] : [info.width, info.height];
  const [pageWidth, pageHeight] = width > height ? [PAGE_HEIGHT, PAGE_WIDTH] : [PAGE_WIDTH, PAGE_HEIGHT];
  const page = pdf.addPage([pageWidth, pageHeight]);

  const boxWidth = pageWidth - 2 * IMAGE_MARGIN;
  const boxHeight = pageHeight - 2 * IMAGE_MARGIN - CAPTION_SPACE;
  page.drawText(wrapText(att.name, font, SIZE.footer, boxWidth)[0] ?? "", {
    x: IMAGE_MARGIN, y: pageHeight - IMAGE_MARGIN - SIZE.footer, size: SIZE.footer, font, color: rgb(0.45, 0.45, 0.45),
  });

  const scale = Math.min(boxWidth / width, boxHeight / height);
  const drawWidth = width * scale;
  const drawHeight = height * scale;
  const x = (pageWidth - drawWidth) / 2;
  const y = IMAGE_MARGIN + (boxHeight - drawHeight) / 2;

  const name = page.node.newXObject("Image", image.ref);
  page.pushOperators(
    pushGraphicsState(),
    concatTransformationMatrix(...orientationMatrix(info.orientation, x, y, drawWidth, drawHeight)),
    drawObject(name),
    popGraphicsState(),
  );
  return "als Bild angehängt";
}
