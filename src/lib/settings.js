// Einstellungen in storage.local (liegt unverschlüsselt im Thunderbird-Profil).

export const DEFAULTS = {
  paperlessUrl: "",
  apiToken: "",
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
/**
 * Gibt alle erteilten Web-Adressen außer `keepPattern` zurück, z. B. nach einer
 * URL-Änderung oder Altlasten wie "http://rohan:8000/*". Die Erweiterung hat
 * keine fest verlangten Host-Berechtigungen, alle Einträge sind optional.
 * @returns {Promise<string[]>} die entfernten Muster
 */
export async function revokeOtherOrigins(keepPattern) {
  const { origins = [] } = await messenger.permissions.getAll();
  const stale = origins.filter((o) => o !== keepPattern && /^https?:\/\//.test(o));
  if (stale.length) await messenger.permissions.remove({ origins: stale });
  return stale;
}

export function originPattern(url) {
  const { protocol, hostname } = new URL(url);
  if (protocol !== "http:" && protocol !== "https:") throw new Error("Nur http:// oder https://");
  return `${protocol}//${hostname}/*`;
}
