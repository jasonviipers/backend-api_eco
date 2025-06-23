import type { Context, MiddlewareHandler, Next } from "hono";
import type { Readable } from "stream";

// Types
export interface UploadedFile {
	name: string;
	type: string;
	size: number;
	lastModified: number;
	stream(): ReadableStream<Uint8Array>;
	arrayBuffer(): Promise<ArrayBuffer>;
	text(): Promise<string>;
	slice(start?: number, end?: number, contentType?: string): Blob;
}

export interface UploadOptions {
	maxFileSize?: number;
	maxFiles?: number;
	accept?: string[];
	required?: boolean;
	fieldName?: string;
}

export interface MulterLikeFile {
	fieldname: string;
	originalname: string;
	encoding: string;
	mimetype: string;
	size: number;
	buffer?: Buffer;
	stream?: ReadableStream<Uint8Array>;
	arrayBuffer(): Promise<ArrayBuffer>;
	text(): Promise<string>;
}

// Error types
export const UploadErrors = {
	FILE_TOO_LARGE: "FILE_TOO_LARGE",
	TOO_MANY_FILES: "TOO_MANY_FILES",
	INVALID_FILE_TYPE: "INVALID_FILE_TYPE",
	MISSING_REQUIRED_FILE: "MISSING_REQUIRED_FILE",
	INVALID_CONTENT_TYPE: "INVALID_CONTENT_TYPE",
	PROCESSING_ERROR: "PROCESSING_ERROR",
} as const;

// Utility functions
function isValidFileType(file: File, acceptedTypes: string[]): boolean {
	if (!acceptedTypes.length) return true;

	return acceptedTypes.some((type) => {
		if (type.endsWith("/*")) {
			const baseType = type.slice(0, -2);
			return file.type.startsWith(baseType);
		}
		return (
			file.type === type || file.name.toLowerCase().endsWith(type.toLowerCase())
		);
	});
}

function createMulterLikeFile(file: File, fieldName: string): MulterLikeFile {
	return {
		fieldname: fieldName,
		originalname: file.name,
		encoding: "7bit",
		mimetype: file.type,
		size: file.size,
		stream: file.stream(),
		arrayBuffer: () => file.arrayBuffer(),
		text: () => file.text(),
	};
}

// Main upload middleware class
export class HonoMulter {
	private options: UploadOptions;

	constructor(options: UploadOptions = {}) {
		this.options = {
			maxFileSize: 10 * 1024 * 1024, // 10MB default
			maxFiles: 1,
			accept: [],
			required: false,
			...options,
		};
	}

	// Single file upload
	single(fieldName: string): MiddlewareHandler {
		return async (ctx: Context, next: Next) => {
			try {
				const formData = await ctx.req.formData();
				const file = formData.get(fieldName) as File | null;

				// Check if file is required
				if (this.options.required && !file) {
					throw new Error(
						`${UploadErrors.MISSING_REQUIRED_FILE}: ${fieldName} is required`,
					);
				}

				if (file) {
					// Validate file
					await this.validateFile(file);

					// Create multer-like file object
					const multerFile = createMulterLikeFile(file, fieldName);

					// Attach to context
					ctx.set("file", multerFile);
				}

				// Process other form fields
				const fields: Record<string, any> = {};
				for (const [key, value] of formData.entries()) {
					if (key !== fieldName) {
						if (fields[key]) {
							if (Array.isArray(fields[key])) {
								fields[key].push(value);
							} else {
								fields[key] = [fields[key], value];
							}
						} else {
							fields[key] = value;
						}
					}
				}

				ctx.set("body", fields);
				await next();
			} catch (error) {
				throw error;
			}
		};
	}

	// Multiple files with same field name
	array(fieldName: string, maxCount?: number): MiddlewareHandler {
		const maxFiles = maxCount || this.options.maxFiles || 10;

		return async (ctx: Context, next: Next) => {
			try {
				const formData = await ctx.req.formData();
				const files = formData.getAll(fieldName) as File[];

				// Check file count
				if (files.length > maxFiles) {
					throw new Error(
						`${UploadErrors.TOO_MANY_FILES}: Maximum ${maxFiles} files allowed`,
					);
				}

				// Check if files are required
				if (this.options.required && files.length === 0) {
					throw new Error(
						`${UploadErrors.MISSING_REQUIRED_FILE}: ${fieldName} is required`,
					);
				}

				// Validate and process files
				const multerFiles: MulterLikeFile[] = [];
				for (const file of files) {
					if (file instanceof File) {
						await this.validateFile(file);
						multerFiles.push(createMulterLikeFile(file, fieldName));
					}
				}

				// Attach to context
				ctx.set("files", multerFiles);

				// Process other form fields
				const fields: Record<string, any> = {};
				for (const [key, value] of formData.entries()) {
					if (key !== fieldName) {
						if (fields[key]) {
							if (Array.isArray(fields[key])) {
								fields[key].push(value);
							} else {
								fields[key] = [fields[key], value];
							}
						} else {
							fields[key] = value;
						}
					}
				}

				ctx.set("body", fields);
				await next();
			} catch (error) {
				throw error;
			}
		};
	}

