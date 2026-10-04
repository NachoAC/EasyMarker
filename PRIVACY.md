# Política de privacidad de EasyMarker

*Última actualización: 4 de octubre de 2026*

EasyMarker es una extensión de Chrome que comprueba si los enlaces de tus marcadores y de tu lista de lectura siguen funcionando.

## Qué datos usa

- **Marcadores y lista de lectura** del perfil de Chrome donde está instalada: títulos, direcciones y carpetas. Los lee para comprobar los enlaces y, solo cuando tú lo confirmas, actualiza o elimina los que elijas.

## Qué hace con ellos

- Todo el proceso ocurre **dentro de tu navegador**. EasyMarker no tiene servidores y **no recoge, guarda, vende ni comparte** ningún dato contigo ni con terceros. No usa analíticas, publicidad ni código remoto.
- Para comprobar un enlace, la extensión hace una petición a esa dirección, igual que si la abrieras. El sitio enlazado recibe esa petición, como ocurre al visitarlo. Las peticiones se envían **sin cookies y sin cabecera `Referer`**.
- Los resultados del análisis solo existen en memoria mientras la pestaña de EasyMarker está abierta.
- La copia de seguridad opcional es un archivo que se descarga en tu equipo. La extensión no lo envía a ningún sitio.

## Permisos

| Permiso | Para qué |
| --- | --- |
| `bookmarks` | Leer tus marcadores y aplicar los cambios que confirmes. |
| `readingList` | Leer tu lista de lectura y aplicar los cambios que confirmes. |
| `webRequest` | Ver el código de cada redirección (301 frente a 302) y el error exacto (por ejemplo, un dominio inexistente) de las peticiones que hace la propia extensión durante un análisis. No se observa ni se modifica ninguna otra navegación. |
| Acceso a sitios web (opcional) | Hacer las peticiones de comprobación. Chrome lo pide la primera vez que inicias un análisis y puedes retirarlo en cualquier momento desde `chrome://extensions`. |

## Contacto

Si tienes dudas sobre esta política, abre una incidencia en el repositorio del proyecto.

---

# EasyMarker privacy policy (English)

*Last updated: October 4, 2026*

EasyMarker is a Chrome extension that checks whether the links in your bookmarks and reading list still work.

- It reads your **bookmarks and reading list** (titles, addresses, folders). It changes or removes only the items you explicitly confirm.
- Everything happens **inside your browser**. EasyMarker has no servers and **does not collect, store, sell or share** any data. There are no analytics, ads or remote code.
- To check a link, the extension requests that address, just as if you opened it, so the linked site receives that request. Requests are sent **without cookies and without a `Referer` header**.
- Scan results live only in memory while the EasyMarker tab is open. The optional backup is a file downloaded to your computer.
- Permissions: `bookmarks` and `readingList` to read and apply your confirmed changes; `webRequest` to observe the extension's own check requests (redirect status codes and network errors) during a scan; optional website access, requested when you start the first scan, to make those requests. You can revoke it anytime at `chrome://extensions`.

Questions: open an issue in the project's repository.
