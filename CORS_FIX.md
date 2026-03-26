# Cómo solucionar problemas de CORS en Firebase Storage

Si el error `412 Precondition Failed` o errores de red persisten al subir archivos (PDF o imágenes), sigue estos pasos para configurar CORS en tu bucket.

### Opción 1: Usando la Consola de Google Cloud

1.  Ve a la [Consola de Google Cloud](https://console.cloud.google.com/).
2.  Selecciona tu proyecto: `etfa-ruido-app`.
3.  Busca **Cloud Storage** &rarr; **Buckets**.
4.  Haz clic en el bucket `etfa-ruido-app.appspot.com`.
5.  Haz clic en la pestaña **Configuración** (o **Permisos**) y verifica si hay alguna restricción.
6.  Sin embargo, la forma más fiable de configurar CORS es mediante la terminal.

### Opción 2: Usando `gsutil` en tu computadora

1.  Crea un archivo llamado `cors.json` con el siguiente contenido:

    ```json
    [
      {
        "origin": ["*"],
        "method": ["GET", "POST", "PUT", "DELETE", "HEAD"],
        "responseHeader": ["Content-Type", "x-goog-resumable"],
        "maxAgeSeconds": 3600
      }
    ]
    ```

2.  Abre tu terminal y ejecuta el siguiente comando (necesitarás tener instalado `gcloud` sdk):

    ```bash
    gsutil cors set cors.json gs://etfa-ruido-app.appspot.com
    ```

3.  Si tienes varios buckets (ej: el de `.firebasestorage.app`), repite el comando para cada uno.

---

> [!NOTE]
> Hemos actualizado el archivo `.env` para usar el dominio `.appspot.com`, que suele ser el predeterminado y más compatible para este tipo de operaciones.
