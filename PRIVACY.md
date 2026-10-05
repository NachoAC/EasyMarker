# Política de privacidad de EasyMarker

*Última actualización: 5 de octubre de 2026*

EasyMarker es una extensión de Chrome que comprueba si los enlaces de tus marcadores y de tu lista de lectura siguen funcionando.

## Qué datos usa

- **Marcadores y lista de lectura** del perfil de Chrome donde está instalada: títulos, direcciones y carpetas. Los lee para comprobar los enlaces y, solo cuando tú lo confirmas, actualiza o elimina los que elijas.

## Qué hace con ellos

- Todo el proceso ocurre **dentro de tu navegador**. EasyMarker no tiene servidores y **no recoge, guarda, vende ni comparte** ningún dato contigo ni con terceros. No usa analíticas, publicidad ni código remoto.
- Para comprobar un enlace, la extensión hace una petición a esa dirección, igual que si la abrieras. El sitio enlazado recibe esa petición, como ocurre al visitarlo. Las comprobaciones se envían **sin cookies y sin cabecera `Referer`**.
- **Iconos (opcional, activado por defecto):** después de aplicar los cambios, EasyMarker abre unos segundos cada dirección actualizada en una ventana minimizada, para que Chrome guarde su icono. Esas visitas son **anónimas** (no se envían ni se guardan cookies) e **inertes** (no se ejecuta el código de la página ni se permiten formularios, ventanas emergentes o descargas). Solo se cargan la página y sus imágenes. Quedan en tu historial de Chrome. Puedes desactivarlo en el diálogo de confirmación.
- Los resultados del análisis solo existen en memoria mientras la pestaña de EasyMarker está abierta.
- La copia de seguridad opcional es un archivo que se descarga en tu equipo. La extensión no lo envía a ningún sitio.

## Permisos

| Permiso | Para qué |
| --- | --- |
| `bookmarks` | Leer tus marcadores y aplicar los cambios que confirmes. |
| `readingList` | Leer tu lista de lectura y aplicar los cambios que confirmes. |
| `webRequest` | Ver el código de cada redirección (301 frente a 302) y el error exacto (por ejemplo, un dominio inexistente) de las peticiones que hace la propia extensión durante un análisis. No se observa ni se modifica ninguna otra navegación. |
| `declarativeNetRequestWithHostAccess` | Aislar las visitas que recuperan los iconos: quitar las cookies, bloquear scripts y demás recursos y desactivar el código de la página. Las reglas solo afectan a las pestañas que abre EasyMarker y se eliminan al terminar. |
| Acceso a sitios web (opcional) | Hacer las peticiones de comprobación y aislar las visitas de los iconos. Chrome lo pide la primera vez que inicias un análisis y puedes retirarlo en cualquier momento desde `chrome://extensions`. |

## Contacto

Si tienes dudas sobre esta política, abre una incidencia en el repositorio del proyecto.

---

# EasyMarker privacy policy (English)

*Last updated: October 5, 2026*

EasyMarker is a Chrome extension that checks whether the links in your bookmarks and reading list still work.

- It reads your **bookmarks and reading list** (titles, addresses, folders). It changes or removes only the items you explicitly confirm.
- Everything happens **inside your browser**. EasyMarker has no servers and **does not collect, store, sell or share** any data. There are no analytics, ads or remote code.
- To check a link, the extension requests that address, just as if you opened it, so the linked site receives that request. Checks are sent **without cookies and without a `Referer` header**.
- **Icons (optional, on by default):** after applying changes, EasyMarker opens each updated address for a few seconds in a minimized window so Chrome stores its icon. These visits are **anonymous** (no cookies are sent or stored) and **inert** (the page's code doesn't run; forms, popups and downloads are blocked). Only the page and its images load. They appear in your Chrome history. You can turn this off in the confirmation dialog.
- Scan results live only in memory while the EasyMarker tab is open. The optional backup is a file downloaded to your computer.
- Permissions: `bookmarks` and `readingList` to read and apply your confirmed changes; `webRequest` to observe the extension's own check requests (redirect status codes and network errors) during a scan; `declarativeNetRequestWithHostAccess` to isolate the icon visits (cookies removed, scripts and other resources blocked), only in the tabs EasyMarker opens and only while they are open; optional website access, requested when you start the first scan, to make those requests and isolate those visits. You can revoke it anytime at `chrome://extensions`.

Questions: open an issue in the project's repository.
