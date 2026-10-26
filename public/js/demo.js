// Bandeja de ejemplo para probar la app sin conectar ninguna cuenta.
// k = categoría que Gmail les asignaría.
export const SEED = [
  { n: "Ofertas del Día", a: "hola@ofertasdeldia.example", c: 142, d: 1, kb: 120, k: "promo", s: ["Solo hoy: hasta -50% en electrónica", "Últimas horas: tu cupón de 10 € caduca", "Rebajas de temporada ya disponibles"] },
  { n: "Moda Atlántica", a: "news@modaatlantica.example", c: 96, d: 2, kb: 130, k: "promo", s: ["Nueva colección con 30% dto", "Outlet: segundas rebajas", "Envío gratuito este fin de semana"] },
  { n: "Viajes Sol", a: "promo@viajessol.example", c: 74, d: 3, kb: 140, k: "promo", s: ["Escapada a Lisboa desde 59 €: oferta limitada", "Últimas plazas con descuento", "Black Friday viajero: hasta -40%"] },
  { n: "TecnoPlus", a: "ofertas@tecnoplus.example", c: 88, d: 1, kb: 115, k: "promo", s: ["Portátiles con -20% solo hoy", "Cupón TECNO15 para ti", "Liquidación de móviles"] },
  { n: "Gran Hiper", a: "buzon@granhiper.example", c: 61, d: 4, kb: 150, k: "promo", s: ["Ofertas de la semana en tu súper", "Folleto de promociones", "Descuento en productos frescos"] },
  { n: "Cupones Ya", a: "no-reply@cuponesya.example", c: 112, d: 1, kb: 85, k: "promo", s: ["Tu cupón del 15% está listo", "Nuevos cupones de restaurantes", "Cupón de hoy: -5 €"] },
  { n: "Sorteo Premios", a: "ganador@sorteo-premios.example", c: 23, d: 2, kb: 60, k: "promo", s: ["Has ganado un premio, reclámalo ya", "Ganador del sorteo: confirma tus datos"] },
  { n: "Red Social", a: "notificaciones@redsocial.example", c: 205, d: 0, kb: 40, k: "social", s: ["Tienes 3 nuevas sugerencias de amigos", "Alguien te ha mencionado en una publicación"] },
  { n: "Red Profesional", a: "updates@redprofesional.example", c: 66, d: 2, kb: 50, k: "social", s: ["Nuevas conexiones para ti", "Tienes 5 notificaciones nuevas"] },
  { n: "El Resumen Diario", a: "boletin@resumendiario.example", c: 180, d: 0, kb: 90, k: "primary", s: ["Resumen del día: lo que debes saber", "Titulares de la mañana", "Edición del fin de semana"] },
  { n: "Tech Semanal", a: "newsletter@techsemanal.example", c: 52, d: 3, kb: 100, k: "primary", s: ["Newsletter semanal: IA y gadgets", "Boletín: 5 apps que probar"] },
  { n: "Trabajos Ya", a: "alertas@trabajosya.example", c: 30, d: 2, kb: 60, k: "updates", s: ["2 ofertas de empleo para dependientes", "Nuevas vacantes en tu zona"] },
  { n: "Mundo Juegos", a: "no-reply@mundojuegos.example", c: 58, d: 1, kb: 45, k: "updates", s: ["Has subido de nivel: ¡sigue jugando!", "Tienes 2 nuevas misiones"] },
  { n: "Banco Costa", a: "avisos@bancocosta.example", c: 12, d: 2, kb: 70, k: "updates", s: ["Movimientos de tu cuenta", "Aviso de seguridad: nuevo acceso"] },
  { n: "Sede Electrónica", a: "avisos@sede-electronica.example", c: 4, d: 40, kb: 90, k: "updates", s: ["Notificación de la Agencia Tributaria", "Justificante de presentación"] },
  { n: "Tienda Online", a: "pedidos@tiendaonline.example", c: 9, d: 12, kb: 70, k: "updates", s: ["Tu pedido ha sido enviado", "Factura de tu compra"] },
  { n: "Mamá", a: "mama@correo.example", c: 38, d: 1, kb: 60, k: "primary", contact: true, s: ["Llámame cuando puedas", "Fotos del domingo"] },
  { n: "Laura Pérez", a: "laura@empresa.example", c: 71, d: 0, kb: 80, k: "main", s: ["Reunión del jueves", "Re: presupuesto"] },
  { n: "Aviso Gimnasio", a: "avisos@gimnasio.example", c: 26, d: 3, kb: 40, k: "main", s: ["Tu clase de mañana", "Cambio de horario del sábado"] },
  { n: "Gestoría López", a: "gestion@gestorialopez.example", c: 6, d: 3, kb: 80, k: "main", s: ["Documentación pendiente del trimestre", "Horario de agosto"] },
  { n: "Club de Vecinos", a: "avisos@clubvecinos.example", c: 14, d: 5, kb: 50, k: "main", s: ["Convocatoria de reunión", "Actas disponibles", "Aviso de obras en el portal"] },
];

export function demoGroups() {
  return SEED.map((s) => {
    const cats = { promo: 0, social: 0, updates: 0, primary: 0, forums: 0, main: 0 };
    cats[s.k] = s.c;
    return {
      addr: s.a,
      name: s.n,
      count: s.c,
      bytes: s.c * s.kb * 1024,
      last: s.d,
      span: 60,
      unread: 0,
      subs: s.s.slice(),
      cats,
      contact: !!s.contact,
    };
  });
}
