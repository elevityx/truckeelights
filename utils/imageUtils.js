import { readAndCompressImage } from 'browser-image-resizer';

const imageConfig = {
  quality: 0.7,          // Adjust the quality level (0 to 1)
  maxWidth: 800,         // Maximum width of the resized image
  maxHeight: 800,        // Maximum height of the resized image
  autoRotate: true,      // Automatically rotate based on EXIF data
  debug: false,          // Set to true for debugging
};

/**
 * Compresses and resizes an image file.
 * @param {File} imageFile - The original image file.
 * @returns {Promise<File>} The resized and compressed image file.
 */
export const resizeImage = async (imageFile) => {
  let quality = 0.7;
  let resizedImage;
  const MAX_SIZE_BYTES = 5 * 1024 * 1024; // 5 MB

  while (quality > 0.1) { // Prevent quality from going too low
    try {
      const resizedImageBlob = await readAndCompressImage(imageFile, { ...imageConfig, quality });
      const tempImage = new File([resizedImageBlob], imageFile.name, {
        type: imageFile.type,
        lastModified: Date.now(),
      });

      if (tempImage.size <= MAX_SIZE_BYTES) {
        resizedImage = tempImage;
        break;
      }

      quality -= 0.1; // Decrease quality and retry
    } catch (error) {
      console.error("Error resizing image:", error);
      throw error;
    }
  }

  if (!resizedImage) {
    throw new Error("Unable to resize image to meet the size requirements.");
  }

  return resizedImage;
};
