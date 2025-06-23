import { verify } from "hono/jwt";
import type { Socket, Server as SocketIOServer } from "socket.io";
import type { CustomJWTPayload } from "../routes/auth.routes";
import { logger } from "../utils/logger";
import { executeQuery } from "./cassandra";

interface AuthenticatedSocket extends Socket {
	userId?: string;
	userRole?: string;
}

export const setupSocketIO = async (io: SocketIOServer) => {
	// Authentication middleware for Socket.IO
	io.use(async (socket: any, next) => {
		try {
			const token = socket.handshake.auth.token;
			if (!token) {
				return next(new Error("Authentication error"));
			}

			const decoded = (await verify(
				token,
				process.env.JWT_SECRET ?? "",
			)) as CustomJWTPayload;
			socket.userId = decoded.id;
			socket.userRole = decoded.role;
			next();
		} catch (error) {
			next(new Error("Authentication error"));
		}
	});

	io.on("connection", (socket: AuthenticatedSocket) => {
		logger.info(`User ${socket.userId} connected`);

		// Join user to their personal room
		socket.join(`user_${socket.userId}`);

		// Live stream events
		socket.on("join_stream", async (streamId: string) => {
			socket.join(`stream_${streamId}`);

			// Track viewer join in Cassandra
			await executeQuery(
				"INSERT INTO stream_analytics (stream_id, user_id, event_type, timestamp) VALUES (?, ?, ?, ?)",
				[streamId, socket.userId, "viewer_joined", new Date()],
			);

			// Broadcast viewer count update
			const roomSize =
				io.sockets.adapter.rooms.get(`stream_${streamId}`)?.size || 0;
			io.to(`stream_${streamId}`).emit("viewer_count_update", roomSize);
		});

		socket.on("leave_stream", async (streamId: string) => {
			socket.leave(`stream_${streamId}`);

			// Track viewer leave in Cassandra
			await executeQuery(
				"INSERT INTO stream_analytics (stream_id, user_id, event_type, timestamp) VALUES (?, ?, ?, ?)",
				[streamId, socket.userId, "viewer_left", new Date()],
			);

			// Broadcast viewer count update
			const roomSize =
				io.sockets.adapter.rooms.get(`stream_${streamId}`)?.size || 0;
			io.to(`stream_${streamId}`).emit("viewer_count_update", roomSize);
		});

		// Chat events
		socket.on(
			"send_message",
			async (data: { streamId: string; message: string }) => {
				const messageData = {
					id: Date.now().toString(),
					streamId: data.streamId,
					userId: socket.userId,
					message: data.message,
					timestamp: new Date(),
				};

				// Store message in Cassandra
				await executeQuery(
					"INSERT INTO chat_messages (stream_id, message_id, user_id, message, timestamp) VALUES (?, ?, ?, ?, ?)",
					[
						data.streamId,
						messageData.id,
						socket.userId,
						data.message,
						new Date(),
					],
				);

				// Broadcast message to stream room
				io.to(`stream_${data.streamId}`).emit("new_message", messageData);
			},
		);

		// Video interaction events
		socket.on("video_like", async (videoId: string) => {
			await executeQuery(
				"INSERT INTO video_views (video_id, user_id, event_type, timestamp) VALUES (?, ?, ?, ?)",
				[videoId, socket.userId, "like", new Date()],
			);
		});

		socket.on("video_view", async (videoId: string) => {
			await executeQuery(
				"INSERT INTO video_views (video_id, user_id, event_type, timestamp) VALUES (?, ?, ?, ?)",
				[videoId, socket.userId, "view", new Date()],
			);
		});

		// Order status updates
		socket.on("subscribe_order_updates", (orderId: string) => {
			socket.join(`order_${orderId}`);
		});

		// Disconnect event
		socket.on("disconnect", () => {
			logger.info(`User ${socket.userId} disconnected`);
		});
	});

	logger.info("Socket.IO configured successfully");
};

export const emitToUser = (
	io: SocketIOServer,
	userId: string,
	event: string,
	data: any,
): void => {
	io.to(`user_${userId}`).emit(event, data);
};

export const emitToStream = (
	io: SocketIOServer,
	streamId: string,
	event: string,
	data: any,
): void => {
	io.to(`stream_${streamId}`).emit(event, data);
};

export const emitToOrder = (
	io: SocketIOServer,
	orderId: string,
	event: string,
	data: any,
): void => {
	io.to(`order_${orderId}`).emit(event, data);
};
