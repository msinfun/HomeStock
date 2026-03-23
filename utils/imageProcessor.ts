/**
 * 圖片壓縮輔助函式
 * 將圖片縮放至最大邊長 1024px，並以 0.7 品質轉成 JPEG Base64
 */
export async function compressImage(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      const img = new Image();
      img.onload = () => {
        const canvas = document.createElement('canvas');
        let width = img.width;
        let height = img.height;
        const maxResolution = 1024;

        if (width > height) {
          if (width > maxResolution) {
            height *= maxResolution / width;
            width = maxResolution;
          }
        } else {
          if (height > maxResolution) {
            width *= maxResolution / height;
            height = maxResolution;
          }
        }

        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext('2d');
        if (!ctx) {
          // Fallback to original if canvas context fails
          resolve((e.target?.result as string).split(',')[1]);
          return;
        }

        ctx.drawImage(img, 0, 0, width, height);
        const compressedBase64 = canvas.toDataURL('image/jpeg', 0.7);
        resolve(compressedBase64.split(',')[1]);
      };
      img.onerror = () => {
        // Fallback to original if image loading fails
        resolve((e.target?.result as string).split(',')[1]);
      };
      img.src = e.target?.result as string;
    };
    reader.onerror = () => {
      // Fallback: If even reading fails, we might not have a choice but to reject or return empty
      // but usually reader failures are rare for Files.
      reject(new Error("FileReader failed"));
    };
    reader.readAsDataURL(file);
  });
}
