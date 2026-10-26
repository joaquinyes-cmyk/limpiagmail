// Clasificación de remitentes. Funciones puras: no tocan el DOM ni la red,
// así que se pueden probar con `npm test`.

export const RX = {
  promo: /(oferta|descuento|-\s?\d+\s?%|\d+\s?%\s?(dto|de descuento)|cup[oó]n|rebajas|black friday|[uú]ltimas (horas|plazas|unidades)|solo hoy|gratis|gratuito|promo|liquidaci[oó]n|outlet|c[oó]digo de|ahorra)/i,
  spam: /(has ganado|ganador|premio|sorteo)/i,
  news: /(bolet[ií]n|resumen|semanal|newsletter|receta|lo mejor de|titulares|edici[oó]n|novedades)/i,
  keep: /(movimientos|factura|p[oó]liza|pedido|seguridad|contrase[ñn]a|tributaria|recibo|cita previa|justificante|inicio de sesi[oó]n|verificaci[oó]n|c[oó]digo de acceso)/i,
  keepSender: /(banco|bank|santander|bbva|caixa|sabadell|hacienda|tributaria|seguridad ?social|paypal|stripe|factura|invoice|security|seguridad|gobierno|sede-|sede |dgt)/i,
  job: /(trabajos\.com|trabajosya|infojobs|empleo|vacante|candidat|indeed|jobs)/i,
  free: /@(gmail|googlemail|hotmail|outlook|live|yahoo|icloud|me|proton|protonmail)\./i,
  auto: /^(no-?reply|donotreply|news|newsletter|boletin|marketing|promo|ofertas|info|hola|notificaciones|updates|recomendaciones|alertas|avisos|buzon|ganador|mail|email|savings|discover|inspiration)[a-z0-9._-]*@/i,
};

export const CATS = {
  ofertas: { short: "Ofertas", color: "var(--c-ofertas)" },
  social: { short: "Redes", color: "var(--c-social)" },
  news: { short: "Boletines", color: "var(--c-news)" },
  review: { short: "Para revisar", color: "var(--c-review)" },
  keep: { short: "Se conservan", color: "var(--c-keep)" },
};

export const TABS = [
  ["todo", "Todo"],
  ["ofertas", "Ofertas y publicidad"],
  ["social", "Redes sociales"],
  ["news", "Boletines"],
  ["review", "Para revisar"],
  ["keep", "Se conservan"],
];

export const GMAIL_KINDS = ["promo", "social", "updates", "primary", "forums", "main"];

/** Decodifica palabras codificadas de cabeceras (RFC 2047): =?UTF-8?B?...?= y =?UTF-8?Q?...?= */
export function decodeWords(s) {
  return String(s || "").replace(/=\?([^?]+)\?([bBqQ])\?([^?]*)\?=/g, (all, charset, enc, text) => {
    try {
      let bytes;
      if (enc.toUpperCase() === "B") {
        const bin = atob(text);
        bytes = Uint8Array.from(bin, (c) => c.charCodeAt(0));
      } else {
        const q = text.replace(/_/g, " ");
        const out = [];
        for (let i = 0; i < q.length; i++) {
          if (q[i] === "=" && /^[0-9a-fA-F]{2}$/.test(q.slice(i + 1, i + 3))) {
            out.push(parseInt(q.slice(i + 1, i + 3), 16));
            i += 2;
          } else out.push(q.charCodeAt(i));
        }
        bytes = Uint8Array.from(out);
      }
      return new TextDecoder(charset).decode(bytes);
    } catch {
      return all;
    }
  });
}

export function nameFromAddr(addr) {
  const dom = String(addr).split("@")[1] || addr;
  const p = dom.split(".");
  if (p.length > 1) p.pop();
  if (p.length > 1 && /^(co|com|org|net)$/.test(p[p.length - 1])) p.pop();
  const n = p[p.length - 1] || dom;
  return n.charAt(0).toUpperCase() + n.slice(1);
}

export function parseSender(raw) {
  const s = decodeWords(raw);
  const m = s.match(/^\s*"?([^"<]*?)"?\s*<([^>]+)>\s*$/);
  const addr = (m ? m[2] : s).trim().toLowerCase();
  let name = m ? m[1].trim() : "";
  if (!name) name = nameFromAddr(addr);
  return { addr, name };
}

