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
  try {
    const resizedImage = await readAndCompressImage(imageFile, imageConfig);
    
    // Verify if the name is preserved; if not, set it manually
    if (!resizedImage.name && imageFile.name) {
      Object.defineProperty(resizedImage, 'name', { value: imageFile.name, writable: true });
    }
    
    return resizedImage;
  } catch (error) {
    console.error("Error resizing image:", error);
    throw error;
  }
};
