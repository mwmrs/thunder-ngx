// Hintergrundskript (MV3-Event-Page). Alle Event-Listener müssen synchron auf
// oberster Ebene registriert werden, sonst weckt Thunderbird die Seite nicht auf.

// UMD-Bibliotheken: legen self.PDFLib bzw. self.fontkit an.
import "./vendor/pdf-lib.min.js";
import "./vendor/fontkit.umd.min.js";

import { collectMail, iterateMessageList } from "./lib/mail.js";
import { buildMailPdf } from "./lib/pdf.js";
import { documentUrl, uploadDocument, waitForTask } from "./lib/paperless.js";
import { loadSettings, originPattern } from "./lib/settings.js";

const MENU_ID = "send-to-paperless";

messenger.runtime.onInstalled.addListener(() => {
  messenger.menus.create({
    id: MENU_ID,
    title: "An Paperless senden",
    contexts: ["message_list"],
  });
});

messenger.menus.onClicked.addListener((info) => {
  if (info.menuItemId !== MENU_ID || !info.selectedMessages) return;
  sendAll(iterateMessageList(info.selectedMessages));
});

messenger.messageDisplayAction.onClicked.addListener(async (tab) => {
  const list = await messenger.messageDisplay.getDisplayedMessages(tab.id);
  sendAll(iterateMessageList(list));
});

let fontCache = null;
async function loadFonts() {
  if (!fontCache) {
    const load = async (file) =>
      new Uint8Array(await (await fetch(messenger.runtime.getURL(`fonts/${file}`))).arrayBuffer());
    fontCache = { regular: await load("DejaVuSans.ttf"), bold: await load("DejaVuSans-Bold.ttf") };
  }
  return fontCache;
}

function notify(title, message) {
  return messenger.notifications.create({ type: "basic", title, message });
}

async function sendAll(messages) {
  const settings = await loadSettings();
  if (!settings.paperlessUrl || !settings.apiToken) {
    await notify("Paperless nicht eingerichtet", "Bitte zuerst URL und API-Token in den Add-on-Einstellungen eintragen.");
    await messenger.runtime.openOptionsPage();
    return;
  }
  if (!(await messenger.permissions.contains({ origins: [originPattern(settings.paperlessUrl)] }))) {
    await notify("Zugriff fehlt", "Bitte die Einstellungen öffnen und erneut speichern, um den Zugriff auf Paperless zu erlauben.");
    await messenger.runtime.openOptionsPage();
    return;
  }

  for await (const header of messages) {
    try {
      await sendOne(settings, header);
    } catch (err) {
      console.error("thunder-ngx:", err);
      await notify(`Fehler: ${header.subject || "(ohne Betreff)"}`, String(err.message ?? err));
    }
  }
}

async function sendOne(settings, header) {
  const mail = await collectMail(header);
  const pdfBytes = await buildMailPdf(mail, {
    PDFLib: self.PDFLib,
    fontkit: self.fontkit,
    fonts: await loadFonts(),
  });

  const title = mail.subject || "(ohne Betreff)";
  const taskId = await uploadDocument(settings, {
    pdfBytes,
    filename: mail.pdfFilename,
    title,
    created: mail.date,
  });

  if (!settings.waitForResult) {
    await notify("An Paperless übergeben", title);
    return;
  }

  // Die Event-Page kann während des Wartens beendet werden; dann bleibt
  // diese zweite Meldung aus. Das Dokument ist trotzdem hochgeladen.
  await notify("An Paperless übergeben", `${title}\nWird verarbeitet …`);
  const result = await waitForTask(settings, taskId);
  switch (result.state) {
    case "success":
      await notify("In Paperless angelegt", `${title}\n${documentUrl(settings, result.documentId)}`);
      break;
    case "duplicate":
      await notify("Bereits in Paperless vorhanden", `${title}\nDokument #${result.documentId}`);
      break;
    case "failure":
      await notify("Paperless konnte das Dokument nicht verarbeiten", `${title}\n${result.message}`);
      break;
    default:
      await notify("Paperless verarbeitet noch", `${title}\nStatus bitte in Paperless unter „Dateiaufgaben“ prüfen.`);
  }
}
