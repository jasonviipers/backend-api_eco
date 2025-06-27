import nodemailer from "nodemailer";
import { env } from "../utils/env";

export const emailTransporter = nodemailer.createTransport({
	host: env.SMTP_HOST,
	port: env.SMTP_PORT,
	secure: false,
	auth: {
		user: env.SMTP_USER,
		pass: env.SMTP_PASS,
	},
});

export const emailConfig = {
	from: env.FROM_EMAIL,
	supportEmail: env.SUPPORT_EMAIL,
	appName: env.APP_NAME,
	appUrl: env.NODE_ENV === "production" ? env.APP_URL : "localhost:5000",
};
