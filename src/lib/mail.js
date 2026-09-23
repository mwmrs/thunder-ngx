// Liest eine Mail über die Thunderbird-MailExtension-API aus.

import { htmlToText, safeFilename } from "./text.js";

/** Durchläuft eine (ggf. seitenweise gelieferte) MessageList. */
export async function* iterateMessageList(list) {
  let page = list;
  while (page) {
    yield* page.messages;
    page = page.id ? await messenger.messages.continueList(page.id) : null;
  }
}

/** YYYY-MM-DD in Ortszeit (toISOString() wäre UTC und nachts einen Tag daneben). */
function localIsoDate(date) {
  const pad = (n) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

function isPdf(attachment) {
  return attachment.contentType?.toLowerCase() === "application/pdf" || /\.pdf$/i.test(attachment.name ?? "");
}

async function getRawMail(messageId) {
  try {
    return await messenger.messages.getRaw(messageId, { data_format: "File", decrypt: true });
  } catch {
    // Nicht entschlüsselbar: dann die Mail so, wie sie im Postfach liegt.
    return await messenger.messages.getRaw(messageId, { data_format: "File" });
  }
}

async function getBodyText(messageId) {
  const parts = await messenger.messages.listInlineTextParts(messageId);
  const plain = parts.filter((p) => p.contentType === "text/plain").map((p) => p.content);
  if (plain.length) return plain.join("\n\n");
  const html = parts.filter((p) => p.contentType === "text/html").map((p) => htmlToText(p.content));
  return html.join("\n\n");
}

/**
 * Sammelt alles, was buildMailPdf() braucht.
 * @param {object} header  MessageHeader aus der MailExtension-API
 */
export async function collectMail(header) {
  const id = header.id;
  const [rawFile, bodyText, attachmentList] = await Promise.all([
    getRawMail(id),
    getBodyText(id),
    messenger.messages.listAttachments(id),
  ]);

  const attachments = [];
  for (const a of attachmentList) {
    const entry = { name: a.name || "(unbenannt)", size: a.size };
    if (isPdf(a)) {
      const file = await messenger.messages.getAttachmentFile(id, a.partName);
      entry.bytes = new Uint8Array(await file.arrayBuffer());
    }
    attachments.push(entry);
  }

  const date = header.date ? new Date(header.date) : new Date();
  const subject = header.subject ?? "";
  const baseName = `${localIsoDate(date)} ${safeFilename(subject, "ohne Betreff")}`;

  return {
    subject,
    from: header.author ?? "",
    to: header.recipients ?? [],
    cc: header.ccList ?? [],
    date,
    bodyText,
    attachments,
    eml: { name: `${baseName}.eml`, bytes: new Uint8Array(await rawFile.arrayBuffer()) },
    pdfFilename: `${baseName}.pdf`,
  };
}
