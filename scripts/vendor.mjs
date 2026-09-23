// Kopiert die Laufzeit-Bibliotheken aus node_modules nach src/vendor,
// damit die Erweiterung ohne Build-Schritt direkt geladen werden kann.
import { copyFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const target = join(root, "src", "vendor");
mkdirSync(target, { recursive: true });

const files = [
  ["node_modules/pdf-lib/dist/pdf-lib.min.js", "pdf-lib.min.js"],
  ["node_modules/@pdf-lib/fontkit/dist/fontkit.umd.min.js", "fontkit.umd.min.js"],
];

for (const [from, to] of files) {
  copyFileSync(join(root, from), join(target, to));
  console.log(`vendor: ${from} -> src/vendor/${to}`);
}
