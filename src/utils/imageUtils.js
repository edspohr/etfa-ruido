/**
 * Compresses an image file client-side.
 * - Resizes to max width 1280px (maintaining aspect ratio).
 * - Converts to grayscale.
 * - Compresses to JPEG with 0.7 quality.
 *
 * @param {File} file - The original image file.
 * @returns {Promise<File>} - The compressed image file.
 */
export async function compressImage(file) {
  if (!file.type.startsWith("image/")) {
    return file; // Return original if not an image
  }

  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.readAsDataURL(file);

    reader.onload = (event) => {
      const img = new Image();
      img.src = event.target.result;

      img.onload = () => {
        const canvas = document.createElement("canvas");
        const ctx = canvas.getContext("2d");

        // 1. Calculate new dimensions (Max Width 1280)
        const MAX_WIDTH = 1280;
        let width = img.width;
        let height = img.height;

        if (width > MAX_WIDTH) {
          height = Math.round((height * MAX_WIDTH) / width);
          width = MAX_WIDTH;
        }

        canvas.width = width;
        canvas.height = height;

        // 2. Clear background (for transparency issues, though we use JPEG)
        ctx.fillStyle = "#FFFFFF";
        ctx.fillRect(0, 0, width, height);

        // 3. Draw Image
        // We can use filter for grayscale, but strict pixel manipulation is sometimes more compatible.
        // CSS filter on context is supported in modern browsers.
        ctx.filter = "grayscale(100%)";

        ctx.drawImage(img, 0, 0, width, height);

        // 4. Export as compressed JPEG
        canvas.toBlob(
          (blob) => {
            if (!blob) {
              reject(new Error("Canvas to Blob failed"));
              return;
            }
            // Create a new File object
            const newFile = new File(
              [blob],
              file.name.replace(/\.[^/.]+$/, "") + ".jpg",
              {
                type: "image/jpeg",
                lastModified: Date.now(),
              }
            );
            resolve(newFile);
          },
          "image/jpeg",
          0.7 // Quality
        );
      };

      img.onerror = (err) => reject(err);
    };

    reader.onerror = (err) => reject(err);
  });
}
