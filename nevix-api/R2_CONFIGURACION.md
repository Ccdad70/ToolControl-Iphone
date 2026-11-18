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

## Uso y conversión automática de películas
1. En NÉVIX, abre Administración y selecciona un archivo de video **MP4, M4V, MKV, AVI, MOV, WEBM, WMV, MPEG, MPG, TS o M2TS**, hasta **5 GiB** por archivo. **AC3 y DTS son formatos de audio dentro del video**, no tipos de película que puedan subirse sin imagen.
2. NÉVIX carga el archivo privado a R2 por bloques de **5 MiB**, reintentando errores de red y verificando el tamaño final.
3. El original queda en estado **Verificando compatibilidad** y no aparece como película disponible hasta terminar. FFprobe identifica el formato, códec de video, tipo de audio, número de canales y duración.
4. Si es **MP4 progresivo H.264 (8 bits 4:2:0) y AAC estéreo/mono**, se habilita el archivo original sin cambios.
5. Para MP4 fragmentado u otros contenedores con video H.264 compatible, FFmpeg puede **copiar el video sin recodificarlo**. Para **H.265, MPEG-4/Xvid, VP8/VP9, ProRes y otros videos decodificables**, FFmpeg intenta convertir a **H.264 8 bits**, con calidad CRF 21 y resolución original. Estas conversiones pueden ser lentas y requieren CPU y disco temporal.
6. Si el audio es **AC3, DTS, MP3 u otro códec decodificable**, NÉVIX genera AAC estéreo para el navegador. Cuando la fuente tiene **6 o más canales**, también conserva una pista **AAC 5.1** en el MP4; el archivo original mantiene intacto su audio AC3/DTS. La selección y reproducción de la pista 5.1 depende del reproductor y el dispositivo.
7. Tras validar video, audio, duración y tamaño, la versión compatible se guarda en R2 y el original se conserva como **respaldo**. Si falta título o portada, se usa **Revisar pendientes**. Si ocurre un fallo, el original queda en R2 y el video no se publica por error.
8. El acceso familiar reproduce solamente archivos **MP4 compatibles y aprobados** a través de rutas de NÉVIX con expiración y soporte HTTP Range. No se hace público el bucket.

**Límites actuales:** El servicio web usa el plan **gratuito de Render** (CPU y memoria limitadas, almacenamiento temporal efímero). Las conversiones de películas grandes, formatos 4K o H.265 pueden exceder la memoria, el espacio disponible o los 30 minutos previstos por trabajo y quedar marcadas como **Preparación incompleta**. No se asegura éxito para todos los formatos/codecs; el original permanece intacto en R2. Para producción con archivos grandes conviene ejecutar transcodificación en un trabajador independiente con CPU y almacenamiento adecuados.

## Corregir título, año o portada de una película
En Administración, entra con el código privado y pulsa **Gestionar títulos, portadas y películas**. Localiza la película disponible, selecciona **Editar título y portada**, escribe el título correcto y el año, y pulsa **Buscar portada correcta**. Se muestra una vista previa de TMDB (con el título/año encontrado). Verifica la imagen y pulsa **Guardar título y portada**. La película se actualiza en el catálogo sin volver a subir el archivo ni modificar su copia en R2. La búsqueda exige coincidencia de título y año aproximado; si no se encuentra, comprueba el título original o el nombre internacional.

## Borrar películas
En Administración, introduce el código del servidor y pulsa **Gestionar títulos, portadas y películas**. La lista distingue las copias disponibles, las pendientes de verificación y los respaldos. Cada botón **Eliminar** borra un solo archivo real de R2 y requiere escribir **ELIMINAR**. Si una película tiene una versión reparada y un respaldo, elimina ambos por separado si deseas liberar todo el almacenamiento. Esta acción es irreversible. No se borran películas al modificar código o al limpiar la caché.

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
