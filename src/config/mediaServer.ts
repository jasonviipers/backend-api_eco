import NodeMediaServer from "node-media-server";
import { logger } from "../utils/logger";
import { query } from "./postgresql";

interface MediaServerConfig {
	rtmp: {
		port: number;
		chunk_size: number;
		gop_cache: boolean;
		ping: number;
		ping_timeout: number;
	};
	http: {
		port: number;
		allow_origin: string;
		mediaroot: string;
		webroot?: string;
	};
	auth: {
		api?: boolean;
		api_user?: string;
		api_pass?: string;
		play: boolean;
		publish: boolean;
		secret: string;
	};
	trans?: {
		ffmpeg: string;
		tasks: Array<{
			app: string;
			hls: boolean;
			hlsFlags?: string;
			dash: boolean;
			dashFlags?: string;
		}>;
	};
}

export const setupMediaServer = (): void => {
	const config: MediaServerConfig = {
		rtmp: {
			port: Number.parseInt(process.env.RTMP_PORT || "1935"),
			chunk_size: 60000,
			gop_cache: true,
			ping: 30,
			ping_timeout: 60,
		},
		http: {
			port: Number.parseInt(process.env.MEDIA_HTTP_PORT || "8000"),
			allow_origin: "*",
			mediaroot: "./media",
		},
		auth: {
			play: false,
			publish: true,
			secret: process.env.RTMP_SECRET || "supersecret",
		},
	};

	const nms = new NodeMediaServer(config);

	nms.on("prePublish", async (id, StreamPath, args) => {
		try {
			const streamKey = StreamPath.split("/").pop();
			const result = await query(
				"SELECT id, vendor_id FROM live_streams WHERE stream_key = $1 AND status = $2",
				[streamKey, "scheduled"],
			);

			if (!result.rows.length) {
				logger.warn(`Invalid stream key attempted: ${streamKey}`);
				const session = nms.getSession(id) as any;
				session?.reject?.();
				return;
			}

			await query(
				"UPDATE live_streams SET status = $1, started_at = $2 WHERE stream_key = $3",
				["live", new Date(), streamKey],
			);
			logger.info(`Stream started: ${streamKey}`);
		} catch (error) {
			logger.error("Stream authentication error:", error);
			const session = nms.getSession(id) as any;
			session?.reject?.();
		}
	});

	nms.on("donePublish", async (id, StreamPath, args) => {
		try {
			const streamKey = StreamPath.split("/").pop();
			await query(
				"UPDATE live_streams SET status = $1, ended_at = $2 WHERE stream_key = $3",
				["ended", new Date(), streamKey],
			);
			logger.info(`Stream ended: ${streamKey}`);
		} catch (error) {
			logger.error("Stream end handling error:", error);
		}
	});

	nms.run();
	logger.info(
		`Media server running on RTMP port ${config.rtmp.port} and HTTP port ${config.http.port}`,
	);
};
