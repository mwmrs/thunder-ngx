// Aufbereitung von Mailtext für die PDF-Ausgabe.

const BLOCK_ELEMENTS = new Set([
  "ADDRESS", "ARTICLE", "ASIDE", "BLOCKQUOTE", "DD", "DIV", "DL", "DT", "FIELDSET",
  "FIGURE", "FOOTER", "FORM", "H1", "H2", "H3", "H4", "H5", "H6", "HEADER", "HR",
  "LI", "MAIN", "NAV", "OL", "P", "PRE", "SECTION", "TABLE", "TR", "UL",
]);

/** Wandelt HTML in lesbaren Fließtext um (Absätze, Listen, Links bleiben erkennbar). */
export function htmlToText(html, DOMParserImpl = globalThis.DOMParser) {
  const doc = new DOMParserImpl().parseFromString(html, "text/html");
  doc.querySelectorAll("script, style, head, title, template").forEach((n) => n.remove());

  let out = "";
  const walk = (node, inPre) => {
    if (node.nodeType === 3 /* TEXT_NODE */) {
      out += inPre ? node.data : node.data.replace(/\s+/g, " ");
      return;
    }
    if (node.nodeType !== 1 /* ELEMENT_NODE */) return;

    const tag = node.tagName;
    if (tag === "BR") { out += "\n"; return; }
    if (tag === "IMG") { if (node.alt) out += `[${node.alt}]`; return; }

    const block = BLOCK_ELEMENTS.has(tag);
    if (block) out += "\n";
    if (tag === "LI") out += "• ";
    if (tag === "TD" || tag === "TH") out += " ";

    for (const child of node.childNodes) walk(child, inPre || tag === "PRE");

    if (tag === "A") {
      const href = node.getAttribute("href") ?? "";
      if (/^https?:/i.test(href) && !node.textContent.includes(href)) out += ` <${href}>`;
    }
    if (block) out += "\n";
  };
  walk(doc.body ?? doc.documentElement, false);

  return out
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n[ \t]+/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/** Entfernt Steuerzeichen, die im PDF nicht darstellbar sind. */
export function sanitizeText(text) {
  return String(text ?? "")
    .replace(/\r\n?/g, "\n")
    .replace(/\t/g, "    ")
    .replace(/ /g, " ")
    .replace(/[\u0000-\u0009\u000B-\u001F\u007F-\u009F​﻿]/g, "");
}

/** Zerlegt Text so in Zeilen, dass keine Zeile breiter als maxWidth ist. */
export function wrapText(text, font, size, maxWidth) {
  const width = (s) => font.widthOfTextAtSize(s, size);
  const lines = [];

  for (const paragraph of sanitizeText(text).split("\n")) {
    let current = "";
    // Split hinter jedem Leerraum, der Leerraum bleibt am Wort hängen.
    for (const word of paragraph.split(/(?<=\s)/)) {
      if (width((current + word).trimEnd()) <= maxWidth) {
        current += word;
        continue;
      }
      if (current) lines.push(current.trimEnd());
      current = "";

      // Einzelnes Wort breiter als die Zeile (z. B. lange URL): hart umbrechen.
      let chars = Array.from(word);
      while (width(chars.join("").trimEnd()) > maxWidth) {
        let lo = 1, hi = chars.length - 1;
        while (lo < hi) {
          const mid = Math.ceil((lo + hi) / 2);
          if (width(chars.slice(0, mid).join("")) <= maxWidth) lo = mid;
          else hi = mid - 1;
        }
        lines.push(chars.slice(0, lo).join(""));
        chars = chars.slice(lo);
      }
      current = chars.join("");
    }
    lines.push(current.trimEnd());
  }
  return lines;
}

export function formatBytes(bytes) {
  if (!Number.isFinite(bytes)) return "";
  const units = ["B", "KB", "MB", "GB"];
  let i = 0;
  while (bytes >= 1024 && i < units.length - 1) { bytes /= 1024; i++; }
  return `${bytes.toLocaleString("de-DE", { maximumFractionDigits: i ? 1 : 0 })} ${units[i]}`;
}

export function formatDate(date) {
  return new Intl.DateTimeFormat("de-DE", { dateStyle: "full", timeStyle: "short" }).format(date);
}

/** Dateiname ohne Zeichen, die in Dateisystemen oder HTTP-Headern Ärger machen. */
export function safeFilename(name, fallback = "mail") {
  const cleaned = String(name ?? "")
    .replace(/[\\/:*?"<>|\u0000-\u001F]+/g, "_")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 120);
  return cleaned || fallback;
}
