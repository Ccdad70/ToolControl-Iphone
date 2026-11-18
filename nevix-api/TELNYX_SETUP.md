# NÉVIX TV — Telnyx Storage (servidor privado)

El catálogo público actual de TV, Watchmode y TMDB sigue funcionando aunque Telnyx no esté configurado.
Este backend solo utiliza **Telnyx Storage** para la biblioteca propia, no Cloudflare R2.

## Requisitos
1. En https://portal.telnyx.com crea tu propia cuenta, habilita el servicio Storage y crea un bucket **privado** en US (recomendado: us-east-1).
2. Genera una clave de API para Telnyx. NO la pegues en GitHub, en el HTML ni en un chat público.
3. En Render > servicio `nevix-catalog-api` > Environment define:
   - `TELNYX_API_KEY` = clave de Telnyx (secreta)
   - `TELNYX_STORAGE_BUCKET` = nombre exacto del bucket
   - `TELNYX_STORAGE_REGION` = región del bucket (ejemplo `us-east-1`)
   - `NEVIX_FAMILY_ACCESS_CODE` = código de 12+ caracteres para espectadores autorizados
   - `NEVIX_PRIVATE_ADMIN_KEY` = clave distinta, de 16+ caracteres, para subir películas
4. Render vuelve a desplegar la API tras guardar las variables. Verifica `/health` y `/api/private/status`: `privateStorage` / `configured` deben ser true.
5. En NÉVIX, abre Panel privado, introduce tu clave de administrador, selecciona un MP4 o WebM con video compatible con tu navegador, y pulsa Subir película.
6. La primera carga configura automáticamente CORS solo para `https://nevix-tv-personal.onrender.com` y no hace público el bucket. Desde el panel puedes revisar y corregir las películas pendientes.
7. Para el espectador: abre NÉVIX, inicia acceso familiar desde la pantalla privada y las películas se integran directamente en **Películas**. No hay botón público «Mi biblioteca».

## Seguridad y compatibilidad
- Telnyx usa el token de API como Access Key ID en operaciones S3. El backend puede usar el SDK para listar/leer/escribir, pero **nunca** el presigner de AWS: expondría la clave en la URL.
- Los enlaces de carga y reproducción se solicitan a `https://api.telnyx.com/v2/storage/buckets/{bucket}/{object}/presigned_url` con `Authorization: Bearer` solamente desde el backend; las claves no se envían al navegador.
- El bucket sigue siendo privado. Los enlaces temporales pueden ser utilizados por quien los tenga hasta que caduquen. No compartas códigos, enlaces ni claves.
- Admite carga directa de MP4/WebM de menos de 5 GiB. MKV, HEVC/AC3 y otros códecs pueden requerir conversión externa previa.
- La API busca metadatos y carátulas con TMDB. Los archivos ambiguos permanecen pendientes y no se muestran con carátulas equivocadas.
- Los permisos de autor y distribución de los archivos son responsabilidad del titular. El sitio no facilita extraer material protegido de Netflix.
- **No se han ejecutado pruebas con archivos reales ni con credenciales de Telnyx**: será necesario hacer una subida y reproducción de prueba cuando se configure el bucket.
- No hay transferencia automática de material antiguo desde R2: cualquier archivo que exista allí requiere migración explícita.

## Pruebas sin credenciales
- GET `https://nevix-catalog-api.onrender.com/health`: el catálogo debe devolver ok=true y privateStorage=false hasta configurar Telnyx.
- GET `https://nevix-catalog-api.onrender.com/api/private/status` desde el sitio debe devolver provider "Telnyx Storage" y configured=false hasta configurar.
- Verificar que Watchmode, TMDB, TV, navegación y reproducción del contenido público no se alteraron.
