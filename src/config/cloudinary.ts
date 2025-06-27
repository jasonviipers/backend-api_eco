import { v2 as cloudinary } from "cloudinary";
import { logger } from "../utils/logger";
import { env } from "../utils/env";

export const initializeCloudinary = (): void => {
	try {
		cloudinary.config({
			cloud_name: env.CLOUDINARY_CLOUD_NAME,
			api_key: env.CLOUDINARY_API_KEY,
			api_secret: env.CLOUDINARY_API_SECRET,
		});

		logger.info("Cloudinary initialized successfully");
	} catch (error) {
		logger.error("Cloudinary initialization failed:", error);
		throw error;
	}
};

export { cloudinary };

export interface CloudinaryUploadResult {
	public_id: string;
	secure_url: string;
	duration?: number;
	bytes?: number;
}
