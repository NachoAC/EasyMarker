# Publicar EasyMarker en la Chrome Web Store

Guía paso a paso para subir la extensión a la Chrome Web Store e instalarla en vuestros perfiles de Chrome. Entre paréntesis va el nombre en inglés de cada sección del panel, porque las etiquetas en español pueden variar un poco según el idioma de la interfaz.

> **¿Tenéis que publicarla?** Si solo la vais a usar vosotros, también podéis cargarla sin publicar: en `chrome://extensions` activáis el *Modo de desarrollador* y elegís *Cargar descomprimida* → carpeta `extension/`. Es gratis e inmediato, pero hay que repetirlo en cada perfil, no se actualiza sola y Chrome puede recordaros que tenéis extensiones en modo desarrollador. Con la tienda se instala con un clic, se sincroniza entre dispositivos y se actualiza automáticamente.

## Resumen

1. Crear la cuenta de desarrollador (pago único de 5 USD).
2. Generar el ZIP (`npm run package`).
3. Publicar la política de privacidad en una URL pública.
4. Subir el ZIP y completar la ficha, las prácticas de privacidad y la distribución.
5. Enviar a revisión.
6. Instalarla en cada perfil desde el enlace de la tienda.

---

## 1. Crear la cuenta de desarrollador

1. Elegid la cuenta de Google que será la propietaria de la extensión. Mejor una que vayáis a conservar: una cuenta compartida del equipo o la vuestra principal.
2. Activad la **verificación en dos pasos** en esa cuenta (<https://myaccount.google.com/security>). La tienda la exige para publicar.
3. Entrad en el panel de desarrollador: <https://chrome.google.com/webstore/devconsole>.
4. Aceptad el acuerdo de desarrollador y pagad la **cuota de registro, un pago único de 5 USD**.
5. En **Cuenta** (*Account*):
   - Indicad el nombre de editor que verán los usuarios.
   - Verificad el **correo de contacto**. Sin verificarlo no se puede publicar.
   - Declarad si sois **comerciante** o **no comerciante** (requisito de la normativa europea DSA). Para una herramienta gratuita y sin fines comerciales lo habitual es *no comerciante*.

## 2. Preparar el paquete

```bash
npm install
npm run lint && npm test && npm run test:e2e   # todo en verde antes de publicar
npm run package                                # → dist/easymarker-1.0.0.zip
```

- La versión sale de `extension/manifest.json` (`"version"`). **Cada envío a la tienda necesita una versión mayor que la anterior** (1.0.0 → 1.0.1 → 1.1.0…).
- El ZIP lleva `manifest.json` en la raíz, que es lo que pide la tienda. Si preferís crearlo a mano, comprimid el **contenido** de `extension/`, no la carpeta.

## 3. Publicar la política de privacidad

La tienda pide una URL pública con la política de privacidad. Ya está redactada en [`PRIVACY.md`](../PRIVACY.md), en español e inglés, y se publica directamente desde el repositorio:

1. Haced público el repositorio: en GitHub, *Settings* → *General* → *Danger Zone* → *Change visibility* → *Public*.
2. Comprobad en una ventana de incógnito que esta URL se abre sin iniciar sesión:
   `https://github.com/NachoAC/EasyMarker/blob/main/PRIVACY.md`
3. Esa es la URL que va en el paso 4.2.

Si algún día el repositorio vuelve a ser privado, esa URL dejará de funcionar y la tienda puede retirar la extensión. En ese caso, publicad la política en otro sitio (Google Sites o un documento de Google publicado en la web) y actualizad la URL en el panel.

## 4. Subir el elemento y completar la ficha

En el panel pulsad **+ Nuevo elemento** (*New item*) y subid `dist/easymarker-1.0.0.zip`. Se abre el borrador con varias pestañas.

### 4.1 Ficha de la tienda (*Store listing*)

| Campo | Qué poner |
| --- | --- |
| Descripción breve | Sale del manifiesto (`extDescription`, ya en español e inglés). |
| Descripción | El texto de abajo. |
| Categoría | *Productividad* → *Herramientas* (*Productivity → Tools*). |
| Idioma | Español. Las traducciones de `_locales/en` se detectan solas. |
| Icono de la tienda (128×128) | `extension/icons/icon128.png` |
| Capturas (1280×800, de 1 a 5) | `store/screenshot-1-start.png` … `store/screenshot-5-done.png` |
| Mosaico promocional pequeño (440×280) | `store/promo-small-440x280.png` |
| Mosaico de marquesina (1400×560) | Opcional. Solo se usa si Google destaca la extensión. |
| Sitio web / URL de asistencia | Opcional: `https://github.com/NachoAC/EasyMarker`. |

Las capturas de `store/` se generan con datos de ejemplo (`npm run test:e2e -- --screenshots`). Podéis sustituirlas por capturas de vuestros propios marcadores si lo preferís.

**Descripción (español):**

```
EasyMarker revisa los marcadores y la lista de lectura de tu perfil de Chrome y comprueba cada enlace:

• Si un enlace ha cambiado de dirección, te propone actualizarlo.
• Si ya no existe (404, 410, dominio caducado…), te propone eliminarlo.
• Si sigue funcionando, lo deja como está.

Antes de cambiar nada te muestra una pantalla de revisión con dos listas, "Para actualizar" y "Para eliminar", donde marcas o desmarcas cada enlace. Los casos dudosos (redirecciones temporales, errores del servidor, enlaces que ahora llevan a la portada) aparecen desmarcados para que decidas tú.

Tras actualizar, recupera los iconos de los marcadores que han cambiado de dirección, para que no se queden con el globo gris.

Privacidad: todo ocurre en tu navegador. EasyMarker no tiene servidores ni analíticas y no envía tus datos a ningún sitio. Las comprobaciones se hacen sin cookies, así que no usa tus sesiones.

Incluye una copia de seguridad de tus marcadores con un clic, en el formato estándar que Chrome puede importar.
```

**Descripción (inglés)**, para la ficha en inglés (*Add a language* → English):

```
EasyMarker reviews the bookmarks and reading list in your Chrome profile and checks every link:

• If a link has moved, it suggests updating it.
• If it no longer exists (404, 410, expired domain…), it suggests removing it.
• If it still works, it leaves it alone.

Before changing anything it shows a review screen with two lists, "To update" and "To remove", where you tick or untick each link. Uncertain cases (temporary redirects, server errors, links that now land on the homepage) start unticked so you decide.

After updating, it brings back the icons of bookmarks that moved, so they don't show the generic globe.

Privacy: everything happens in your browser. EasyMarker has no servers or analytics and never sends your data anywhere. Checks are made without cookies, so your sessions are never used.

Includes a one-click backup of your bookmarks in the standard format Chrome can import.
```

### 4.2 Prácticas de privacidad (*Privacy practices*)

Es lo que más pesa en la revisión. Copiad estos textos (en inglés, que es lo que leen los revisores):

**Propósito único (*Single purpose*):**

```
Check the links in the user's bookmarks and reading list, and update the ones that moved or remove the ones that no longer exist, only after the user reviews and confirms each change.
```

**Justificación de permisos:**

| Permiso | Justificación |
| --- | --- |
| `bookmarks` | `Read the user's bookmarks to check their links, and update or remove the bookmarks the user explicitly selects and confirms on the review screen.` |
| `readingList` | `Read the user's reading list to check its links, and update or remove the entries the user explicitly selects and confirms on the review screen.` |
| `webRequest` | `Observe only the extension's own link-check requests during a scan, to read each redirect's status code (301 permanent vs 302 temporary) and the exact network error (e.g. ERR_NAME_NOT_RESOLVED for a dead domain), which fetch() does not expose. Listeners are registered only while a scan runs, filter on the extension's own origin, and never block or modify requests.` |
| `declarativeNetRequestWithHostAccess` | `Isolates the optional icon refresh. After the user applies changes, each updated page is opened once in a minimized background tab so Chrome caches its favicon (no API can set a bookmark's icon). Session rules scoped with tabIds to those tabs only, and removed when they close, strip cookies (Cookie and Set-Cookie), block scripts, styles, fonts, frames, media and XHR, and append a "sandbox" CSP so the page is inert. No other request is ever blocked or modified.` |
| Permiso de host (`http://*/*`, `https://*/*`, opcional) | `Bookmarks can point to any website, so checking whether a link still works requires requesting that URL. The permission is optional and requested at runtime when the user clicks "Check links". Requests are anonymous (no cookies, no referrer) and only the HTTP status is read; the response body is discarded. Optionally, after applying changes, each updated page is opened once in a minimized background tab so Chrome caches its favicon; host access is what lets the declarativeNetRequest rules isolate those visits and lets the extension see when the icon has loaded so the tab can be closed.` |

**Código remoto (*Remote code*):** *No, no uso código remoto*. Todo el JavaScript va dentro del paquete.

**Uso de datos (*Data usage*):**

- En *¿Qué datos de usuario recoges?* **no marquéis ninguna categoría**: EasyMarker procesa los marcadores solo en el dispositivo y no transmite nada a ningún servidor propio ni de terceros.
- Marcad las **tres certificaciones**: no vendéis ni transferís datos a terceros fuera de los casos permitidos, no los usáis para fines ajenos al propósito único y no los usáis para evaluar solvencia ni conceder préstamos.
- **URL de la política de privacidad:** la del paso 3.

### 4.3 Distribución (*Distribution*)

- **Pago:** gratuita.
- **Visibilidad**, según cómo queráis instalarla:
  - **No listada (*Unlisted*)** — *recomendada para vuestro caso*: no aparece en búsquedas, pero cualquiera con el enlace puede instalarla. Es lo más cómodo para instalarla en vuestros perfiles.
  - **Privada (*Private*):** solo la pueden instalar las cuentas que añadáis como testers o, con Google Workspace, los usuarios de vuestro dominio.
  - **Pública (*Public*):** aparece en la tienda para todo el mundo.
- **Regiones:** todas, o las que prefiráis.

## 5. Enviar a revisión

1. Revisad que no queden avisos en ninguna pestaña. El botón de envío se desactiva si falta algo.
2. Pulsad **Enviar para revisión** (*Submit for review*). En el diálogo podéis elegir:
   - **Publicar automáticamente** en cuanto se apruebe, o
   - **publicación diferida**: tras la aprobación tenéis un plazo para publicarla cuando queráis con el botón *Publicar*.
3. La revisión suele tardar entre unas horas y unos pocos días. Los permisos amplios (acceso a todos los sitios y `webRequest`) pueden alargarla: por eso las justificaciones del paso 4.2 son importantes.
4. Recibiréis un correo con el resultado. Si la rechazan, el correo indica el motivo y su código. Corregidlo, subid una versión nueva y volved a enviarla.

## 6. Instalarla en vuestros perfiles

1. Abrid la ficha de la extensión: en el panel, *Ver elemento*, o la URL `https://chromewebstore.google.com/detail/<id-de-la-extensión>`. Si es *No listada*, compartid ese enlace.
2. En **cada perfil de Chrome** donde la queráis, abrid el enlace y pulsad **Añadir a Chrome**. Cada perfil es independiente.
3. Para tenerla a mano, fijadla en la barra: icono del puzzle → chincheta junto a EasyMarker.
4. Si el perfil tiene la sincronización activada con *Extensiones*, se instalará sola en los demás dispositivos donde uséis ese perfil.

Primer uso: al pulsar **Analizar enlaces**, Chrome pide permiso para acceder a los sitios web. Hay que aceptarlo para poder comprobar los enlaces, y se puede retirar cuando queráis en `chrome://extensions` → EasyMarker → *Detalles* → *Acceso a sitios*.

## 7. Publicar actualizaciones

1. Subid la versión en `extension/manifest.json`, por ejemplo `1.0.0` → `1.0.1`.
2. Ejecutad `npm run lint && npm test && npm run test:e2e` y después `npm run package`.
3. En el panel: elemento → **Paquete** (*Package*) → **Subir paquete nuevo** → **Enviar para revisión**.
4. Una vez aprobada, Chrome actualiza la extensión automáticamente en todos los perfiles en pocas horas.
