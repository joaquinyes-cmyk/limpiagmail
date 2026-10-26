import test from "node:test";
import assert from "node:assert/strict";
import { classify, parseSender, decodeWords, mkItem } from "../public/js/classifier.js";
import { demoGroups } from "../public/js/demo.js";
import { normalizeThread } from "../public/js/gmail.js";

const base = { count: 10, span: 30, unread: 0, bytes: 0, subs: [], cats: { promo: 0, social: 0, updates: 0, primary: 0, forums: 0, main: 0 } };
const g = (o) => ({ ...base, ...o, cats: { ...base.cats, ...(o.cats || {}) } });

test("promociones de Gmail van a ofertas y vienen marcadas", () => {
  const c = classify(g({ addr: "x@tienda.com", name: "Tienda", subs: ["Solo hoy -50%"], cats: { promo: 10 } }));
  assert.equal(c.cat, "ofertas");
  assert.equal(c.pre, true);
});

test("redes sociales se marcan", () => {
  const c = classify(g({ addr: "n@red.com", name: "Red", cats: { social: 10 } }));
  assert.equal(c.cat, "social");
  assert.equal(c.pre, true);
});

test("bancos y contactos se conservan aunque Gmail diga promoción", () => {
  assert.equal(classify(g({ addr: "avisos@bancocosta.es", name: "Banco Costa", cats: { promo: 10 } })).cat, "keep");
  assert.equal(classify(g({ addr: "a@b.com", name: "Mamá", contact: true, cats: { promo: 10 } })).cat, "keep");
});

test("solo lo protegido queda sin marcar; todo lo demás se propone", () => {
  for (const it of demoGroups().map(mkItem)) assert.equal(it.sel, it.cat !== "keep", it.addr);
});

test("empleo y notificaciones van a revisar", () => {
  assert.equal(classify(g({ addr: "a@trabajosya.com", name: "Trabajos", cats: { updates: 10 } })).cat, "review");
  assert.equal(classify(g({ addr: "no-reply@juego.com", name: "Juego", cats: { updates: 10 } })).cat, "review");
});

test("persona con correo personal en principal se conserva", () => {
  assert.equal(classify(g({ addr: "ana@gmail.com", name: "Ana", cats: { main: 10 } })).cat, "keep");
});

test("parseSender extrae nombre y dirección", () => {
  assert.deepEqual(parseSender('"Ofertas" <HOLA@Tienda.com>'), { addr: "hola@tienda.com", name: "Ofertas" });
  assert.equal(parseSender("hola@tienda.com").name, "Tienda");
});

test("decodeWords decodifica base64 y quoted-printable", () => {
  assert.equal(decodeWords("=?UTF-8?B?T2ZlcnRhIGRlbCBkw61h?="), "Oferta del día");
  assert.equal(decodeWords("=?UTF-8?Q?Oferta_del_d=C3=ADa?="), "Oferta del día");
  assert.equal(decodeWords("texto normal"), "texto normal");
});

test("normalizeThread lee cabeceras de la API", () => {
  const t = normalizeThread({ id: "1", messages: [{ id: "m", internalDate: "5", sizeEstimate: 9, labelIds: ["INBOX"], payload: { headers: [{ name: "from", value: "A <a@b.com>" }, { name: "Subject", value: "Hola" }] } }] });
  assert.equal(t.messages[0].sender, "A <a@b.com>");
  assert.equal(t.messages[0].subject, "Hola");
});

test("la demo clasifica sin errores", () => {
  const items = demoGroups().map(mkItem);
  assert.ok(items.some((i) => i.cat === "ofertas"));
  assert.ok(items.some((i) => i.cat === "keep"));
});

test("lo que casi nunca se abre, con volumen, viene marcado; bancos no", () => {
  const a = classify(g({ addr: "admin@hobbiecode.com", name: "HOBBIECODE", count: 192, unread: 182, subs: ["El Capítulo 1 se estrena"], cats: { updates: 192 } }));
  assert.equal(a.pre, true);
  const b = classify(g({ addr: "avisos@bancocosta.es", name: "Banco Costa", count: 50, unread: 50, cats: { updates: 50 } }));
  assert.equal(b.pre, false);
});

test("actualizaciones con enlace de baja pasan a boletines", () => {
  const c = classify(g({ addr: "x@club.com", name: "Club", count: 10, unread: 2, unsubN: 9, cats: { updates: 10 } }));
  assert.equal(c.cat, "news");
});
