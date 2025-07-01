import NodeMediaServer from "node-media-server";
import { logger } from "../utils/logger";
import { query } from "./postgresql";
import { env } from "../utils/env";

interface MediaServerConfig {
	rtmp: {
		port: number;
		chunk_size: number;
		gop_cache: boolean;
		ping: number;
		ping_timeout: number;
		host?: string;
	};
	http: {
		port: number;
		allow_origin: string;
		mediaroot: string;
		webroot?: string;
		host?: string;
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
	// Debug environment variables
	logger.info(`RTMP_PORT from env: ${env.RTMP_PORT} (type: ${typeof env.RTMP_PORT})`);
	logger.info(`MEDIA_HTTP_PORT from env: ${env.MEDIA_HTTP_PORT} (type: ${typeof env.MEDIA_HTTP_PORT})`);
	logger.info(`RTMP_SECRET from env: ${env.RTMP_SECRET}`);

	// Ensure ports are numbers
	const rtmpPort = Number(env.RTMP_PORT);
	const httpPort = Number(env.MEDIA_HTTP_PORT);

	if (isNaN(rtmpPort) || isNaN(httpPort)) {
		logger.error(`Invalid port configuration: RTMP=${rtmpPort}, HTTP=${httpPort}`);
		throw new Error("Invalid port configuration for media server");
	}

	const config: MediaServerConfig = {
		rtmp: {
			port: rtmpPort,
			chunk_size: 60000,
			gop_cache: true,
			ping: 30,
			ping_timeout: 60,
			host: '0.0.0.0'
		},
		http: {
			port: httpPort,
			allow_origin: "*",
			mediaroot: "./media",
			host: '0.0.0.0'
		},
		auth: {
			play: false,
			publish: true,
			secret: env.RTMP_SECRET,
		},
	};

	logger.info(`Media server config: RTMP port ${config.rtmp.port}, HTTP port ${config.http.port}`);

	const nms = new NodeMediaServer(config);

	nms.on("preConnect", (id, args) => {
		logger.info(`[NodeMediaServer] Pre-connect id=${id} args=${JSON.stringify(args)}`);
	});

	nms.on("prePublish", async (id, StreamPath, args) => {
		try {
			logger.info(`[NodeMediaServer] Pre-publish id=${id} StreamPath=${StreamPath} args=${JSON.stringify(args)}`);
			
			const streamKey = StreamPath.split("/").pop();
			if (!streamKey) {
				logger.warn("No stream key found in StreamPath");
				const session = nms.getSession(id) as any;
				session?.reject?.();
				return;
			}

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
			logger.info(`Stream started successfully: ${streamKey}`);
		} catch (error) {
			logger.error("Stream authentication error:", error);
			const session = nms.getSession(id) as any;
			session?.reject?.();
		}
	});

	nms.on("donePublish", async (id, StreamPath, args) => {
		try {
			logger.info(`[NodeMediaServer] Done-publish id=${id} StreamPath=${StreamPath}`);
			
			const streamKey = StreamPath.split("/").pop();
			if (!streamKey) {
				logger.warn("No stream key found in StreamPath during done-publish");
				return;
			}

			await query(
				"UPDATE live_streams SET status = $1, ended_at = $2 WHERE stream_key = $3",
				["ended", new Date(), streamKey],
			);
			logger.info(`Stream ended successfully: ${streamKey}`);
		} catch (error) {
			logger.error("Stream end handling error:", error);
		}
	});

	nms.on("postConnect", (id, args) => {
		logger.info(`[NodeMediaServer] Post-connect id=${id} args=${JSON.stringify(args)}`);
	});

	nms.on("doneConnect", (id, args) => {
		logger.info(`[NodeMediaServer] Done-connect id=${id} args=${JSON.stringify(args)}`);
	});

	try {
		nms.run();
		logger.info(
			`Media server started successfully - RTMP port: ${config.rtmp.port}, HTTP port: ${config.http.port}`,
		);
	} catch (error) {
		logger.error("Failed to start media server:", error);
		throw error;
	}
};