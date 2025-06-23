import { processVideo, type ProcessingOptions } from "./videoProcessor";
import { query } from "../config/postgresql";
import { logger } from "./logger";

interface VideoJob {
	id: string;
	videoId: string;
	videoUrl: string;
	options: ProcessingOptions;
	retryCount: number;
	maxRetries: number;
}

class VideoProcessingQueue {
	private queue: VideoJob[] = [];
	private processing = false;
	private concurrency = 2; // Process 2 videos simultaneously

	async addJob(
		videoId: string,
		videoUrl: string,
		options: ProcessingOptions = {},
	): Promise<void> {
		const job: VideoJob = {
			id: `job_${Date.now()}_${Math.random()}`,
			videoId,
			videoUrl,
			options,
			retryCount: 0,
			maxRetries: 3,
		};

		this.queue.push(job);
		logger.info(`Added video processing job: ${job.id} for video: ${videoId}`);

		if (!this.processing) {
			this.processQueue();
		}
	}

	private async processQueue(): Promise<void> {
		if (this.processing || this.queue.length === 0) {
			return;
		}

		this.processing = true;
		logger.info(
			`Starting video processing queue with ${this.queue.length} jobs`,
		);

		const activeJobs: Promise<void>[] = [];

		while (this.queue.length > 0 && activeJobs.length < this.concurrency) {
			const job = this.queue.shift()!;
			activeJobs.push(this.processJob(job));
		}

		await Promise.allSettled(activeJobs);

		// Continue processing if there are more jobs
		if (this.queue.length > 0) {
			setImmediate(() => this.processQueue());
		} else {
			this.processing = false;
			logger.info("Video processing queue completed");
		}
	}

	private async processJob(job: VideoJob): Promise<void> {
		try {
			logger.info(`Processing video job: ${job.id}`);

			// Update status to processing
			await query(
				"UPDATE short_videos SET processing_status = $1 WHERE id = $2",
				["processing", job.videoId],
			);

			// Process the video
			const result = await processVideo(job.videoUrl, job.options);

			// Update database with results
			await query(
				`UPDATE short_videos 
         SET processing_status = $1, processed_formats = $2, thumbnails = $3, 
             metadata = $4, duration = $5
         WHERE id = $6`,
				[
					"completed",
					JSON.stringify(result.formats),
					JSON.stringify(result.thumbnails),
					JSON.stringify(result.metadata),
					result.duration,
					job.videoId,
				],
			);

			logger.info(`Video processing completed for job: ${job.id}`);
		} catch (error) {
			logger.error(`Video processing failed for job: ${job.id}`, error);

			job.retryCount++;

			if (job.retryCount < job.maxRetries) {
				// Retry the job
				logger.info(
					`Retrying job: ${job.id} (attempt ${job.retryCount + 1}/${job.maxRetries})`,
				);
				setTimeout(() => {
					this.queue.unshift(job);
					if (!this.processing) {
						this.processQueue();
					}
				}, 5000 * job.retryCount); // Exponential backoff
			} else {
				// Mark as failed
				await query(
					"UPDATE short_videos SET processing_status = $1 WHERE id = $2",
					["failed", job.videoId],
				);
				logger.error(`Video processing permanently failed for job: ${job.id}`);
			}
		}
	}

	getQueueStatus(): { queueLength: number; processing: boolean } {
		return {
			queueLength: this.queue.length,
			processing: this.processing,
		};
	}
}

export const videoQueue = new VideoProcessingQueue();

// Helper function to add video to processing queue
export const queueVideoProcessing = async (
	videoId: string,
	videoUrl: string,
	options: ProcessingOptions = {},
): Promise<void> => {
	await videoQueue.addJob(videoId, videoUrl, options);
};