/**
 * g = { addr, name, count, span (días), unread, subs[], cats{promo,social,updates,primary,forums,main}, contact? }
 * Devuelve { cat, reasons[], pre } donde pre indica si viene marcado para eliminar.
 */
export function classify(g) {
  const subs = g.subs;
  const t = Math.max(1, subs.length);
  const r = [];
  const id = g.addr + " " + g.name;
  const hit = (rx) => subs.filter((s) => rx.test(s)).length;
  let dom = "primary";
  let best = -1;
  for (const k of GMAIL_KINDS) {
    const n = (g.cats && g.cats[k]) || 0;
    if (n > best) {
      best = n;
      dom = k;
    }
  }
  if (dom === "main" && g.cats.primary > 0) dom = "primary";
  const total = g.count;
  let cat;
  if (g.contact) {
    cat = "keep";
    r.push("Es una persona de tus contactos");
  } else if (RX.keepSender.test(id) || hit(RX.keep) / t >= 0.5) {
    cat = "keep";
    r.push("Parece de banco, administración, pedidos o seguridad");
  } else if (RX.job.test(id) || hit(RX.job) / t >= 0.5) {
    cat = "review";
    r.push("Alertas de empleo: quizá las sigues");
  } else if (hit(RX.spam) > 0) {
    cat = "ofertas";
    r.push("Asuntos típicos de sorteo falso");
  } else if (dom === "social") {
    cat = "social";
    r.push("Gmail lo clasifica como Social (" + best + " de " + total + ")");
  } else if (dom === "promo") {
    cat = hit(RX.news) / t >= 0.5 ? "news" : "ofertas";
    r.push("Gmail lo clasifica como Promociones (" + best + " de " + total + ")");
  } else if (dom === "updates") {
    cat = "review";
    r.push("Aviso o notificación de una app o servicio");
  } else if (dom === "forums") {
    cat = "review";
    r.push("Foro o lista de correo");
  } else if (dom === "main") {
    if (RX.free.test(g.addr)) {
      cat = "keep";
      r.push("Persona con correo personal");
    } else if (RX.auto.test(g.addr)) {
      cat = "review";
      r.push("Remitente automático en tu bandeja principal");
    } else {
      cat = "keep";
      r.push("Parece una persona o empresa con la que tratas");
    }
  } else {
    cat = "news";
    r.push("Tiene enlace de baja en la bandeja principal");
  }
  // Boletines que llegan con enlace de baja: no son avisos importantes aunque Gmail los ponga en Actualizaciones.
  if (cat === "review" && g.unsubN && g.unsubN / total >= 0.5 && !RX.job.test(id)) {
    cat = "news";
    r.push("Casi todos traen enlace de baja");
  }
  if (cat !== "keep") {
    const ph = hit(RX.promo);
    if (ph > 0 && cat === "ofertas") r.push(ph + " de " + t + " asuntos con ofertas");
    if (RX.auto.test(g.addr) && dom !== "main") r.push("Remitente automático");
    if (g.unread >= 3 && g.unread === total) r.push("Ninguno leído");
    else if (g.unread > 0 && total >= 3) r.push(g.unread + " sin leer");
    if (g.span >= 7 && total >= 3) r.push("Unos " + (total / (g.span / 7)).toFixed(1).replace(".", ",") + " por semana");
    else if (total >= 2) r.push(total + " correos en " + Math.max(1, Math.round(g.span)) + " días");
  }
  const neverOpened = (cat === "news" || cat === "review") && total >= 8 && g.unread / total >= 0.9;
  if (neverOpened) r.push("Casi nunca lo abres (" + g.unread + " de " + total + " sin leer)");
  // Se propone eliminar todo lo que no parece importante; el usuario revisa la lista y desmarca lo que quiera conservar.
  return { cat, reasons: r, pre: cat !== "keep" };
}

export function mkItem(g, i) {
  const c = classify(g);
  return {
    id: i,
    name: g.name,
    addr: g.addr,
    count: g.count,
    bytes: g.bytes,
    last: g.last,
    subs: g.subs,
    cat: c.cat,
    orig: c.cat,
    reasons: c.reasons,
    origReasons: c.reasons.slice(),
    sel: c.pre,
    status: "inbox",
    forced: false,
    flag: false,
  };
}
