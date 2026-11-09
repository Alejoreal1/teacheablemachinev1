# Vigía · Registro facial en Google Sheets

Vigía usa la cámara del navegador y un modelo de [Teachable Machine](https://teachablemachine.withgoogle.com/models/GLcHeZx-M/) (clases **Alejo**, **Tigre** y **Nadie**) para decir en pantalla y en voz alta quién está frente a la cámara. Cada detección se guarda como una fila en una hoja de Google Sheets con las columnas:

| Fecha | Estación | Clase | Confianza | Modo | Foto |
| ----- | -------- | ----- | --------- | ---- | ---- |

- **Modo automático**: cuando alguien es reconocido de forma estable (≥ confianza mínima durante ~1 s) se registra solo; "Nadie" nunca se registra. Hay una espera configurable entre registros de la misma persona.
- **Registrar ahora**: guarda la predicción actual con modo `Manual`.
- **Foto**: la captura se guarda en Netlify Blobs y aparece en la hoja con `=IMAGE(...)`.

## Conectar Google Sheets

1. Crea una hoja en <https://sheets.new>.
2. **Extensiones → Apps Script**, pega el código que muestra el botón *Conectar Google Sheets* de la app (está en `src/lib/apps-script.ts`).
3. **Implementar → Nueva implementación → Aplicación web**, ejecutar como *Yo*, acceso *Cualquier persona*.
4. Pega la URL `/exec` en la app y pulsa *Probar y guardar*.

Opcional: define la variable de entorno `GOOGLE_SHEETS_WEBHOOK_URL` en Netlify para que todas las estaciones usen la misma hoja sin configurarla en cada navegador.

## Tecnologías

TanStack Start (React 19), Tailwind CSS 4, TensorFlow.js (inferencia en el navegador), Netlify Blobs (fotos), Google Apps Script (escritura en Sheets), Netlify.

## Desarrollo local

```bash
pnpm install
netlify dev   # emula Blobs y las rutas de servidor
```

La cámara requiere `https` o `localhost`. Para que la columna Foto se vea en Sheets la app debe estar desplegada (Google necesita descargar la imagen desde una URL pública).
