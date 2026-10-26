# Limpia Gmail

Revisa tu bandeja de entrada de Gmail agrupada por remitentes y mueve a la papelera la publicidad, las ofertas y las redes sociales. **Antes de eliminar nada te muestra la lista de remitentes y pide tu confirmación.**

- Sitio estático (HTML + JS sin dependencias), listo para GitHub Pages.
- Se ejecuta en tu navegador: sin servidor, sin base de datos.
- Solo mueve a la **papelera** (recuperable 30 días) y tiene botón de deshacer.
- Nunca toca correos con estrella, borradores ni enviados.
- Incluye una bandeja de ejemplo para probar sin conectar tu cuenta.

## Configuración (10 minutos, una sola vez)

La app necesita un ID de cliente de Google. Es gratis y no es un secreto.

1. Entra en [Google Cloud Console](https://console.cloud.google.com/) y crea un proyecto.
2. **APIs y servicios → Biblioteca**: activa **Gmail API**.
3. **Pantalla de consentimiento OAuth**: tipo *Externo*, rellena nombre y correo. Añade el ámbito `https://www.googleapis.com/auth/gmail.modify`. En **Usuarios de prueba** añade tu(s) cuenta(s) de Gmail.
4. **Credenciales → Crear credenciales → ID de cliente de OAuth**, tipo **Aplicación web**. En *Orígenes autorizados de JavaScript* añade:
   - `http://localhost:8080` (para probar en local)
   - `https://TU_USUARIO.github.io` (tu GitHub Pages; solo el origen, sin ruta)
5. Copia el ID de cliente en `public/js/config.js` (`CLIENT_ID`).

> **Sobre el permiso:** `gmail.modify` es un ámbito restringido de Google. Para uso personal, en modo *Pruebas* con tus usuarios de prueba, funciona sin verificación (Google muestra un aviso de «app no verificada» que puedes aceptar; los permisos de prueba caducan a los 7 días y hay que volver a autorizar). Para abrirla a cualquier persona Google exige verificación de la app y una evaluación de seguridad.

## Probar en local

```bash
npm start        # sirve en http://localhost:8080
npm test         # tests del clasificador
```

## Publicar en Cloudflare

En Cloudflare: Workers y Pages → conectar el repo. Deja el comando de compilación vacío y el de despliegue por defecto (`npx wrangler deploy`). `wrangler.jsonc` publica solo la carpeta `public/`.

## Publicar en GitHub Pages

```bash
git init -b main
git add .
git commit -m "Limpia Gmail v1.0.0"
git remote add origin https://github.com/TU_USUARIO/limpia-gmail.git
git push -u origin main
```

En el repositorio: **Settings → Pages → Source: GitHub Actions**. Cada push a `main` ejecuta los tests y publica el sitio.

## Estructura

```
public/index.html        interfaz
public/styles.css        estilos (tema claro/oscuro)
public/privacy.html      política de privacidad
public/js/config.js      ID de cliente y ámbito
public/js/classifier.js  reglas de clasificación (puras, con tests)
public/js/gmail.js       cliente de la API de Gmail
public/js/demo.js        bandeja de ejemplo
public/js/app.js         interfaz y flujo
tests/                   pruebas con node:test
wrangler.jsonc           despliegue en Cloudflare (publica solo public/)
```

## Cómo clasifica

Usa las categorías que Gmail ya asigna (Promociones, Social, Actualizaciones, Foros) más reglas sobre el remitente y los asuntos. Bancos, administración, pedidos, seguridad y personas conocidas siempre se conservan. Solo *Ofertas* y *Redes* vienen marcadas; *Boletines* y *Para revisar* las eliges tú. Puedes marcar «Conservar siempre» o «Clasificación errónea» en cada remitente.

## Licencia

MIT
