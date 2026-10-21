/* Amara Lleida U22 · configuración
   scriptUrl → la dirección de la aplicación web del Apps Script de la hoja U22
               (Implementar › Gestionar implementaciones › URL, termina en /exec).
   readerUrl → la función de Vercel que lee fotos con Claude. Déjala así.
   La clave (TOKEN) NO va aquí: la app la pide la primera vez y la guarda en el móvil. */
window.U22_CONFIG = {
  scriptUrl: "",
  readerUrl: "/api/leer"
};
