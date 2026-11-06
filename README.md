# Thunder-ngx

Thunderbird-Erweiterung (MailExtension, Manifest V3), die eine Mail samt PDF- und Bildanhängen
als **ein** PDF-Dokument an [Paperless-ngx](https://docs.paperless-ngx.com/) sendet.
Paperless braucht dafür keinen Zugriff auf das Postfach, nur einen API-Token.

Aufbau des erzeugten PDFs:

1. Mailseite(n): Betreff, Von, An, Cc, Datum, Anhangsübersicht, Mailtext
2. Seiten aller PDF-Anhänge und je eine Seite pro JPEG-/PNG-Bild, in der Reihenfolge der Anhänge
3. Original-Mail als eingebettete `.eml`-Datei (PDF-Dateianhang)

Andere Anhänge (Word, Excel, GIF, HEIC …) werden auf der Mailseite aufgeführt und sind
über die eingebettete `.eml` vollständig erhalten.

Bilder:

- Bildseite im Hoch- oder Querformat passend zum Bild, Bild auf A4 eingepasst, Dateiname oben.
- Volle Auflösung für die Texterkennung in Paperless; JPEGs werden byte-genau übernommen,
  PNGs verlustfrei neu kodiert.
- EXIF-Ausrichtung von Handyfotos wird beim Zeichnen angewendet, das Original-JPEG bleibt unberührt.
- Keine eigene Seite bekommen: Bilder unter 10 KB oder mit einer Kante unter 200 Pixeln
  (Logos, Symbole; sie werden auf der Mailseite als „sehr klein“ aufgeführt) sowie im
  Mailtext eingebettete Bilder unter 100 KB (Signatur-Logos; gar nicht aufgeführt).
  Größere eingebettete Bilder werden übernommen, weil z. B. iPhone-Mail angehängte
  Fotos so einbettet. Schwellen in `src/lib/image.js`.

Entwickelt für Thunderbird 153 ESR und Paperless-ngx 3.2.1 (API-Schnittstellen gegen deren Quellen geprüft).

## Entwicklung

```bash
npm install        # installiert pdf-lib, fontkit, web-ext und kopiert sie nach src/vendor
npm test           # PDF-Erzeugung unter Node testen (braucht poppler-utils)
npm run lint       # web-ext lint (Warnung zu "messagesRead" ist normal, prüft gegen Firefox)
npm run build      # erzeugt dist/thunder-ngx-<version>.xpi
```

In Thunderbird laden:

1. Extras → Add-ons und Themes → Zahnrad → **Add-ons debuggen**
2. **Temporäres Add-on laden …** → `src/manifest.json`
3. Nach Code-Änderungen dort **Neu laden**, über **Untersuchen** gibt es Konsole und Debugger.

Dauerhaft installieren (Thunderbird verlangt keine Signatur):

1. `npm run build`
2. Extras → Add-ons und Themes → Zahnrad → **Add-on aus Datei installieren …** → `dist/thunder-ngx-<version>.xpi`
3. Für ein Update `version` in `src/manifest.json` erhöhen, neu bauen und die neue `.xpi` genauso installieren.

## Bedienung

- Einstellungen des Add-ons: Paperless-URL und API-Token eintragen, **Speichern**
  (fragt einmalig nach Zugriff auf die Paperless-Adresse), **Verbindung testen**.
- Mail(s) in der Liste markieren → Rechtsklick → **An Paperless senden**,
  oder in der geöffneten Mail der Button **An Paperless senden**.

## Benötigte Rechte in Paperless

Ein eigener, eingeschränkter Benutzer reicht (kein Superuser, kein Staff):

| Recht | Wofür |
|---|---|
| Dokument: Hinzufügen (`add_document`) | Upload, immer nötig |
| PaperlessTask: Anzeigen (`view_paperlesstask`) | Statusmeldung nach dem Upload; entfällt, wenn „Auf Verarbeitungsergebnis warten“ aus ist |

Tags vergibt die Erweiterung bewusst nicht, das übernimmt Paperless selbst
(automatische Zuordnung, Workflows).

Hochgeladene Dokumente gehören dem Upload-Benutzer; damit der eigene Hauptbenutzer sie sieht, entweder Superuser sein
oder per Paperless-Workflow (Auslöser „Verarbeitung gestartet“, Quelle „API-Upload“)
Eigentümer bzw. Anzeigerechte zuweisen.

## Aufbau

| Datei | Aufgabe |
|---|---|
| `src/manifest.json` | Berechtigungen, Einstiegspunkte |
| `src/background.js` | Menü/Button, Ablaufsteuerung, Benachrichtigungen |
| `src/lib/mail.js` | Mail, Text, Anhänge und Roh-Mail über die Thunderbird-API holen |
| `src/lib/pdf.js` | PDF bauen (ohne Thunderbird-Abhängigkeit, unter Node testbar) |
| `src/lib/image.js` | JPEG/PNG erkennen, Abmessungen und EXIF-Ausrichtung lesen |
| `src/lib/text.js` | HTML→Text, Zeilenumbruch, Formatierung |
| `src/lib/paperless.js` | Upload und Task-Status über die REST-API (API-Version 10) |
| `src/options/` | Einstellungsseite |

## Hinweise

- Paperless erzeugt zusätzlich eine Archivversion (PDF/A). Die eingebettete `.eml`
  steckt sicher nur im **Original**. Prüfen mit `pdfdetach -list <original.pdf>`.
- Die gleiche Mail ergibt byte-identische PDFs, so greift die Duplikaterkennung von Paperless.
- Der API-Token liegt unverschlüsselt im Thunderbird-Profil (`storage.local`).
- Schrift: DejaVu Sans (freie Lizenz, siehe `src/fonts/LICENSE-DejaVu.txt`).

## Lizenz

MIT, siehe [`LICENSE`](LICENSE). Mitgelieferte Bibliotheken und Schriften stehen unter ihren eigenen Lizenzen:

- `src/vendor/`: pdf-lib, fontkit und die darin gebündelten Pakete (u. a. MIT, ISC, BSD-3-Clause,
  Zlib, Apache-2.0), siehe [`src/vendor/THIRD-PARTY-NOTICES.txt`](src/vendor/THIRD-PARTY-NOTICES.txt).
  Bei einem Versionswechsel von pdf-lib oder fontkit diese Datei prüfen.
- `src/fonts/`: DejaVu Sans, siehe [`src/fonts/LICENSE-DejaVu.txt`](src/fonts/LICENSE-DejaVu.txt).
