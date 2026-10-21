# Amara Lleida U22

App del preparador físico del U22 del Amara Lleida: RPE de los jugadores, carga, pesos, horario y entrenos (con modo en vivo). Se instala en el móvil como una app, con el escudo y pantalla completa.

Los datos siguen en el Google Sheets **U22**: la app lee y escribe ahí a través de un pequeño script de Google (Apps Script). No hay otra base de datos.

## Cómo está montada

| Pieza | Dónde | Qué hace |
|---|---|---|
| `index.html` | Vercel | La app. |
| `shim.js` | Vercel | Conecta la app con el Apps Script y con `/api/leer`. |
| `config.js` | Vercel | La dirección del Apps Script. |
| `apps-script/Codigo.gs` | Hoja U22 › Extensiones › Apps Script | Lee y escribe la hoja. Protege RPE, 'RPE App' y E:G de ENTRENOS DATOS. Guarda las fotos de jugadores en la pestaña oculta FOTOS APP. |
| `api/leer.js` | Vercel (función) | Lee fotos o texto de horarios y entrenos con Claude. Opcional: sin clave de API, la app funciona igual y solo se pueden añadir a mano. |

## Puesta en marcha

### 1. Script de la hoja (5 minutos)

1. Abre la hoja U22 › **Extensiones › Apps Script**.
2. Borra lo que haya en `Código.gs` y pega el contenido de `apps-script/Codigo.gs`. Guarda.
3. **Configuración del proyecto** (rueda) › **Propiedades del script** › Añadir: nombre `TOKEN`, valor una clave larga inventada. Guárdala; la app te la pedirá.
4. **Implementar › Nueva implementación** › tipo **Aplicación web**. Ejecutar como: **yo**. Quién tiene acceso: **cualquier usuario**. Implementar y aceptar los permisos.
5. Copia la **URL** que acaba en `/exec` y pégala en `config.js`, en `scriptUrl`.

Si cambias el script más adelante: **Implementar › Gestionar implementaciones › editar › Nueva versión**, para que la URL no cambie.

### 2. Vercel

1. En Vercel, **Add New › Project** e importa este repositorio. Sin cambiar nada más, **Deploy**.
2. Opcional, para leer fotos de entrenos y horarios: **Settings › Environment Variables**
   - `ANTHROPIC_API_KEY`: tu clave de la API de Claude (console.anthropic.com). Se paga por uso.
   - `APP_TOKEN`: la misma clave que `TOKEN` del paso 1.

   Después, **Deployments › Redeploy**.

### 3. En el móvil

Abre la dirección de Vercel en Chrome, escribe la clave y en el menú ⋮ pulsa **Añadir a pantalla de inicio › Instalar**. En iPhone, desde Safari: Compartir › Añadir a pantalla de inicio.

## Reglas de la hoja que no se tocan

- **RPE** es un IMPORTRANGE de la hoja antigua de AppSheet: escribir ahí lo rompe (#REF!). Los RPE nuevos van a **RPE NUEVOS**.
- **'RPE App'** une RPE NUEVOS y RPE con una fórmula.
- **ENTRENOS DATOS** E:G son ARRAYFORMULA.

El script rechaza cualquier escritura en esos sitios.
