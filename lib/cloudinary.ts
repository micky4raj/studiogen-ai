import { v2 as cloudinary } from "cloudinary";

cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
});

/**
 * Uploads a source image to Cloudinary and applies its AI background-removal
 * add-on (`background_removal: "cloudinary_ai"`), returning a transparent PNG URL.
 *
 * Note: the background-removal add-on must be enabled on the Cloudinary account
 * (Add-ons -> Cloudinary AI Background Removal in the dashboard).
 */
export async function removeBackgroundWithCloudinary(imageUrl: string): Promise<string> {
  const uploadResult = await cloudinary.uploader.upload(imageUrl, {
    folder: "studiogen-ai/bg-removed",
    background_removal: "cloudinary_ai",
  });

  return uploadResult.secure_url;
}

export { cloudinary };
