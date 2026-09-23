# Thunder-ngx

Thunderbird-Erweiterung (MailExtension, Manifest V3), die eine Mail samt PDF-Anhängen
als **ein** PDF-Dokument an [Paperless-ngx](https://docs.paperless-ngx.com/) sendet.
Paperless braucht dafür keinen Zugriff auf das Postfach, nur einen API-Token.

Aufbau des erzeugten PDFs:

1. Mailseite(n): Betreff, Von, An, Cc, Datum, Anhangsübersicht, Mailtext
2. Seiten aller PDF-Anhänge
3. Original-Mail als eingebettete `.eml`-Datei (PDF-Dateianhang)

Andere Anhänge (Word, Excel, Bilder …) werden auf der Mailseite aufgeführt und sind
über die eingebettete `.eml` vollständig erhalten.

Entwickelt für Thunderbird 153 ESR und Paperless-ngx 3.2.1 (API-Schnittstellen gegen deren Quellen geprüft).

## Entwicklung

```bash
npm install        # installiert pdf-lib, fontkit, web-ext und kopiert sie nach src/vendor
npm test           # PDF-Erzeugung unter Node testen (braucht poppler-utils)
npm run lint       # web-ext lint (Warnung zu "messagesRead" ist normal, prüft gegen Firefox)
npm run build      # erzeugt dist/thunder-ngx-<version>.zip (als .xpi installierbar)
```

In Thunderbird laden:

1. Extras → Add-ons und Themes → Zahnrad → **Add-ons debuggen**
2. **Temporäres Add-on laden …** → `src/manifest.json`
3. Nach Code-Änderungen dort **Neu laden**, über **Untersuchen** gibt es Konsole und Debugger.

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
| `src/lib/text.js` | HTML→Text, Zeilenumbruch, Formatierung |
| `src/lib/paperless.js` | Upload und Task-Status über die REST-API (API-Version 10) |
| `src/options/` | Einstellungsseite |

## Hinweise

- Paperless erzeugt zusätzlich eine Archivversion (PDF/A). Die eingebettete `.eml`
  steckt sicher nur im **Original**. Prüfen mit `pdfdetach -list <original.pdf>`.
- Die gleiche Mail ergibt byte-identische PDFs, so greift die Duplikaterkennung von Paperless.
- Der API-Token liegt unverschlüsselt im Thunderbird-Profil (`storage.local`).
- Schrift: DejaVu Sans (freie Lizenz, siehe `src/fonts/LICENSE-DejaVu.txt`).
