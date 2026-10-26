// Configuración pública de la app. El ID de cliente de Google no es un secreto:
// identifica tu aplicación, pero solo funciona desde los orígenes que autorices
// en Google Cloud (ver README.md).
export const CONFIG = {
  // Sustituye por tu ID de cliente OAuth de tipo "Aplicación web".
  CLIENT_ID: "TU_ID_DE_CLIENTE.apps.googleusercontent.com",
  // Permiso mínimo para leer cabeceras y mover correos a la papelera.
  // No permite borrar correos de forma permanente ni enviar mensajes.
  SCOPE: "https://www.googleapis.com/auth/gmail.modify",
};
