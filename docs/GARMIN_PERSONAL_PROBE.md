# Garmin Personal: prueba de solo lectura

Estado del contrato revisado: 22 de octubre de 2026. Primera fase de conectividad, no importación de métricas ni sustitución de Freddy. Sustituye el experimento de Colab por un Worker independiente de la web y del PC. No hay cuadernos Colab en este repositorio que retirar.

## Contrato oficial y límites verificados

- [Personal API](https://developer.garmin.com/gc-developer-program/personal/personal-api/): el único POST es el canje de clave en `https://personal.connectapi.garmin.com/personalapitoken-service/personal-api/personal-api-key/token`, con `Authorization: ApiKey …`. Las consultas usan el token mediante `Authorization: Bearer …`.
- [FAQ Personal](https://developer.garmin.com/gc-developer-program/personal/personal-faq/): acceso a los datos de la propia cuenta; no es una autorización para prestar un servicio comercial a múltiples usuarios. Claves con caducidad seleccionable (30/90/180 días o un año), tokens de hasta 24 horas o hasta que caduque la clave. No hay refresh token. Eliminar la clave invalida también sus tokens.
- [Swagger oficial](https://developer.garmin.com/gc-developer-program/personal/swagger-docs/), versión 1.0.0: comprobados métodos, parámetros y esquemas de las cuatro lecturas. La FAQ no especifica el nombre del campo en la respuesta del canje; el parser acepta `access_token` o `accessToken` y falla de forma cerrada ante otro formato. Esto requiere todavía contrastar una respuesta autenticada real.
- No se ha localizado una cuota numérica global ni una garantía de profundidad histórica en las páginas Personal consultadas. No extrapolar los límites Enterprise/Starter ni confundir la paginación con una cuota. El cliente limita por decisión propia cada ejecución a un canje y cuatro GET secuenciales, sin paginar ni reintentar, como máximo una ejecución cada 24 horas. Respeta un `Retry-After` más largo en 429/503. Un 401/403, 429, 5xx o fallo de red detiene el lote.
- La modalidad Personal permite lecturas por petición (pull). Esta prueba no incluye Training, escritura en Garmin, archivos FIT, rutas GPS ni datos de otras personas.

Consultas exactas, siempre al mismo dominio oficial:

1. Actividades: `GET /activitylist-service/activities/search/activities`, con `start=0`, `limit=3`, `sortOrder=desc`, `sortBy=startLocal`, `excludeChildren=true`, `startDate` y `endDate`. Ventana de siete fechas completas; es una muestra de hasta tres resultados, no un recuento total de entrenamientos.
2. Resumen diario: `GET /usersummary-service/usersummary/daily?calendarDate=YYYY-MM-DD`.
3. Sueño: `GET /sleep-service/sleep/dailySleep?date=YYYY-MM-DD`.
4. HRV: `GET /hrv-service/hrv/YYYY-MM-DD`. El Swagger documenta 204 para ausencia de datos.

La fecha diaria es ayer en Europe/Madrid. Actividades se filtran según la fecha local registrada por Garmin; antes de cualquier importación hay que verificar la zona de la cuenta y viajes. La existencia de un resumen no acredita cobertura completa ni cumplimiento de un plan. Las observaciones diarias cuentan únicamente si hay pasos, duración de sueño o HRV nocturna válidos; un valor nulo no se transforma en cero. Un 404 queda como `not_found`, no como ausencia confirmada.

## Aislamiento y privacidad

`workers/garmin-personal/` se despliega por separado de Pages. No se importa desde React/Vite, no usa variables `VITE_`, y no dispone de credenciales Supabase. El Worker solo devuelve fecha de consulta, estado HTTP/código cerrado y recuentos. No devuelve ni almacena nombres, IDs de cuenta/actividad, coordenadas, métricas, comentarios, cuerpos de error, cabeceras, claves o tokens. Los datos recibidos solo viven en memoria durante la petición.

Una instancia única de Durable Object conserva el presupuesto y el último diagnóstico sanitizado. Reserva la ejecución de forma transaccional antes de llamar a Garmin para bloquear duplicados, reinicios y concurrencia. El diagnóstico expira a los siete días; un bloqueo de `Retry-After` más largo se conserva hasta vencer. La retención de copias operativas de Cloudflare/PITR es independiente. No se persiste el token de Garmin; se solicita uno nuevo por ejecución.

`POST /probe` y `GET /status` exigen un token de administración separado de al menos 32 caracteres aleatorios. No aceptan cuerpos, fechas, URL de destino ni credenciales Garmin como parámetros. No habilitan CORS. No hay endpoint público de métricas. El dominio del Worker es accesible por Internet, pero sus dos rutas requieren autenticación. Se desactivan observabilidad y URLs de preview, y el código no registra mensajes. No añadir Logpush/Tail que capture cabeceras, cuerpos o bindings. El acceso y la retención de metadatos de plataforma deben revisarse en la cuenta de Cloudflare.

Todas las peticiones tienen un plazo de ocho segundos que cubre también la lectura del cuerpo. Se rechazan redirecciones, HTML, JSON inválido y respuestas excesivas (32 KiB para canje, 512 KiB para datos). Las excepciones se convierten a códigos fijos. No hay bucles de login ni renovación automática de claves.

## Relación con Supabase y el flujo existente

Se revisaron `database/migrations/20260914_health_reviews.sql`, `20260914_manual_review.sql`, `database/cloud_review_inbox.sql`, el normalizador Freddy y `docs/HEALTH_AUTOMATION.md`. El catálogo del proyecto conectado confirma RLS en las tablas de muestras, informes y bandeja, y las rutinas privadas con `SECURITY INVOKER`; no se consultaron métricas familiares para esta revisión.

`private.ingest_health_samples(JSONB)` ya inserta instantáneas con `ON CONFLICT(source_key) DO NOTHING` y separa datos importados de medidas y registros manuales. Es la vía apropiada para una fase posterior, después de validar esquemas, fechas, unidades, procedencia, identidad de eventos y deduplicación con Apple Health/Freddy. No sumar dos fuentes del mismo evento. Los cambios deben añadir instantáneas; las correcciones manuales conservan prioridad.

La bandeja `private.cloud_health_reviews` contiene respuestas Freddy, está ligada a periodos semanales y puede alimentar la creación de informes/borradores. No es una bandeja genérica Garmin. `private.record_health_review` también puede crear un borrador incluso sin propuesta: esta prueba no llama a ninguna de esas rutinas. No modifica el esquema ni expone `private` mediante PostgREST, no escribe datos manuales, informes o planes, y no publica cambios nutricionales.

No se crea una falsa integración con Supabase mediante `supabase.schema('private').rpc(...)`: el esquema privado no es por ello accesible por HTTP. Una fase posterior necesita un adaptador backend con permisos mínimos y pruebas propias, no una clave privilegiada general en el Worker. Esta fase no requiere cambios de permisos ni migraciones Supabase. Freddy continúa funcionando de forma independiente hasta verificar la nueva vía y decidir explícitamente su sustitución.

## Instalación y secretos: paso del propietario

Requisito previo: revocar en [Garmin Connect → Personal API Key](https://connect.garmin.com/app/settings/personalApiToken) cualquier clave compartida en chat, captura o cuaderno. Eliminar también copias y salidas de Colab. Crear otra, aceptar personalmente las condiciones y elegir su caducidad. No pegarla en el chat, terminal, código, archivo `.env`, historial ni repositorio.

1. Autenticar la cuenta Cloudflare con `npx wrangler login` y comprobarla con `npx wrangler whoami`. Se necesita permiso para desplegar Workers, crear una instancia SQLite Durable Object y gestionar secretos/triggers. Comprobar disponibilidad y cuotas del plan. No es necesario cambiar el despliegue Pages existente.
2. Desde la raíz del repositorio: `npm ci`, `npm test`, `npm run lint`, `npm run build`, `npm run garmin:check` y `npm run garmin:runtime`. Los dos últimos empaquetan y prueban localmente con datos ficticios y salidas de red interceptadas. `npm run garmin:deploy` crea el Worker **desactivado**, sin cron y sin datos ni secretos. No ejecutar `npm run deploy`, que corresponde a la web.
3. En Cloudflare Dashboard → Workers & Pages → `nutricion-garmin-personal-probe` → Settings → Variables and Secrets, añadir como tipo **Secret** `GARMIN_PERSONAL_API_KEY`, pegando allí la nueva clave directamente. Crear también **Secret** `PROBE_ADMIN_TOKEN` con un valor aleatorio independiente de 32–512 caracteres generado por un gestor de contraseñas. No utilizar la clave Garmin como token administrador. Guardar los cambios. [Procedimiento oficial](https://developers.cloudflare.com/workers/configuration/secrets/).
4. Activar `PROBE_ENABLED=true`. Preferiblemente cambiar el valor no sensible en `wrangler.jsonc` y volver a ejecutar `npm run garmin:deploy` para evitar que un despliegue posterior lo revierta. Los valores de los secretos no se incluyen en el fichero. El valor por defecto del repositorio permanece `false` durante la primera prueba.
5. Invocar una sola vez desde PowerShell, con la URL devuelta por el despliegue: `./scripts/garmin-probe.ps1 -WorkerUrl https://nutricion-garmin-personal-probe.TU-SUBDOMINIO.workers.dev -Action probe`. El script pide **solo el token administrador**, con entrada oculta; nunca pide la clave Garmin. Para ver el resultado sin llamar de nuevo a Garmin, usar `-Action status`. No capturar pantallas de los secretos.
6. Revisar `authentication` y las cuatro `resources`. Un resultado HTTP 200 del Worker puede contener un error de Garmin: revisar los códigos internos. `no_data` es conectividad válida pero sin observación, `invalid_response` requiere revisar el contrato sin compartir el cuerpo real; `unauthorized` exige revisar caducidad/revocación/región. No reenviar la clave a otros dominios ni hacer fallback a cookies o credenciales de Garmin Connect. `next_allowed_at` es el instante mínimo para otra prueba. El presupuesto de 24 horas también se aplica a fallos.
7. Solo tras validar la consulta real: si se desea un diagnóstico recurrente sin PC, configurar `triggers.crons` como `["0 8 * * *"]` y desplegar. Se ejecuta en UTC (09:00 Madrid en invierno, 10:00 en verano). El presupuesto puede omitir una ejecución por retrasos o una prueba manual reciente; no garantiza un resultado diario. El cron conserva solo el último diagnóstico y **no importa métricas**. [Cron oficial](https://developers.cloudflare.com/workers/configuration/cron-triggers/).

Para detenerlo, cambiar `PROBE_ENABLED=false`, vaciar `triggers.crons` y desplegar. Revocar una clave en Garmin invalida sus tokens. Renovar solo el secreto correspondiente desde Cloudflare; no reutilizar claves expuestas. Una llamada que ya está en curso puede terminar, pero no escribe métricas ni planes.

## Validación y pendiente real

Las pruebas usan exclusivamente fixtures sintéticas: rutas, cabeceras, límites, redirecciones, fechas/DST, errores 401/403/404/429/5xx, JSON inválido, tiempo de espera, cuerpos demasiado grandes, ausencia de datos, autenticación administrativa y presupuesto concurrente/persistente. Las pruebas previas de RLS, ingesta Freddy, planes e informes siguen ejecutándose.

Se valida también el bundle en workerd/Miniflare, con SQLite Durable Object real y todas las salidas de red interceptadas: autenticación administrativa, cuatro lecturas simuladas, consulta de estado y bloqueo de tres ejecuciones concurrentes. Se fija `compatibility_date=2026-09-10`, compatible con el runtime incluido en el lockfile, sin actualizar dependencias. Workers requiere `redirect: manual`; el cliente rechaza cualquier 3xx sin seguir `Location`. Esta prueba local no equivale a un despliegue ni a una consulta real Garmin.

No hay consulta autenticada exitosa ni despliegue remoto confirmado. El intento de conectividad terminó en un error de resolución de red antes de obtener respuesta HTTP, y el acceso Cloudflare disponible estaba caducado. El propietario debe completar los pasos de acceso, secreto y activación anteriores. Los mocks y el empaquetado local prueban el código, no la aceptación de la clave, la cobertura de la cuenta ni el acceso desde las IP de Cloudflare. Hasta disponer de esa evidencia, conservar Freddy y no activar importación ni cambios nutricionales.
