// Baut aus einer Mail ein einziges PDF:
//   1. Mailseite(n) mit Kopfdaten, Anhangsübersicht und Mailtext
//   2. dahinter die Seiten aller PDF-Anhänge
//   3. die Original-Mail als eingebettete .eml-Datei
//
// Die Funktion ist frei von Thunderbird-APIs, damit sie auch unter Node testbar ist.

import { formatBytes, formatDate, wrapText } from "./text.js";

const PAGE_WIDTH = 595.28; // A4
const PAGE_HEIGHT = 841.89;
const MARGIN = 50;
const CONTENT_WIDTH = PAGE_WIDTH - 2 * MARGIN;
const LABEL_WIDTH = 62;
const LEADING = 1.35;
const SIZE = { subject: 15, header: 9.5, body: 10, footer: 7.5 };

/**
 * @param {object} mail
 * @param {string} mail.subject
 * @param {string} mail.from
 * @param {string[]} mail.to
 * @param {string[]} mail.cc
 * @param {Date} mail.date
 * @param {string} mail.bodyText
 * @param {{name: string, size: number, bytes?: Uint8Array}[]} mail.attachments
 *        bytes nur bei PDF-Anhängen, die eingebunden werden sollen
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

  // 1. PDF-Anhänge zuerst übernehmen, damit die Übersicht auf der Mailseite
  //    den tatsächlichen Status (übernommen / fehlgeschlagen) anzeigen kann.
  const attachmentLines = [];
  for (const att of mail.attachments) {
    const label = `${att.name} (${formatBytes(att.size)})`;
    if (!att.bytes) {
      attachmentLines.push(`${label} – nur in der Original-Mail`);
      continue;
    }
    let doc;
    try {
      doc = await PDFDocument.load(att.bytes, { ignoreEncryption: true, updateMetadata: false });
    } catch (err) {
      console.warn(`thunder-ngx: ${att.name} ist kein lesbares PDF`, err);
      attachmentLines.push(`${label} – kein lesbares PDF, nur in der Original-Mail`);
      continue;
    }
    if (doc.isEncrypted) {
      // pdf-lib kann verschlüsselte Inhalte nicht entschlüsseln; kopierte Seiten wären leer.
      attachmentLines.push(`${label} – verschlüsselt, nur in der Original-Mail`);
      continue;
    }
    const pages = await pdf.copyPages(doc, doc.getPageIndices());
    pages.forEach((p) => pdf.addPage(p));
    attachmentLines.push(`${label} – angehängt, ${pages.length} ${pages.length === 1 ? "Seite" : "Seiten"}`);
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
