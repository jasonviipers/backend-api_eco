import { v2 as cloudinary } from "cloudinary";
import { logger } from "../utils/logger";

export const initializeCloudinary = (): void => {
	try {
		cloudinary.config({
			cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
			api_key: process.env.CLOUDINARY_API_KEY,
			api_secret: process.env.CLOUDINARY_API_SECRET,
		});

		logger.info("Cloudinary initialized successfully");
	} catch (error) {
		logger.error("Cloudinary initialization failed:", error);
		throw error;
	}
};

export { cloudinary };
