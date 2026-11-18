NÉVIX TV / CONFIGURACIÓN CLOUDFLARE R2

OBJETIVO
Las películas privadas aparecen en la sección Películas, sin menú separado. Los archivos residen en un bucket R2 privado.

PASO 1 — CLOUDFLARE
1. Abre https://dash.cloudflare.com/ y activa R2 Object Storage.
2. Crea un bucket privado, por ejemplo nevix-peliculas-personal.
3. No habilites acceso público por r2.dev ni por dominio público.
4. En la configuración CORS del bucket, añade una regla JSON:
[
  {
    "AllowedOrigins": ["https://nevix-tv-personal.onrender.com"],
    "AllowedMethods": ["GET", "PUT", "HEAD"],
    "AllowedHeaders": ["Content-Type"],
    "ExposeHeaders": ["ETag"],
    "MaxAgeSeconds": 3600
  }
]
5. Crea en R2 una credencial de API con Object Read & Write solo para el bucket. Guarda por separado Access Key ID, Secret Access Key y Account ID. No los compartas ni añadas al repositorio.

PASO 2 — RENDER
Abre https://dashboard.render.com/web/srv-dbts2cjl550s7396frj0 -> Environment. Añade:
R2_ACCOUNT_ID: ID de tu cuenta Cloudflare.
R2_BUCKET: Nombre exacto del bucket.
R2_ACCESS_KEY_ID: Access Key ID de R2.
R2_SECRET_ACCESS_KEY: Secret Access Key de R2.
NEVIX_FAMILY_ACCESS_CODE: código secreto familiar de al menos 12 caracteres.
NEVIX_PRIVATE_ADMIN_KEY: código distinto de administración de al menos 16 caracteres.
No modifiques las claves Watchmode o TMDB ya existentes. Guarda y confirma que el servidor vuelva a estar LIVE.

PASO 3 — SUBIR Y REPRODUCIR
1. En NÉVIX abre Panel privado -> Servidor privado de películas.
2. Introduce la clave administrativa y elige un MP4 (H.264/AAC recomendado) o WebM inferior a 5 GB.
3. Pulsa Subir película. El archivo se envía directamente del navegador a R2 usando un enlace firmado temporal.
4. NÉVIX escanea automáticamente las películas en el prefijo peliculas/, identifica título/año y busca la portada en TMDB.
5. Si hay coincidencia exacta, aparece en Películas. Si no, queda pendiente de revisión y no se mostrará un póster incorrecto.
6. En la PC de tu esposa, pulsa el candado del menú superior e introduce el código familiar; las películas autorizadas aparecen en la sección Películas y pueden reproducirse directamente.

También puedes subir MP4 por el panel de Cloudflare dentro de la carpeta peliculas/ y usar Revisar nuevas películas en el panel de NÉVIX.

RESTRICCIONES Y SEGURIDAD
- Solo alojes películas que tengas autorización para almacenar y transmitir.
- El PIN local es independiente de las claves familiares y administrativas del servidor.
- El servidor no convierte automáticamente MKV; convierte previamente a MP4 H.264/AAC para reproducción amplia.
- Los archivos de más de 5 GB requieren subida multipartes, aún no implementada.
- No se garantiza que todos los archivos MP4 tengan códecs compatibles.
- Los enlaces privados temporales pueden ser usados por cualquiera que los tenga hasta su vencimiento, por lo que no debes compartirlos.
- R2 puede cobrar por almacenamiento y operaciones.
- Tu bucket debe permanecer privado y los tokens limitados al bucket.
- Las credenciales deben introducirse directamente en Render, nunca en ChatGPT/GitHub.
