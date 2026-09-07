# Instalación propia

## Base de datos y acceso

1. Crea un proyecto Supabase nuevo y ejecuta `database/schema.sql`. Crea tres perfiles vacíos, sin datos familiares.
2. Configura un cliente OAuth web de Google y activa Google en Supabase → Authentication → Sign In / Providers. Introduce el secreto directamente allí.
3. Registra el callback mostrado por Supabase en las URI de redirección autorizadas de Google.
4. Configura Site URL y los retornos exactos en Supabase → URL Configuration. Para desarrollo añade `http://localhost:3000/`.
5. Autoriza cada correo desde el SQL Editor como administrador:

```sql
insert into private.allowed_emails(member_id,email)
values ('carlitos', lower('TU_CORREO_GOOGLE'));
```

Repite para `papa` y `mama`. El primer acceso confirmado de Google vincula el perfil. Para identidades que accedieron antes de ser autorizadas, la vinculación administrativa debe comprobar el correo confirmado y el proveedor en `auth.users`. No uses metadatos editables por el usuario para conceder permisos.

Las instalaciones anteriores al descanso diario deben ejecutar `database/upgrades/daily_sleep.sql` una sola vez. Las nuevas ya tienen esas columnas en el esquema.

## Variables

Copia `.env.example` a `.env.local` y completa URL y clave publicable de tu proyecto. `VITE_ENABLE_DEMO=true` habilita el botón de demostración ficticia también en producción. Sin Supabase, la demostración está siempre disponible.

Nunca pongas claves administrativas ni secretos OAuth en variables `VITE_`.

## Publicación

Ejecuta `npm run build` y publica solo `dist/client` en Cloudflare Pages. Para carga directa, comprime su contenido y súbelo mediante **Create deployment → Upload assets**. No subas la raíz del proyecto.

Para una nueva integración Git usa Node 24, comando `npm run build`, salida `dist/client` y las variables de entorno del proyecto. El proyecto existente de carga directa puede actualizarse por carga o mediante `npm run deploy` tras autenticar Wrangler.

## Verificación y respaldo

Comprueba OAuth, lectura, escritura y aislamiento con el administrador, cada familiar y una cuenta no autorizada. Revisa los Security Advisors. Una cuenta no autorizada no debe ver perfiles, planes ni registros.

Los respaldos contienen datos de la aplicación, no identidades de autenticación ni configuración OAuth. No existe restauración automática; recuperar requiere validar esquema y relaciones y vincular las identidades de destino.
