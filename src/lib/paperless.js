// Zugriff auf die Paperless-ngx REST-API (geprüft gegen Paperless-ngx 3.2.1).

// API-Version fest anpinnen: v10 liefert /api/tasks/ paginiert und mit
// kleingeschriebenem Status. Ohne Pinning könnte ein Paperless-Update das Format ändern.
const ACCEPT = "application/json; version=10";

async function apiFetch(settings, path, init = {}) {
  const url = settings.paperlessUrl.replace(/\/+$/, "") + path;
  const res = await fetch(url, {
    ...init,
    // Keine Session-Cookies mitschicken: sonst greift ggf. Djangos Session-Auth
    // samt CSRF-Prüfung statt des Tokens, was zu verwirrenden 403-Fehlern führt.
    credentials: "omit",
    headers: {
      Accept: ACCEPT,
      Authorization: `Token ${settings.apiToken}`,
      ...init.headers,
    },
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    const err = new Error(`Paperless antwortet mit HTTP ${res.status}: ${body.slice(0, 300)}`);
    err.status = res.status;
    err.headers = res.headers;
    throw err;
  }
  return res;
}

/**
 * Prüft URL, Token und genau die Rechte, die die Erweiterung braucht:
 *   documents.add_document       – Dokumente hochladen
 *   documents.view_paperlesstask – Verarbeitungsstatus abfragen (nur bei waitForResult)
 * Liefert die Paperless-Version (aus dem Antwort-Header X-Version).
 */
export async function testConnection(settings) {
  let version = "(unbekannt)";

  // Upload-Recht prüfen, ohne etwas hochzuladen: Paperless prüft das Recht vor dem
  // Formular. Leeres Formular -> 403 ohne Recht, 400 (fehlendes Dokument) mit Recht.
  try {
    await apiFetch(settings, "/api/documents/post_document/", { method: "POST", body: new FormData() });
    throw new Error("Unerwartete Antwort von Paperless auf den Upload-Test.");
  } catch (err) {
    if (err.status === 401) throw new Error("API-Token ungültig (HTTP 401).");
    if (err.status === 403) throw new Error("Dem Benutzer fehlt das Recht „Dokument: Hinzufügen“ (add_document).");
    if (err.status !== 400) throw err;
    version = err.headers.get("X-Version") ?? version;
  }

  if (settings.waitForResult) {
    try {
      await apiFetch(settings, "/api/tasks/?page_size=1");
    } catch (err) {
      if (err.status === 403) {
        throw new Error(
          "Upload-Recht vorhanden, aber es fehlt das Recht „PaperlessTask: Anzeigen“ (view_paperlesstask) " +
          "für die Statusabfrage. Alternativ „Auf Verarbeitungsergebnis warten“ abschalten.",
        );
      }
      throw err;
    }
  }
  return { version };
}

/** Lädt ein PDF hoch. Liefert die Task-UUID der Verarbeitung in Paperless. */
export async function uploadDocument(settings, { pdfBytes, filename, title, created }) {
  const form = new FormData();
  form.append("document", new Blob([pdfBytes], { type: "application/pdf" }), filename);
  form.append("title", title);
  if (created) form.append("created", created.toISOString());

  const res = await apiFetch(settings, "/api/documents/post_document/", {
    method: "POST",
    body: form,
  });
  return await res.json();
}

/**
 * Fragt den Verarbeitungsstatus ab, bis er feststeht oder das Zeitlimit abläuft.
 * Ergebnis: { state: "success" | "duplicate" | "failure" | "timeout", documentId?, message? }
 */
export async function waitForTask(settings, taskId, { timeoutMs = 120_000, intervalMs = 2_000 } = {}) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const res = await apiFetch(settings, `/api/tasks/?task_id=${encodeURIComponent(taskId)}`);
    const data = await res.json();
    const task = (Array.isArray(data) ? data : data.results)?.[0];
    const result = task?.result_data ?? {};

    if (task?.status === "success") {
      if (result.duplicate_of) return { state: "duplicate", documentId: result.duplicate_of };
      return { state: "success", documentId: result.document_id };
    }
    if (task?.status === "failure" || task?.status === "revoked") {
      return {
        state: result.duplicate_of ? "duplicate" : "failure",
        documentId: result.duplicate_of,
        message: result.error_message ?? task.status,
      };
    }
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }
  return { state: "timeout" };
}

export function documentUrl(settings, documentId) {
  return `${settings.paperlessUrl.replace(/\/+$/, "")}/documents/${documentId}/details`;
}
