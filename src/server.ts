import type { Server as HttpServer } from "node:http";
import dotenv from "dotenv";
import { Hono } from "hono";
import { compress } from "hono/compress";
import { cors } from "hono/cors";
import { poweredBy } from "hono/powered-by";
import { secureHeaders } from "hono/secure-headers";
import { Server as SocketIOServer } from "socket.io";
import { connectCassandra } from "./config/cassandra";
import { initializeCloudinary } from "./config/cloudinary";
import { setupMediaServer } from "./config/mediaServer";
import { connectPostgreSQL } from "./config/postgresql";
import { connectRedis } from "./config/redis";
import { setupSocketIO } from "./config/socket";
import { initializeStripe } from "./config/stripe";
import { errorHandler } from "./middleware/erroHandler";
import auth from "./routes/auth.routes";
import { productRouter } from "./routes/products.routes";
import streamRouter from "./routes/stream.routes";
import { userRouter } from "./routes/user.routes";
import { logger } from "./utils/logger";
import { paymentRouter } from "./routes/payment.routes";
import { videoRoutes } from "./routes/video.routes";
import { vendorRouter } from "./routes/vendor.routes";
import { rateLimiter } from "./middleware/rateLimiter";

// Load environment variables
dotenv.config();

const app = new Hono();
const io = new SocketIOServer(app as unknown as HttpServer);

// Global middleware
app.use("*", poweredBy());
app.use("*", secureHeaders());
// app.use("*", compress());
app.use(
	"*",
	cors({
		origin: process.env.CLIENT_URL?.split(",") || ["http://localhost:3000"],
		credentials: true,
		allowHeaders: ["Content-Type", "Authorization"],
		allowMethods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
	}),
);

// Apply rate limiting middleware
app.use("*", rateLimiter);

// Request body parsing middleware
app.use("*", async (c, next) => {
	if (c.req.method === "POST" || c.req.method === "PUT") {
		try {
			const body = await c.req.json();
			c.req.addValidatedData("json", body);
		} catch (error) {
			return c.json({ error: "Invalid JSON body" }, 400);
		}
	}
	await next();
});

// Health check endpoint
app.get("/health", (c) => {
	return c.json({
		status: "OK",
		timestamp: new Date().toISOString(),
		uptime: process.uptime(),
		environment: process.env.NODE_ENV || "development",
	});
});

// API Routes
app.route("/auth", auth);
app.route("/user", userRouter);
app.route("/product", productRouter);
app.route("/stream", streamRouter);
app.route("/payment", paymentRouter);
app.route("/video", videoRoutes);
app.route("/vendor", vendorRouter);

// Error handling middleware
app.onError(errorHandler);

// Not found handler
app.notFound((c) => {
	return c.json({ error: "Endpoint not found" }, 404);
});

// Initialize services
async function initializeServices() {
	try {
		logger.info("Initializing services...");

		// Database connections
		await Promise.all([
			connectPostgreSQL(),
			connectRedis(),
			// connectCassandra(),
		]);

		// External services
		await Promise.all([initializeCloudinary(), initializeStripe()]);

		// Media server
		setupMediaServer();

		// Socket.IO setup
		setupSocketIO(io);

		logger.info("All services initialized successfully");
	} catch (error) {
		logger.error("Failed to initialize services:", error);
		process.exit(1);
	}
}

// Start the server
const port = Number(process.env.PORT) || 3000;

Bun.serve({
	port,
	fetch: app.fetch,
	error(error) {
		logger.error("Server error:", error);
		return new Response("Internal Server Error", { status: 500 });
	},
});

logger.info(`Server running on port ${port}`);

// Initialize services after server starts
initializeServices().catch((error) => {
	logger.error("Service initialization error:", error);
	process.exit(1);
});

export default app;
