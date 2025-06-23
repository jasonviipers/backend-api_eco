import type { Server as HttpServer } from "node:http";
import dotenv from "dotenv";
import { Hono } from "hono";
import { compress } from "hono/compress";
import { cors } from "hono/cors";
import { poweredBy } from "hono/powered-by";
import { secureHeaders } from "hono/secure-headers";
import { rateLimiter } from "hono-rate-limiter";
import { Server as SocketIOServer } from "socket.io";
import { connectCassandra } from "./config/cassandra";
import { initializeCloudinary } from "./config/cloudinary";
import { setupMediaServer } from "./config/mediaServer";
// Import configurations and middleware
import { connectPostgreSQL } from "./config/postgresql";
import { connectRedis } from "./config/redis";
import { setupSocketIO } from "./config/socket";
import { initializeStripe } from "./config/stripe";
import { errorHandler } from "./middleware/erroHandler";
// Routes
import auth from "./routes/auth.routes";
import { productRouter } from "./routes/products.routes";
import streamRouter from "./routes/stream.routes";
import { userRouter } from "./routes/user.routes";
import { logger } from "./utils/logger";
import { paymentRouter } from "./routes/payment.routes";
import { videoRoutes } from "./routes/video.routes";
import { vendorRouter } from "./routes/vendor.routes";

const app = new Hono();
const io = new SocketIOServer(app as unknown as HttpServer);

// Middleware
app.use("*", poweredBy());
app.use("*", secureHeaders());
// app.use('*', compress())
app.use(
	"*",
	cors({
		origin: process.env.CLIENT_URL || "http://localhost:3000",
		credentials: true,
	}),
);
// app.use('*', limiter)
app.use("*", async (c, next) => {
	if (c.req.method === "POST" || c.req.method === "PUT") {
		const body = await c.req.json();
		c.req.addValidatedData("json", body);
	}
	await next();
});

// Health check endpoint
app.get("/health", (c) => {
	return c.json({
		status: "OK",
		timestamp: new Date().toISOString(),
		uptime: process.uptime(),
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

// Initialize services
async function initializeServices() {
	try {
		// Database connections
		await connectPostgreSQL();
		// await connectCassandra()
		await connectRedis();

		// External services
		await initializeCloudinary();
		await initializeStripe();

		// Socket.IO setup
		setupSocketIO(io);

		logger.info("All services initialized successfully");
	} catch (error) {
		logger.error("Failed to initialize services:", error);
		process.exit(1);
	}
}

await initializeServices();

export default app;
