// Einstellungen in storage.local (liegt unverschlüsselt im Thunderbird-Profil).

export const DEFAULTS = {
  paperlessUrl: "",
  apiToken: "",
  tagIds: [],
  waitForResult: true,
};

export async function loadSettings() {
  const stored = await messenger.storage.local.get(DEFAULTS);
  return { ...DEFAULTS, ...stored };
}

export async function saveSettings(settings) {
  await messenger.storage.local.set(settings);
}

/**
 * "http://rohan:8000/" -> "http://rohan/*" für permissions.request.
 * Ohne Port: Firefox/Thunderbird unterstützen keine Ports in Match-Patterns
 * (Bug 1362809); ein Pattern mit Port wird zwar "erteilt", greift aber nie,
 * und fetch() scheitert dann an CORS. Ohne Port gilt es für alle Ports des Hosts.
 */
export function originPattern(url) {
  const { protocol, hostname } = new URL(url);
  if (protocol !== "http:" && protocol !== "https:") throw new Error("Nur http:// oder https://");
  return `${protocol}//${hostname}/*`;
}

/** "3, 7 12" -> [3, 7, 12] */
export function parseTagIds(text) {
  return String(text)
    .split(/[\s,;]+/)
    .filter(Boolean)
    .map(Number)
    .filter((n) => Number.isInteger(n) && n > 0);
}
