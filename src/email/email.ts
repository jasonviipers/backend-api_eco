import nodemailer from "nodemailer";

export const emailTransporter = nodemailer.createTransport({
	host: process.env.SMTP_HOST || "smtp.gmail.com",
	port: Number.parseInt(process.env.SMTP_PORT || "587"),
	secure: false,
	auth: {
		user: process.env.SMTP_USER,
		pass: process.env.SMTP_PASS,
	},
});

export const emailConfig = {
	from: process.env.FROM_EMAIL,
	supportEmail: process.env.SUPPORT_EMAIL,
	appName: process.env.APP_NAME,
	appUrl:
		process.env.NODE_ENV === "production"
			? process.env.APP_URL
			: "localhost:5000",
};
