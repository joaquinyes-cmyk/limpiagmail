// Cliente mínimo de la API de Gmail para el navegador.
// El token de acceso vive solo en memoria: no se guarda en ningún sitio.
import { decodeWords } from "./classifier.js";

const API = "https://gmail.googleapis.com/gmail/v1/users/me";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export class GmailError extends Error {
  constructor(code, message, status) {
    super(message || code);
    this.code = code; // auth | auth_popup | auth_expired | access_denied | rate_limited | network | api_error | no_google
    this.status = status || 0;
  }
}

/** Códigos tras los que no tiene sentido seguir llamando a la API. */
export const FATAL_CODES = new Set(["auth", "auth_popup", "auth_expired", "access_denied", "no_google"]);

export function header(msg, name) {
  const h = (msg.payload && msg.payload.headers) || [];
  const f = h.find((x) => x.name && x.name.toLowerCase() === name.toLowerCase());
  return f ? f.value : "";
}

/** Convierte un hilo de la API (format=metadata) en la forma que usa la app. */
export function normalizeThread(t) {
  return {
    id: t.id,
    messages: (t.messages || []).map((m) => ({
      id: m.id,
      sender: header(m, "From"),
      subject: decodeWords(header(m, "Subject")),
      internalDate: m.internalDate,
      sizeEstimate: m.sizeEstimate,
      labelIds: m.labelIds || [],
    })),
  };
}

export class GmailClient {
  constructor({ clientId, scope }) {
    this.clientId = clientId;
    this.scope = scope;
    this.token = null;
    this.expires = 0;
  }

  async waitForGoogle(ms = 10000) {
    const t0 = Date.now();
    while (!(window.google && window.google.accounts && window.google.accounts.oauth2)) {
      if (Date.now() - t0 > ms) throw new GmailError("no_google", "No se pudo cargar el inicio de sesión de Google");
      await sleep(150);
    }
  }

  /** Debe llamarse desde un clic del usuario (abre la ventana de Google). */
  async connect() {
    await this.waitForGoogle();
    return new Promise((resolve, reject) => {
      const tc = window.google.accounts.oauth2.initTokenClient({
        client_id: this.clientId,
        scope: this.scope,
        callback: (r) => {
          if (r.error) return reject(new GmailError("auth", r.error_description || r.error));
          this.token = r.access_token;
          this.expires = Date.now() + (Number(r.expires_in || 3600) - 60) * 1000;
          resolve();
        },
        error_callback: (e) => reject(new GmailError("auth_popup", (e && e.type) || "popup")),
      });
      tc.requestAccessToken({ prompt: "" });
    });
  }

  disconnect() {
    const t = this.token;
    this.token = null;
    this.expires = 0;
    try {
      if (t && window.google && window.google.accounts) window.google.accounts.oauth2.revoke(t, () => {});
    } catch {
      /* nada */
    }
  }

  get connected() {
    return !!this.token && Date.now() < this.expires;
  }

  async request(method, path, { params, body } = {}) {
    if (!this.connected) throw new GmailError("auth_expired", "La sesión de Google caducó");
    const url = new URL(API + path);
    if (params) {
      for (const [k, v] of Object.entries(params)) {
        if (Array.isArray(v)) v.forEach((x) => url.searchParams.append(k, x));
        else if (v !== undefined && v !== null) url.searchParams.set(k, v);
      }
    }
    let attempt = 0;
    for (;;) {
      let res;
      try {
        res = await fetch(url, {
          method,
          headers: { Authorization: "Bearer " + this.token, ...(body ? { "Content-Type": "application/json" } : {}) },
          body: body ? JSON.stringify(body) : undefined,
        });
      } catch {
        if (attempt < 2) {
          await sleep(500 * 2 ** attempt++);
          continue;
        }
        throw new GmailError("network", "Sin conexión con Gmail");
      }
      if (res.ok) return res.status === 204 ? {} : res.json();
      let detail = "";
      try {
        detail = ((await res.json()).error || {}).message || "";
      } catch {
        /* sin cuerpo */
      }
      if (res.status === 401) {
        this.token = null;
        throw new GmailError("auth_expired", detail, 401);
      }
      const limited = res.status === 429 || (res.status === 403 && /rate|quota/i.test(detail));
      if ((limited || res.status >= 500) && attempt < 4) {
        await sleep(Math.min(8000, 600 * 2 ** attempt) + Math.random() * 300);
        attempt++;
        continue;
      }
      if (limited) throw new GmailError("rate_limited", detail, res.status);
      if (res.status === 403) throw new GmailError("access_denied", detail, 403);
      throw new GmailError("api_error", detail, res.status);
    }
  }

  async profile() {
    return this.request("GET", "/profile");
  }

  /** Lista ids de hilos que cumplen la búsqueda. */
  async listThreads(q, pageToken, maxResults = 50) {
    const r = await this.request("GET", "/threads", { params: { q, maxResults, pageToken } });
    return { ids: (r.threads || []).map((t) => t.id), next: r.nextPageToken || null };
  }

  /** Cabeceras de un hilo (remitente y asunto), sin descargar el cuerpo. */
  async getThread(id) {
    const t = await this.request("GET", "/threads/" + encodeURIComponent(id), {
      params: { format: "metadata", metadataHeaders: ["From", "Subject"] },
    });
    return normalizeThread(t);
  }

  /** Lista ids de mensajes (con su hilo) que cumplen la búsqueda. */
  async listMessages(q, pageToken, maxResults = 500) {
    const r = await this.request("GET", "/messages", { params: { q, maxResults, pageToken } });
    return { messages: r.messages || [], next: r.nextPageToken || null };
  }

  /** Cambia etiquetas de hasta 1000 mensajes a la vez. */
  async batchModify(ids, addLabelIds, removeLabelIds) {
    if (!ids.length) return;
    await this.request("POST", "/messages/batchModify", { body: { ids, addLabelIds, removeLabelIds } });
  }

  async trash(ids) {
    return this.batchModify(ids, ["TRASH"], ["INBOX"]);
  }

  async untrash(ids) {
    return this.batchModify(ids, ["INBOX"], ["TRASH"]);
  }
}
