import { Hono } from "hono";
import type { JwtVariables } from "hono/jwt";
import { sign, verify } from "hono/jwt";
import { validator } from "hono/validator";
import { query } from "../config/postgresql";
import { deleteCache, getCache, setCache } from "../config/redis";
import {
	forgotPasswordSchema,
	loginSchema,
	registerSchema,
	resetPasswordSchema,
	verifyEmailSchema,
} from "../schemas/auth";
import { logger } from "../utils/logger";
import { generateOtp } from "../utils/opt";
import { EmailService } from "../email/email.service";
import { loginRateLimit, passwordResetRateLimit } from "../utils/limitl";

type Variables = JwtVariables;

const auth = new Hono<{ Variables: Variables }>();
auth.post(
	"/register",
	validator("json", (value, c) => {
		const parsed = registerSchema.safeParse(value);
		if (!parsed.success) {
			return c.json({ error: parsed.error.flatten() }, 400);
		}
		return parsed.data;
	}),
	async (c) => {
		const ip =
			c.req.header("x-forwarded-for") || c.req.header("x-real-ip") || "";
		const rateLimitResult = await loginRateLimit(ip);
		if (!rateLimitResult.ok) {
			logger.error("Rate limit error:", rateLimitResult.error);
			return c.json({ error: "Internal server error" }, 500);
		}
		if (!rateLimitResult.value.allowed) {
			return c.json({
				error: "Too many register attempts. Please try again later.",
				resetTime: rateLimitResult.value.resetTime,
			});
		}
		const { email, password, full_name, phone, role } = c.req.valid("json");
		const existingUser = await query("SELECT * FROM users WHERE email = $1", [
			email,
		]);
		if (existingUser.rows.length > 0) {
			return c.json({ error: "Please enter a valid email" }, 409);
		}
		const hashedPassword = await Bun.password.hash(password);
		const verificationOTP = generateOtp();
		const newUser = await query(
			`INSERT INTO users (email, password, full_name, phone, role, verification_token, is_active)
      VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id, email, full_name, role`,
			[email, hashedPassword, full_name, phone, role, verificationOTP, false],
		);
		const user = newUser.rows[0];

		if (role === "vendor") {
			await query(
				"INSERT INTO vendors (user_id, business_name, status) VALUES ($1, $2, $3)",
				[user.id, `${full_name}`, "pending"],
			);
		}
		await EmailService.sendWelcomeEmail(
			{ name: user.full_name, email: user.email },
			verificationOTP,
		);
		return c.json(
			{
				message:
					"User registered successfully. Please check your email to verify your account.",
				user: {
					id: user.id,
					email: user.email,
					full_name: user.full_name,
					role: user.role,
				},
			},
			201,
		);
	},
);

auth.post(
	"/login",
	validator("json", (value, c) => {
		const parsed = loginSchema.safeParse(value);
		if (!parsed.success) {
			return c.json({ error: parsed.error.flatten() }, 400);
		}
		return parsed.data;
	}),
	async (c) => {
		const ip =
			c.req.header("x-forwarded-for") || c.req.header("x-real-ip") || "";
		const rateLimitResult = await loginRateLimit(ip);

		if (!rateLimitResult.ok) {
			logger.error("Rate limit error:", rateLimitResult.error);
			return c.json({ error: "Internal server error" }, 500);
		}

		if (!rateLimitResult.value.allowed) {
			return c.json(
				{
					error: "Too many login attempts. Please try again later.",
					resetTime: rateLimitResult.value.resetTime,
				},
				429,
			);
		}
		const { email, password } = c.req.valid("json");

		const userResult = await query(
			"SELECT id, email, password, full_name, role, is_active, email_verified FROM users WHERE email = $1",
			[email],
		);

		if (userResult.rows.length === 0) {
			return c.json({ error: "Invalid credentials" }, 401);
		}

		const user = userResult.rows[0];

		if (!user.is_active) {
			return c.json({ error: "User is not active" }, 401);
		}

		if (!user.email_verified) {
			return c.json({ error: "Please verify your email" }, 401);
		}

		const passwordMatch = await Bun.password.verify(password, user.password);

		if (!passwordMatch) {
			return c.json({ error: "Invalid credentials" }, 401);
		}

		const token = await sign(
			{
				id: user.id,
				email: user.email,
				full_name: user.full_name,
				role: user.role,
			},
			process.env.JWT_SECRET ?? "",
		);

		const refreshToken = await sign(
			{ id: user.id },
			process.env.JWT_REFRESH_SECRET ?? "",
		);

		await setCache(`refresh_token:${user.id}`, refreshToken, 7 * 24 * 60 * 60); // 7 days

		await query("UPDATE users SET last_login = $1 WHERE id = $2", [
			new Date(),
			user.id,
		]);

		return c.json({
			message: "Login successful",
			token,
			refreshToken,
		});
	},
);

