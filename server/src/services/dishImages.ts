import { v2 as cloudinary } from "cloudinary";
import type { ServerConfig } from "../config.js";

export interface UploadedDishImage {
  publicId: string;
  imageUrl: string;
}

export interface DishImageStorage {
  upload(buffer: Buffer, format: "jpg" | "png" | "webp"): Promise<UploadedDishImage>;
  remove(publicId: string): Promise<void>;
}

export class ImageStorageUnavailableError extends Error {}
export class ImageStorageProviderError extends Error {}

export function createDishImageStorage(config: ServerConfig): DishImageStorage {
  const ready = !!(config.cloudinaryCloudName && config.cloudinaryApiKey && config.cloudinaryApiSecret);
  if (ready) {
    cloudinary.config({
      cloud_name: config.cloudinaryCloudName,
      api_key: config.cloudinaryApiKey,
      api_secret: config.cloudinaryApiSecret,
      secure: true,
    });
  }

  return {
    upload(buffer, format) {
      if (!ready) return Promise.reject(new ImageStorageUnavailableError());
      return new Promise((resolve, reject) => {
        try {
          const stream = cloudinary.uploader.upload_stream({
            resource_type: "image",
            folder: "menugo/dishes",
            format,
            allowed_formats: ["jpg", "png", "webp"],
            unique_filename: true,
            overwrite: false,
          }, (error, result) => {
            if (error || !result?.public_id || !result.secure_url) {
              reject(new ImageStorageProviderError());
              return;
            }
            resolve({ publicId: result.public_id, imageUrl: result.secure_url });
          });
          stream.on("error", () => reject(new ImageStorageProviderError()));
          stream.end(buffer);
        } catch {
          reject(new ImageStorageProviderError());
        }
      });
    },
    async remove(publicId) {
      if (!ready) throw new ImageStorageUnavailableError();
      try {
        const result = await cloudinary.uploader.destroy(publicId, { resource_type: "image", invalidate: true });
        if (result.result !== "ok" && result.result !== "not found") throw new ImageStorageProviderError();
      } catch {
        throw new ImageStorageProviderError();
      }
    },
  };
}
