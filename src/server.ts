import { Hono } from "hono";
import { Server as HttpServer } from "node:http";
import { Server as SocketIOServer } from "socket.io";
import { setupSocketIO } from "./config/socket";
import { registerGlobalMiddleware } from "./server/middleware";
import { registerRoutes } from "./server/routes";
import { registerErrorHandlers } from "./server/errors";
import { logger } from "./utils/logger";
import { connectPostgreSQL } from "./config/postgresql";
import { connectRedis } from "./config/redis";
import { initializeCloudinary } from "./config/cloudinary";
import { initializeStripe } from "./config/stripe";
import { setupMediaServer } from "./config/mediaServer";
import { env } from "./utils/env";

const app = new Hono();
const io = new SocketIOServer(app as unknown as HttpServer);

registerGlobalMiddleware(app);
registerRoutes(app);
registerErrorHandlers(app);

async function initServices() {
	try {
		logger.info("Initializing services...");
		await Promise.all([
			connectPostgreSQL(),
			connectRedis(),
		]);
		await Promise.all([initializeCloudinary(), initializeStripe()]);
		setupMediaServer();
		setupSocketIO(io);
		logger.info("All services initialized successfully");
	} catch (err) {
		logger.error("Failed to initialize services:", err);
		process.exit(1);
	}
}

await initServices();

const port = env.PORT;
Bun.serve({
	port,
	hostname: "0.0.0.0",
	fetch: app.fetch,
	error(error) {
		logger.error("Server error:", error);
		return new Response("Internal Server Error", { status: 500 });
	},
});
logger.info(`Server running on port ${port}`);
