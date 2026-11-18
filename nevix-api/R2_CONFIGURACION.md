# NÉVIX TV — Cloudflare R2 (único almacenamiento de películas)

## Configurar Cloudflare
1. Entra en https://dash.cloudflare.com/ y abre **R2 Object Storage**.
2. Crea un bucket **privado**, por ejemplo `nevix-movies`.
3. En **Manage R2 API Tokens**, crea credenciales S3 con permisos **Object Read & Write** limitados a ese bucket. Apunta el **Account ID**, **Access Key ID** y **Secret Access Key**.
4. No publiques el bucket; no necesitas dominio público ni reglas CORS. Las películas viajan del navegador al backend por bloques, y la reproducción se sirve con una ruta privada de NÉVIX.

## Configurar Render
Abre https://dashboard.render.com/web/srv-dbts2cjl550s7396frj0 y ve a **Environment**. Añade:
- `R2_ACCOUNT_ID` — Account ID Cloudflare (32 caracteres hexadecimales).
- `R2_BUCKET` — nombre exacto del bucket privado.
- `R2_ACCESS_KEY_ID` — credencial S3 R2.
- `R2_SECRET_ACCESS_KEY` — secreto S3 R2.

Conserva los códigos actuales de `NEVIX_FAMILY_ACCESS_CODE` y `NEVIX_PRIVATE_ADMIN_KEY`, además de `WATCHMODE_API_KEY` y `TMDB_API_KEY`; no los cambies. **Nunca pegues secretos en este chat ni en GitHub**.

## Uso
1. En NÉVIX entra en Administración y elige un archivo **.mp4** de hasta 5 GiB (exclusivo MP4).
2. La app inicia una sesión privada. El navegador envía **bloques de 5 MiB** a la API en Render, que firma cada parte y la guarda en Cloudflare R2. El código reintenta fallos transitorios y comprueba el tamaño final.
3. Una vez guardado en R2, NÉVIX pone el MP4 en **Verificando compatibilidad**. El backend ejecuta FFprobe y examina la estructura MP4: si contiene H.264 (AVC), audio AAC o sin pista de audio, e índice MP4 progresivo, lo habilita sin modificarlo; si es un MP4 fragmentado o tiene el índice al final, ejecuta **FFmpeg con copia de pistas (sin recodificar)**, guarda una nueva versión y conserva el original como respaldo. Un MP4 no se publica mientras la verificación está en curso.
4. Si no hay coincidencia de título/portada, el MP4 verificado queda en **Revisar pendientes**. Los MP4 incompatibles sin una corrección segura quedan como **Verificación fallida** y no se publican.
5. El acceso familiar permite reproducir las películas en el reproductor de NÉVIX. El servidor entrega un enlace interno con vencimiento y responde a solicitudes `Range`; no expone las credenciales de R2 ni hace público el bucket.

**Recomendación de archivo:** MP4 con video H.264 (AVC), audio AAC, y cabecera de inicio rápido (`faststart`). La extensión .mp4, por sí sola, no garantiza la compatibilidad con Android. Esta versión **reorganiza automáticamente el contenedor cuando es necesario, pero no cambia códecs ni recodifica**. Los archivos HEVC/H.265 u otros audios distintos de AAC pueden requerir una conversión externa y no se habilitan automáticamente.

## Borrar películas
En Administración, introduce el código del servidor y pulsa **Administrar y eliminar películas de R2**. La lista distingue las copias disponibles, las pendientes de verificación y los respaldos. Cada botón **Eliminar** borra un solo archivo real de R2 y requiere escribir **ELIMINAR**. Si una película tiene una versión reparada y un respaldo, elimina ambos por separado si deseas liberar todo el almacenamiento. Esta acción es irreversible. No se borran películas al modificar código o al limpiar la caché.

## Verificación
- Al iniciar Render, buscar en Logs `NÉVIX R2 readiness: multipart=true`.
- Desde la web, en Administración, confirmar `Cloudflare R2 está conectado y permite subir MP4`.
- Subir primero un MP4 pequeño y reproducirlo en Samsung; después probar el archivo de tamaño real.
- Verificar listado, identificación de portada, acceso familiar, reproducción, `Range`, error de credenciales y visualización de progreso.
- Para MP4 nuevos, comprobar ambos casos: MP4 H.264/AAC estándar (sin reparación) y MP4 fragmentado (FFmpeg automático). Confirmar que no se publique antes de finalizar el trabajo, y que el original siga guardado.
- Verificar borrado por administrador, cancelación, intento sin código, borrado de copia y respaldo por separado, y que el archivo ya no aparezca en R2.
- Al hacer cambios: desplegar la rama aislada `nevix-tv-live` con `clearCache=true` en Render. La web no registra service worker; las versiones se prueban con URLs que incluyen una etiqueta de versión.

## Notas sobre el proveedor anterior
NÉVIX ya no requiere ni lee secretos, URLs ni archivos del almacenamiento anterior. Los archivos antiguos no se trasladan; el usuario sube nuevos MP4 a R2. Eliminar los datos históricos y cancelar la facturación del proveedor anterior requiere actuar en su portal. Eliminar claves en Render no cancela una suscripción externa.
