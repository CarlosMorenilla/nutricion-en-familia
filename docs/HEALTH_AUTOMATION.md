# Revisión de salud y preparación de planes

## Uso en la web

- **Mi evolución → Registrar mis medidas**: peso, perímetros, grasa medida y su procedencia. Altura, cintura y parámetro de sexo permiten una estimación RFM para adultos. Cada fecha conserva sus parámetros; no se recalculan registros antiguos con la altura actual. RFM estima grasa, nunca músculo. [Método original](https://www.nature.com/articles/s41598-018-29362-1).
- **Mi evolución → Apple Health · Freddy**: datos importados con fecha y dispositivo. El dato del dispositivo y la anotación manual se conservan por separado; al analizar, prevalece la corrección manual explícita. La importación no modifica medidas ni registros diarios.
- **Administración → Revisión semanal**: objetivo, restricciones, informe, diferencias y botón para abrir el borrador. Revisar comidas, raciones e instrucciones antes de publicar en el editor habitual.
- Los CSV y el respaldo incluyen las instantáneas importadas, informes y objetivos visibles para la cuenta. Guardar estos archivos de forma privada.

## Operación programada

La tarea del chat se programa los sábados a las 10:00, Europe/Madrid (incluido cambio de hora). Es una tarea de Codex: requiere el ordenador encendido, la aplicación disponible y sus conexiones autorizadas. La web no ejecuta una API de IA ni cobra por análisis. La tarea consume los límites de la cuenta de Codex; no se garantiza ejecución si está apagado o sin conexión. Revisar la siguiente fecha y los resultados en Tareas programadas.

Para cada ejecución:

1. Calcular el último sábado en la fecha de Madrid. `reviewPeriod` devuelve sábado anterior a viernes y lunes siguiente. No incluir un día en curso. Si la tarea se retrasa, indicar el retraso y la cobertura disponible, sin presentar datos ausentes como ceros.
2. Consultar `health_reports` antes de generar un informe: uno por Carlitos y `period_start`. Si ya existe, no recrear ni alterar su borrador, aunque alguien lo haya editado o publicado.
3. Usar Freddy `get_profile` y `list_metrics` antes de `query_metrics`. Consultar sueño, peso, grasa, masa libre de grasa, entrenamientos, pasos y actividad disponibles. En el plan gratuito comprobar la ventana de consulta y cualquier truncamiento. El catálogo puede enumerar valores históricos que la consulta no devuelve. Registrar la última sincronización.
4. Consultar raw de sueño para resolver fecha de despertar en Madrid y unión de intervalos. Si la ventana empieza a mitad de una noche, marcar esa noche como parcial. No sumar los resúmenes diarios a sus raw. No sumar registros de dispositivos distintos; preferir `_total`/Merged cuando exista. En su ausencia mostrar cada fuente separada. El ejercicio compartido entre apps tampoco se suma dos veces. No equiparar pasos, calorías estimadas o un entrenamiento importado al cumplimiento del plan.
5. Guardar respuestas JSON en `private/` (ignorado por Git). `node --import tsx scripts/normalize-freddy.ts private/input.json private/samples.json` normaliza un array de respuestas de Freddy. El parser falla ante errores y conserva el valor original, dispositivo y fecha. Inspeccionar cobertura y formato; no inventar unidades. Las instantáneas se identifican por hash de contenido; las idénticas se ignoran. Si cambian valores del mismo evento, conservar ambas instantáneas y usar la más reciente en el análisis, nunca sumarlas.
6. Importar por el conector de Supabase del proyecto de nutrición, usando exclusivamente `private.ingest_health_samples(JSONB)`. Esta rutina solo la ejecuta el backend; no introducir claves privilegiadas en la web. Si el conector SQL es de solo lectura, usar una migración de datos de nombre único. Guardar las consultas de datos personales solo en `private/`, nunca en Git. No importar en proyectos antiguos del puente de Salud.
7. Leer `coaching_settings`, registros diarios, medidas, revisiones y último plan publicado de Carlitos. Priorizar correcciones manuales; indicar días observados y fechas. Calcular promedios con denominador, sin atribuir cambios de grasa a una lectura de bioimpedancia aislada. No convertir calorías del reloj automáticamente en comida.
8. Preparar informe en español, con evidencia, límites y cambios antes/después. Si falta el objetivo, usar `insufficient` y solicitarlo. Si falta tendencia corporal, no modificar calorías basándose en un peso aislado; se pueden explicar ajustes de organización o recuperación. Consultar fuentes primarias actuales si se dan recomendaciones de salud. No diagnosticar ni ajustar medicación.
9. Guardar una sola vez mediante `private.record_health_review(JSONB)`. Campos: `period_start`, `status` (`ready`, `insufficient`, `error`), `summary` (texto), `evidence` (objeto), `changes` (array de `{area,before,after,reason}`). Opcional `proposal` con los siete `days` y `notes` personales de Carlitos; solo se acepta con estado `ready` y objetivo guardado. Omitir `proposal` para conservar la base. La función copia automáticamente los platos compartidos y todos los demás miembros sin cambios, crea solo un borrador y enlaza informe/base/borrador de forma transaccional. Si no hay plan de referencia, deja el informe sin borrador y lo explica.
10. Verificar filas guardadas, borrador sin publicar y ausencia de duplicados. Avisar en este chat de lo disponible en Administración y de los datos que falten. Nunca publicar automáticamente. Ante error de Freddy, guardar informe `error` si la base sigue accesible; si tampoco lo está, informar del fallo en la tarea. No afirmar que se ha sincronizado si no se ha comprobado.

## Instalación en otra base

Las revisiones adicionales solicitadas pueden usar `kind: "manual"`, con `period_start` en lunes y final en domingo, para preparar la semana siguiente. Las programadas mantienen `kind: "weekly"` y sábado–viernes. En ambos casos se excluyen periodos incompletos y se conserva una sola revisión por periodo. Una revisión adicional no publica ni sobrescribe los borradores anteriores.

Ejecutar primero `database/schema.sql` y después las migraciones de `database/migrations/` en orden. Las autorizaciones de Google se configuran por separado en `private.allowed_emails`; este repositorio no contiene los correos de la familia. Las tablas nuevas tienen RLS y los clientes reciben solo lectura para importaciones e informes. Las rutinas privadas no son endpoints del navegador.

El código de la web y las pruebas usan datos sintéticos. Los datos reales, consultas privadas y archivos exportados nunca se suben al repositorio público.
