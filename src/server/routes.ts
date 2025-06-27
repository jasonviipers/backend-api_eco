import { Hono } from "hono";
import auth from "../routes/auth.routes";
import { userRouter } from "../routes/user.routes";
import { productRouter } from "../routes/products.routes";
import streamRouter from "../routes/stream.routes";
import { paymentRouter } from "../routes/payment.routes";
import { videoRoutes } from "../routes/video.routes";
import { vendorRouter } from "../routes/vendor.routes";
import { orderRouter } from "../routes/order.routes";
import { env } from "../utils/env";

export function registerRoutes(app: Hono) {
	app.get("/", (c) => {
		return c.json({
			message: "Live Commerce API",
			version: "1.0.0",
			status: "active",
			timestamp: new Date().toISOString(),
		});
	});
	app.get("/health", (c) => {
		return c.json({
			status: "OK",
			timestamp: new Date().toISOString(),
			uptime: process.uptime(),
			environment: env.NODE_ENV,
		});
	});
	app.route("/auth", auth);
	app.route("/user", userRouter);
	app.route("/product", productRouter);
	app.route("/stream", streamRouter);
	app.route("/payment", paymentRouter);
	app.route("/video", videoRoutes);
	app.route("/vendor", vendorRouter);
	app.route("/order", orderRouter);
}