	// Multiple files with different field names
	fields(
		fieldsConfig: { name: string; maxCount?: number }[],
	): MiddlewareHandler {
		return async (ctx: Context, next: Next) => {
			try {
				const formData = await ctx.req.formData();
				const groupedFiles: Record<string, MulterLikeFile[]> = {};

				// Process each configured field
				for (const config of fieldsConfig) {
					const files = formData.getAll(config.name) as File[];
					const maxCount = config.maxCount || 1;

					if (files.length > maxCount) {
						throw new Error(
							`${UploadErrors.TOO_MANY_FILES}: Maximum ${maxCount} files allowed for ${config.name}`,
						);
					}

					const multerFiles: MulterLikeFile[] = [];
					for (const file of files) {
						if (file instanceof File) {
							await this.validateFile(file);
							multerFiles.push(createMulterLikeFile(file, config.name));
						}
					}

					if (multerFiles.length > 0) {
						groupedFiles[config.name] = multerFiles;
					}
				}

				// Attach to context
				ctx.set("files", groupedFiles);

				// Process other form fields
				const fields: Record<string, any> = {};
				const fieldNames = fieldsConfig.map((f) => f.name);
				for (const [key, value] of formData.entries()) {
					if (!fieldNames.includes(key)) {
						if (fields[key]) {
							if (Array.isArray(fields[key])) {
								fields[key].push(value);
							} else {
								fields[key] = [fields[key], value];
							}
						} else {
							fields[key] = value;
						}
					}
				}

				ctx.set("body", fields);
				await next();
			} catch (error) {
				throw error;
			}
		};
	}

	// Any files
	any(): MiddlewareHandler {
		return async (ctx: Context, next: Next) => {
			try {
				const formData = await ctx.req.formData();
				const files: MulterLikeFile[] = [];
				const fields: Record<string, any> = {};

				for (const [key, value] of formData.entries()) {
					if (
						typeof value === "object" &&
						"name" in value &&
						"type" in value &&
						"size" in value
					) {
						await this.validateFile(value);
						files.push(createMulterLikeFile(value, key));
					} else {
						if (fields[key]) {
							if (Array.isArray(fields[key])) {
								fields[key].push(value);
							} else {
								fields[key] = [fields[key], value];
							}
						} else {
							fields[key] = value;
						}
					}
				}

				// Check total file count
				if (this.options.maxFiles && files.length > this.options.maxFiles) {
					throw new Error(
						`${UploadErrors.TOO_MANY_FILES}: Maximum ${this.options.maxFiles} files allowed`,
					);
				}

				// Attach to context
				ctx.set("files", files);
				ctx.set("body", fields);

				await next();
			} catch (error) {
				throw error;
			}
		};
	}

	// No files, only fields
	none(): MiddlewareHandler {
		return async (ctx: Context, next: Next) => {
			try {
				const formData = await ctx.req.formData();
				const fields: Record<string, any> = {};

				for (const [key, value] of formData.entries()) {
					if (
						typeof value === "object" &&
						"name" in value &&
						"type" in value &&
						"size" in value
					) {
						throw new Error(
							`${UploadErrors.PROCESSING_ERROR}: No files allowed`,
						);
					}

					if (fields[key]) {
						if (Array.isArray(fields[key])) {
							fields[key].push(value);
						} else {
							fields[key] = [fields[key], value];
						}
					} else {
						fields[key] = value;
					}
				}

				ctx.set("body", fields);
				await next();
			} catch (error) {
				throw error;
			}
		};
	}

	private async validateFile(file: File): Promise<void> {
		// Check file size
		if (this.options.maxFileSize && file.size > this.options.maxFileSize) {
			throw new Error(
				`${UploadErrors.FILE_TOO_LARGE}: File size ${file.size} exceeds limit of ${this.options.maxFileSize}`,
			);
		}

		// Check file type
		if (this.options.accept && this.options.accept.length > 0) {
			if (!isValidFileType(file, this.options.accept)) {
				throw new Error(
					`${UploadErrors.INVALID_FILE_TYPE}: File type ${file.type} not accepted. Accepted types: ${this.options.accept.join(", ")}`,
				);
			}
		}
	}
}

// Factory function (similar to Express Multer)
export default function multer(options?: UploadOptions): HonoMulter {
	return new HonoMulter(options);
}

// Convenience function for your existing upload middleware pattern
export function uploadMiddleware(options?: UploadOptions): MiddlewareHandler {
	const uploader = new HonoMulter(options);
	return uploader.single(options?.fieldName || "file");
}

// Extended Context type for TypeScript support
declare module "hono" {
	interface ContextVariableMap {
		file?: MulterLikeFile;
		files?: MulterLikeFile[] | Record<string, MulterLikeFile[]>;
		body?: Record<string, any>;
	}
}

// Helper function to get file from context (similar to your c.req.file usage)
export function getFile(
	ctx: Context,
	fieldName?: string,
): MulterLikeFile | null {
	const file = ctx.get("file");
	if (file && (!fieldName || file.fieldname === fieldName)) {
		return file;
	}

	const files = ctx.get("files");
	if (Array.isArray(files)) {
		return files.find((f) => !fieldName || f.fieldname === fieldName) || null;
	}

	if (files && typeof files === "object" && fieldName) {
		return files[fieldName]?.[0] || null;
	}

	return null;
}

// Helper function to get all files
export function getFiles(ctx: Context, fieldName?: string): MulterLikeFile[] {
	const files = ctx.get("files");

	if (Array.isArray(files)) {
		return fieldName ? files.filter((f) => f.fieldname === fieldName) : files;
	}

	if (files && typeof files === "object") {
		if (fieldName) {
			return files[fieldName] || [];
		}
		return Object.values(files).flat();
	}

	const singleFile = ctx.get("file");
	if (singleFile && (!fieldName || singleFile.fieldname === fieldName)) {
		return [singleFile];
	}

	return [];
}

// Export everything
export { multer };
