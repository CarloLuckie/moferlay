# SUNDAY CLUB — NFL Confidence Pool

Web app en español para hacer quinielas de NFL con amigos. Incluye **demo local** (se puede abrir de inmediato) y **modo multijugador** con Supabase. No hay que registrar tarjetas ni usar una API deportiva de pago para el MVP.

## Qué puede hacer

- Calendario de todas las semanas de la temporada regular (1 a 18), cargado desde un feed público de ESPN.
- Cada persona elige ganador de cada juego y un nivel de confianza exclusivo del 1 al número de partidos de la semana.
- Acierto = puntos de confianza; error = 0 puntos. Ejemplo: 15 partidos, máximo de 120 puntos.
- Los picks se bloquean al kickoff **en la base de datos**, no solo en la interfaz.
- Clasificación semanal y acumulada; porcentaje individual y del conjunto del grupo.
- Consenso por partido ponderado por confianza, y clasificación proyectada mediante puntos esperados derivados de ese consenso social.
- Cada grupo tiene un link privado de invitación, apodos y resultados compartidos en tiempo real al guardar picks.
- Sincronización programada de resultados mediante GitHub Actions.
- Diseño adaptado a móvil y escritorio.

## Abrir la demo en 30 segundos

Abre `demo.html` en tu navegador para probar una versión **en un solo archivo**. No necesitas instalar nada. Alternativamente, abre `index.html` con sus archivos CSS/JS adjuntos. Si tu navegador restringe módulos locales, desde esta carpeta ejecuta:

```bash
python -m http.server 8000
```

Después abre `http://localhost:8000`.

La demo viene con cuatro participantes **ficticios claramente señalados por la insignia DEMO LOCAL**. Puedes hacer tus picks, asignar confidencias, guardar y ver la clasificación. **Los cambios solo se guardan en tu navegador**. Para invitar gente de verdad necesitas activar la base de datos.

Por defecto se muestra la Semana 5 de 2026 (si se abre durante esa semana). Trae un calendario de respaldo de sus 15 partidos por si no responde el proveedor de marcadores. Al navegar a otras semanas en demo se necesita acceso al feed ESPN. La demo no suplanta resultados reales cuando no consigue conectarse.

## Activar el multijugador

### 1) Proyecto Supabase

