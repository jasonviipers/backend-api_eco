import nodemailer from "nodemailer";
import { logger } from "../utils/logger";

interface EmailOptions {
	to: string;
	subject: string;
	html: string;
	from?: string;
}

export const emailTransporter  = nodemailer.createTransport({
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
	appUrl: process.env.NODE_ENV === "production" ? process.env.APP_URL : "localhost:5000",
}

// export const sendEmail = async (options: EmailOptions): Promise<void> => {
// 	try {
// 		const mailOptions = {
// 			from: options.from || process.env.FROM_EMAIL || "noreply@platform.com",
// 			to: options.to,
// 			subject: options.subject,
// 			html: options.html,
// 		};

// 		await transporter.sendMail(mailOptions);
// 		logger.info(`Email sent successfully to ${options.to}`);
// 	} catch (error) {
// 		logger.error("Email sending failed:", error);
// 		throw error;
// 	}
// };

// export const sendWelcomeEmail = async (
// 	email: string,
// 	firstName: string,
// ): Promise<void> => {
// 	await sendEmail({
// 		to: email,
// 		subject: "Welcome to our platform!",
// 		html: `
//       <h1>Welcome ${firstName}!</h1>
//       <p>Thank you for joining our live streaming e-commerce platform.</p>
//       <p>Start exploring amazing products and live streams from our vendors.</p>
//     `,
// 	});
// };

// export const sendOrderConfirmation = async (
// 	email: string,
// 	orderDetails: any,
// ): Promise<void> => {
// 	await sendEmail({
// 		to: email,
// 		subject: `Order Confirmation - #${orderDetails.orderNumber}`,
// 		html: `
//       <h1>Order Confirmed!</h1>
//       <p>Your order #${orderDetails.orderNumber} has been confirmed.</p>
//       <p>Total: $${orderDetails.total}</p>
//       <p>We'll send you updates as your order is processed.</p>
//     `,
// 	});
// };
