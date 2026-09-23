// Liest Format, Abmessungen und EXIF-Ausrichtung direkt aus JPEG-/PNG-Bytes.
// Bewusst ohne Dekodieren: die Originaldaten landen unverändert im PDF.

/** Schwellen, um Logos und Symbole nicht als eigene Seite zu übernehmen. */
export const IMAGE_LIMITS = {
  minBytes: 10 * 1024, // kleinere Bilder: vermutlich Logo/Symbol
  minEdge: 200, // kürzere Kante in Pixeln
  // Im Mailtext eingebettete Bilder (inline + Content-ID) sind meist Signatur-Logos.
  // iPhone-Mail bettet aber auch angehängte Fotos so ein; die sind deutlich größer.
  inlineMinBytes: 100 * 1024,
};

/**
 * @param {Uint8Array} bytes
 * @returns {{type: "jpeg" | "png", width: number, height: number, orientation: number} | null}
 *          orientation: EXIF-Wert 1–8 (1 = keine Drehung); null bei unbekanntem Format
 */
export function readImageInfo(bytes) {
  if (bytes.length > 24 && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) {
    // PNG: IHDR ist immer der erste Chunk, Breite/Höhe an Offset 16/20 (Big Endian).
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    return { type: "png", width: view.getUint32(16), height: view.getUint32(20), orientation: 1 };
  }
  if (bytes.length > 4 && bytes[0] === 0xff && bytes[1] === 0xd8) {
    try {
      return readJpeg(bytes);
    } catch {
      return null; // abgeschnittene/defekte Segmente (DataView wirft RangeError)
    }
  }
  return null;
}

function readJpeg(bytes) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let orientation = 1;
  let offset = 2;

  while (offset + 4 <= bytes.length) {
    if (bytes[offset] !== 0xff) return null; // kaputter Marker
    const marker = bytes[offset + 1];
    if (marker === 0xff) { offset++; continue; } // Füllbytes
    if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) { offset += 2; continue; }
    if (marker === 0xd9 || marker === 0xda) return null; // Bildende/Scan vor SOF: keine Abmessungen

    const length = view.getUint16(offset + 2);
    const segment = offset + 4;
    if (segment + length - 2 > bytes.length) return null;

    if (marker === 0xe1 && orientation === 1) {
      orientation = readExifOrientation(view, segment, length - 2) ?? 1;
    }
    // SOF0–SOF15 außer DHT (C4), JPG (C8), DAC (CC)
    if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
      return {
        type: "jpeg",
        height: view.getUint16(segment + 1),
        width: view.getUint16(segment + 3),
        orientation,
      };
    }
    offset = segment + length - 2;
  }
  return null;
}

function readExifOrientation(view, start, length) {
  // "Exif\0\0", dann TIFF-Header
  if (length < 14 || view.getUint32(start) !== 0x45786966 || view.getUint16(start + 4) !== 0) return null;
  const tiff = start + 6;
  const end = start + length;
  const byteOrder = view.getUint16(tiff);
  if (byteOrder !== 0x4949 && byteOrder !== 0x4d4d) return null;
  const little = byteOrder === 0x4949;

  const ifd0 = tiff + view.getUint32(tiff + 4, little);
  if (ifd0 + 2 > end) return null;
  const entries = view.getUint16(ifd0, little);
  for (let i = 0; i < entries; i++) {
    const entry = ifd0 + 2 + i * 12;
    if (entry + 12 > end) return null;
    if (view.getUint16(entry, little) === 0x0112) {
      const value = view.getUint16(entry + 8, little);
      return value >= 1 && value <= 8 ? value : null;
    }
  }
  return null;
}

/**
 * Affine Abbildung vom gespeicherten Bild (s nach rechts, t nach unten, je 0..1)
 * auf die richtig ausgerichtete Darstellung (S, T), je EXIF-Ausrichtung.
 * Werte: [sU, sV, s0, tU, tV, t0] mit S = sU*u + sV*v + s0, T = tU*u + tV*v + t0,
 * wobei (u, v) das PDF-Einheitsquadrat ist (u = s, v = 1 - t).
 */
const ORIENTATION = {
  1: [1, 0, 0, 0, -1, 1],
  2: [-1, 0, 1, 0, -1, 1], // horizontal gespiegelt
  3: [-1, 0, 1, 0, 1, 0], // 180°
  4: [1, 0, 0, 0, 1, 0], // vertikal gespiegelt
  5: [0, -1, 1, 1, 0, 0], // transponiert
  6: [0, 1, 0, 1, 0, 0], // 90° im Uhrzeigersinn
  7: [0, 1, 0, -1, 0, 1], // transversal
  8: [0, -1, 1, -1, 0, 1], // 90° gegen den Uhrzeigersinn
};

/** Sind Breite und Höhe in der Darstellung vertauscht? */
export function swapsAxes(orientation) {
  return orientation >= 5 && orientation <= 8;
}

/**
 * PDF-Transformationsmatrix [a b c d e f], die das Bild-XObject ausgerichtet in
 * das Rechteck (x, y, width, height) zeichnet (Maße der fertigen Darstellung).
 */
export function orientationMatrix(orientation, x, y, width, height) {
  const [sU, sV, s0, tU, tV, t0] = ORIENTATION[orientation] ?? ORIENTATION[1];
  return [
    width * sU, -height * tU,
    width * sV, -height * tV,
    x + width * s0, y + height * (1 - t0),
  ];
}