1. Crea un proyecto en [supabase.com](https://supabase.com).
2. En **Authentication > Providers > Anonymous** habilita **Anonymous Sign-Ins**. La ruta en la consola puede variar según la versión. Considera habilitar CAPTCHA o límites de petición si tu página va a ser pública.
3. En **SQL Editor** pega y ejecuta `supabase/schema.sql`.
4. En **Project Settings > API** copia el *Project URL* y la **publishable key** (o la *anon* pública) en `config.js`:

```js
window.NFL_PICKEM_CONFIG = {
  supabaseUrl: 'https://TU-PROYECTO.supabase.co',
  supabaseAnonKey: 'TU_PUBLISHABLE_KEY',
};
```

**Nunca coloques la `service_role` key en `config.js`, el HTML, el JS frontend o GitHub Pages.** Esa llave permite saltarse las políticas de seguridad.

### 2) Publicación

Puedes subir el contenido de esta carpeta a un repositorio de GitHub y habilitar **Settings > Pages > Deploy from a branch** (`main`, carpeta `/root`), o subirlo a un hosting estático como Netlify / Cloudflare Pages. No hace falta compilar el frontend.

### 3) Partidos y marcadores automáticos

El esquema crea una tabla `games` que se llena desde un proceso **administrador**, nunca desde las cuentas de tus amigos. Hay un script en `scripts/sync-nfl.mjs` y un workflow en `.github/workflows/sync-nfl.yml`.

En el repositorio GitHub configura dos **Settings > Secrets and variables > Actions > New repository secret**:

- `SUPABASE_URL`: la misma URL pública del proyecto.
- `SUPABASE_SERVICE_ROLE_KEY`: la **service_role key privada** de Supabase. Solo en GitHub Actions Secrets.

En **Actions > Sincronizar NFL > Run workflow**, ejecuta el workflow por primera vez con `weeks=1-18` para llenar todas las semanas de la temporada. Tras ello, el flujo automático revisa la semana actual, la anterior y la siguiente cada 30 minutos. Los horarios finales dependen del programador de GitHub Actions, que puede demorarse y no tiene SLA para exactitud horaria.

Si prefieres ejecutarlo manualmente en tu computadora:

```bash
npm install
SUPABASE_URL='https://TU-PROYECTO.supabase.co' SUPABASE_SERVICE_ROLE_KEY='CLAVE_PRIVADA' NFL_SEASON=2026 NFL_WEEKS=1-18 npm run sync
```

En Windows PowerShell, define cada variable con `$env:SUPABASE_URL='...'`, etc., y ejecuta `npm run sync`.

### 4) Invita a tus amigos

Al abrir la URL publicada por primera vez, define tu apodo y el nombre de la liga. Pulsa **Invitar amigos** para copiar el enlace con el identificador aleatorio de tu grupo. Cada amigo entra con su apodo. Los votos y puntajes serán comunes.

## Reglas exactas

- Una elección por juego, confianza única para toda la semana (no es obligatorio participar en todos los partidos, aunque conviene hacerlo).
- Cada juego puede editarse hasta su hora oficial de inicio.
- Un pick de partido ya comenzado no se puede alterar mediante el frontend ni mediante acceso directo a Supabase.
- Si un usuario no hizo su pick antes de kickoff, suma cero en ese juego.
- Si hay empate en la NFL, nadie recibe puntos de confianza por ese juego, pero un pronóstico enviado cuenta como no acertado para el indicador de precisión.
- El ranking semanal y de temporada ordena por puntos, después cantidad de aciertos y después apodo. Los empates exactos permanecen empatados a efectos deportivos aunque se enumeren los puestos.
- Precisión individual = aciertos / picks de partidos finalizados. Precisión conjunta = total aciertos / total picks de partidos finalizados de los participantes. El consenso del grupo es otra medida: partidos en los que ganó el equipo con mayor respaldo ponderado dividido por partidos finalizados con un consenso no empatado.
- Proyección social de puntos = puntos confirmados + suma de confianza × proporción ponderada de confianza del grupo por el equipo elegido en los partidos pendientes. Es un indicador lúdico de consenso, **no es una probabilidad matemática calibrada de ganar la quiniela ni una probabilidad real de ganar el partido**.

## Limitaciones e ideas para v2

- La identidad de la versión inicial es **anónima y ligada al navegador**. Si alguien borra datos del sitio o cambia de celular, tendrá que ingresar como nueva persona. Para preservar cuentas entre dispositivos, agrega login con correo/Google en Supabase Auth.
- El enlace largo es privado por su UUID no adivinable, pero cualquier persona que posea ese enlace puede unirse; para ligas más cerradas añade aprobación de invitados.
- La fuente ESPN usada para este MVP es un **feed público no contractual**. Su esquema o disponibilidad podrían cambiar. Para un lanzamiento formal, conviene una API deportiva con soporte y licencia claros.
- El cron de GitHub actualiza marcadores cada 30 minutos como máximo programado, no segundo a segundo; los picks entre amigos sí pueden actualizarse con Supabase Realtime y como respaldo se refrescan cada minuto.
- No se calculan márgenes, handicaps ni apuestas de dinero. No hay cuotas deportivas.
- La temporada regular está implementada; playoffs requieren una rama adicional de calendario/reglas.
- Para ligas grandes, conviene paginar picks y hacer el cálculo de ranking desde SQL o servidor.

## Archivos

| Archivo | Función |
|---|---|
| `index.html`, `styles.css`, `app.js` | Interfaz de la webapp |
| `config.js` | Configuración pública de Supabase |
| `supabase/schema.sql` | Tablas, validación en servidor, permisos/RLS y RPC |
| `scripts/sync-nfl.mjs` | Importación de calendario y resultados |
| `.github/workflows/sync-nfl.yml` | Actualizaciones automáticas con GitHub Actions |

Este proyecto no está afiliado, patrocinado ni respaldado por la NFL.