auth.post("/refresh", async (c) => {
	const { refreshToken } = await c.req.json();

	if (!refreshToken) {
		return c.json({ error: "Refresh token required" }, 401);
	}

	try {
		const decoded = await verify(
			refreshToken,
			process.env.JWT_REFRESH_SECRET ?? "",
		);
		const storedToken = await getCache(`refresh_token:${decoded.id}`);
		if (storedToken !== refreshToken) {
			return c.json({ error: "Invalid refresh token" }, 401);
		}
		const userResult = await query(
			"SELECT id, email, full_name, role FROM users WHERE id = $1 AND is_active = true",
			[decoded.id],
		);

		if (userResult.rows.length === 0) {
			return c.json({ error: "User not found" }, 401);
		}

		const user = userResult.rows[0];

		const token = await sign(
			{
				id: user.id,
				email: user.email,
				full_name: user.full_name,
				role: user.role,
			},
			process.env.JWT_SECRET ?? "",
		);
		return c.json({
			message: "Token refreshed successfully",
			token,
		});
	} catch (error) {
		return c.json({ error: "Invalid refresh token" }, 401);
	}
});

auth.post(
	"/verify-email",
	validator("json", (value, c) => {
		const parsed = verifyEmailSchema.safeParse(value);
		if (!parsed.success) {
			return c.json({ error: parsed.error.flatten() }, 400);
		}
		return parsed.data;
	}),
	async (c) => {
		const { token } = c.req.valid("json");

		const userResult = await query(
			"SELECT id FROM users WHERE verification_token = $1",
			[token],
		);

		if (userResult.rows.length === 0) {
			return c.json({ error: "Invalid verification token" }, 400);
		}

		// Update user as verified
		await query(
			"UPDATE users SET email_verified = true, verification_token = null, is_active = true WHERE verification_token = $1",
			[token],
		);

		return c.json({ message: "Email verified successfully" });
	},
);

auth.post(
	"/forgot-password",
	validator("json", (value, c) => {
		const parsed = forgotPasswordSchema.safeParse(value);
		if (!parsed.success) {
			return c.json({ error: parsed.error.flatten() }, 400);
		}
		return parsed.data;
	}),
	async (c) => {
		const { email } = await c.req.json();
		const rateLimitResult = await passwordResetRateLimit(email);

		if (!rateLimitResult.ok) {
			logger.error("Rate limit error:", rateLimitResult.error);
			return c.json({ error: "Internal server error" }, 500);
		}

		if (!rateLimitResult.value.allowed) {
			return c.json(
				{
					error: "Too many password reset requests. Please try again later.",
					resetTime: rateLimitResult.value.resetTime,
				},
				429,
			);
		}
		const userResult = await query(
			"SELECT id, full_name FROM users WHERE email = $1",
			[email],
		);
		if (userResult.rows.length === 0) {
			return c.json({
				message: "If the email exists, a reset link has been sent",
			});
		}
		const user = userResult.rows[0];
		const resetToken = generateOtp();
		const resetExpires = new Date(Date.now() + 3600000); // 1 hour from now
		await query(
			"UPDATE users SET reset_token = $1, reset_expires = $2 WHERE email = $3",
			[resetToken, resetExpires, email],
		);

		await EmailService.sendPasswordResetEmail(
			{ name: user.full_name, email: email },
			resetToken,
		);
		return c.json({
			message: "If the email exists, a reset link has been sent",
		});
	},
);

auth.post(
	"/reset-password",
	validator("json", (value, c) => {
		const parsed = resetPasswordSchema.safeParse(value);
		if (!parsed.success) {
			return c.json({ error: parsed.error.flatten() }, 400);
		}
		return parsed.data;
	}),
	async (c) => {
		const ip =
			c.req.header("x-forwarded-for") || c.req.header("x-real-ip") || "";
		const rateLimitResult = await loginRateLimit(ip);

		if (!rateLimitResult.ok) {
			logger.error("Rate limit error:", rateLimitResult.error);
			return c.json({ error: "Internal server error" }, 500);
		}
		if (!rateLimitResult.value.allowed) {
			return c.json(
				{
					error: "Too many password reset attempts. Please try again later.",
					resetTime: rateLimitResult.value.resetTime,
				},
				429,
			);
		}
		const { token, password } = c.req.valid("json");

		const userResult = await query(
			"SELECT id FROM users WHERE reset_token = $1 AND reset_expires > $2",
			[token, new Date()],
		);

		if (userResult.rows.length === 0) {
			return c.json({ error: "Invalid or expired reset token" }, 400);
		}

		const hashedPassword = await Bun.password.hash(password);

		await query(
			"UPDATE users SET password = $1, reset_token = null, reset_expires = null WHERE reset_token = $2",
			[hashedPassword, token],
		);

		return c.json({ message: "Password reset successfully" });
	},
);

auth.post("/logout", async (c) => {
	const { refreshToken } = await c.req.json();

	if (refreshToken) {
		try {
			const decoded = await verify(
				refreshToken,
				process.env.JWT_REFRESH_SECRET ?? "",
			);
			await deleteCache(`refresh_token:${decoded.id}`);
		} catch (error) {
			// Token might be invalid, but we still want to logout
			logger.error(error);
		}
	}

	return c.json({ message: "Logged out successfully" });
});

export default auth;
