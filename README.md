# ToolControl-Iphone

## ToolControl iPhone V2.6.9 — sincronización con Android (30 octubre 2026)

- Las pantallas de recordatorio matutino consultan y actualizan el sistema ACTUAL de Android: `tc_morning_v263_config_get` / `tc_morning_v263_config_save`. El antiguo horario `tc_daily_admin_config` ya no se utiliza para esta configuración.
- El principal puede activar/desactivar recordatorios, cambiar el horario de America/New_York, días de envío y texto (10–480 caracteres). Supabase valida la autorización. Si ajusta la hora desde el iPhone debe abrir ToolControl en el Android autorizado antes de la hora indicada para sincronizar la alarma nativa; iOS no puede programarla por él.
- Consulta de estado por usuario vía `tc_morning_v269_iphone_status` (privacidad enforced en Supabase). La cuenta principal y el remitente autorizado ven totales. Diferencia envío aceptado por Android vs. acuse de entrega opcional de la operadora.
- El inventario, búsqueda de herramientas por modelo/serie/QR, recuadro de escáner, agrupación, asignaciones, devoluciones, seguimiento y gestión de teléfonos administrativos existentes se mantienen.
- iPhone continúa como PWA. NO puede disparar SMS automáticos en segundo plano, manipular permisos Android ni reemplazar la SIM del remitente autorizado. Ninguna función PUSH está activa.
- El enlace de iPhone es el mismo: https://ccdad70.github.io/ToolControl-Iphone/ . Para actualizar una instalación existente, abrir desde Safari en línea y volver a iniciar la app agregada a Inicio.
- La validación automatizada de GitHub Pages prueba las funciones de iPhone; la captura de cámara, el envío final y la sincronización Android necesitan verificación en dispositivos reales.


## Publicación automática

El flujo `.github/workflows/publicar-iphone.yml` publica esta versión mediante GitHub Pages. Para instalarla, abre la dirección Pages en Safari y pulsa Compartir → Añadir a pantalla de inicio.

## ToolControl iPhone V2.4 — Inventario General (26 octubre 2026)

Se incorporaron grupos automáticos por tipo/nombre (incluidos Impacto, Hole Hawg y grupos nuevos), recuento por categoría, búsqueda por nombre, marca, modelo, número de serie, código QR y trabajador, y escaneo de códigos QR/barras para encontrar la herramienta. El lector y las funciones de entrega, devolución y registro se mantienen; Android no cambia.

El enlace de instalación continúa siendo https://ccdad70.github.io/ToolControl-Iphone/ . Si la versión anterior queda guardada en la pantalla de inicio, abre el enlace en Safari con conexión y vuelve a iniciar la aplicación para actualizar el caché.

## Recuadro de escaneo iPhone V2.4 (26 octubre 2026)

La cámara incorpora esquinas verdes y una línea animada que orientan el QR/código de barras. Al reconocer un código muestra una confirmación visual verde; el sonido y el proceso existente no se alteran. Disponible al buscar herramientas, registrar, entregar y recibir. El marco es una guía visual y no limita la detección a su interior.

El enlace de instalación sigue siendo https://ccdad70.github.io/ToolControl-Iphone/ . Si no aparece el recuadro, abre el enlace en Safari con Internet y luego reinicia la aplicación instalada desde la pantalla de inicio para actualizar la caché.

## Inicio iPhone V2.4 igual a Android — 26 de octubre de 2026

Actualización visual basada en la pantalla Android suministrada: crédito de desarrollo, indicadores Activas/Disponibles/Prestadas, tarjetas azul oscuro en dos columnas y accesos a Registro múltiple, Registrar herramienta, Entregar, Recibir e Inventario. El registro múltiple abre el formulario existente y utiliza el botón para escanear herramientas iguales. Mantiene navegación inferior, datos de Supabase, escáner animado QR, inventario agrupado y todas las funciones previas. No modifica Android.

Enlace sin cambios: https://ccdad70.github.io/ToolControl-Iphone/ . Si la app instalada en Inicio conserva la vista anterior, abre el enlace en Safari y reinicia la aplicación de la pantalla de inicio para actualizar el caché.

## ToolControl V2.4 — nueva imagen de marca

El logo azul de ToolControl y los iconos de la aplicación se actualizaron. El enlace de instalación no cambia.
