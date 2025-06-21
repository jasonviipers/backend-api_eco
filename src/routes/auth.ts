import express from "express"
import bcrypt from "bcryptjs"
import jwt from "jsonwebtoken"
import { v4 as uuidv4 } from "uuid"
import { query } from "../config/postgresql"
import { setCache, getCache, deleteCache } from "../config/redis"
import { validateRequest } from "../middleware/validation"
import { asyncHandler } from "../middleware/errorHandler"
import {
  registerSchema,
  loginSchema,
  forgotPasswordSchema,
  resetPasswordSchema,
  verifyEmailSchema,
} from "../schemas/auth"
import { sendEmail } from "../utils/email"

const router = express.Router()

// Register
router.post(
  "/register",
  validateRequest({ body: registerSchema }),
  asyncHandler(async (req, res) => {
    const { email, password, firstName, lastName, phone, role } = req.body

    // Check if user already exists
    const existingUser = await query("SELECT id FROM users WHERE email = $1", [email])
    if (existingUser.rows.length > 0) {
      return res.status(409).json({ error: "User already exists" })
    }

    // Hash password
    const hashedPassword = await bcrypt.hash(password, 12)

    // Generate verification token
    const verificationToken = uuidv4()

    // Create user
    const userResult = await query(
      `INSERT INTO users (email, password, first_name, last_name, phone, role, verification_token, is_active)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING id, email, first_name, last_name, role`,
      [email, hashedPassword, firstName, lastName, phone, role, verificationToken, false],
    )

    const user = userResult.rows[0]

    // If registering as vendor, create vendor profile
    if (role === "vendor") {
      await query("INSERT INTO vendors (user_id, business_name, status) VALUES ($1, $2, $3)", [
        user.id,
        `${firstName} ${lastName}`,
        "pending",
      ])
    }

    // Send verification email
    await sendEmail({
      to: email,
      subject: "Verify your email address",
      html: `
      <h1>Welcome to our platform!</h1>
      <p>Please click the link below to verify your email address:</p>
      <a href="${process.env.CLIENT_URL}/verify-email?token=${verificationToken}">Verify Email</a>
    `,
    })

    res.status(201).json({
      message: "User registered successfully. Please check your email to verify your account.",
      user: {
        id: user.id,
        email: user.email,
        firstName: user.first_name,
        lastName: user.last_name,
        role: user.role,
      },
    })
  }),
)

// Login
router.post(
  "/login",
  validateRequest({ body: loginSchema }),
  asyncHandler(async (req, res) => {
    const { email, password } = req.body

    // Find user
    const userResult = await query(
      "SELECT id, email, password, first_name, last_name, role, is_active, email_verified FROM users WHERE email = $1",
      [email],
    )

    if (userResult.rows.length === 0) {
      return res.status(401).json({ error: "Invalid credentials" })
    }

    const user = userResult.rows[0]

    // Check if user is active
    if (!user.is_active) {
      return res.status(401).json({ error: "Account is deactivated" })
    }

    // Check if email is verified
    if (!user.email_verified) {
      return res.status(401).json({ error: "Please verify your email address" })
    }

    // Verify password
    const isValidPassword = await bcrypt.compare(password, user.password)
    if (!isValidPassword) {
      return res.status(401).json({ error: "Invalid credentials" })
    }

    // Generate tokens
    const accessToken = jwt.sign({ userId: user.id, email: user.email, role: user.role }, process.env.JWT_SECRET!, {
      expiresIn: "15m",
    })

    const refreshToken = jwt.sign({ userId: user.id }, process.env.JWT_REFRESH_SECRET!, { expiresIn: "7d" })

    // Store refresh token in Redis
    await setCache(`refresh_token:${user.id}`, refreshToken, 7 * 24 * 60 * 60) // 7 days

    // Update last login
    await query("UPDATE users SET last_login = $1 WHERE id = $2", [new Date(), user.id])

    res.json({
      message: "Login successful",
      user: {
        id: user.id,
        email: user.email,
        firstName: user.first_name,
        lastName: user.last_name,
        role: user.role,
      },
      accessToken,
      refreshToken,
    })
  }),
)

// Refresh token
router.post(
  "/refresh",
  asyncHandler(async (req, res) => {
    const { refreshToken } = req.body

    if (!refreshToken) {
      return res.status(401).json({ error: "Refresh token required" })
    }

    try {
      const decoded = jwt.verify(refreshToken, process.env.JWT_REFRESH_SECRET!) as any

      // Check if refresh token exists in Redis
      const storedToken = await getCache(`refresh_token:${decoded.userId}`)
      if (storedToken !== refreshToken) {
        return res.status(401).json({ error: "Invalid refresh token" })
      }

      // Get user details
      const userResult = await query("SELECT id, email, role FROM users WHERE id = $1 AND is_active = true", [
        decoded.userId,
      ])

      if (userResult.rows.length === 0) {
        return res.status(401).json({ error: "User not found" })
      }

      const user = userResult.rows[0]

      // Generate new access token
      const accessToken = jwt.sign({ userId: user.id, email: user.email, role: user.role }, process.env.JWT_SECRET!, {
        expiresIn: "15m",
      })

      res.json({ accessToken })
    } catch (error) {
      res.status(401).json({ error: "Invalid refresh token" })
    }
  }),
)

// Verify email
router.post(
  "/verify-email",
  validateRequest({ body: verifyEmailSchema }),
  asyncHandler(async (req, res) => {
    const { token } = req.body

    const userResult = await query("SELECT id FROM users WHERE verification_token = $1", [token])

    if (userResult.rows.length === 0) {
      return res.status(400).json({ error: "Invalid verification token" })
    }

    // Update user as verified
    await query(
      "UPDATE users SET email_verified = true, verification_token = null, is_active = true WHERE verification_token = $1",
      [token],
    )

    res.json({ message: "Email verified successfully" })
  }),
)

// Forgot password
router.post(
  "/forgot-password",
  validateRequest({ body: forgotPasswordSchema }),
  asyncHandler(async (req, res) => {
    const { email } = req.body

    const userResult = await query("SELECT id FROM users WHERE email = $1", [email])

    if (userResult.rows.length === 0) {
      // Don't reveal if email exists
      return res.json({ message: "If the email exists, a reset link has been sent" })
    }

    const resetToken = uuidv4()
    const resetExpires = new Date(Date.now() + 3600000) // 1 hour

    await query("UPDATE users SET reset_token = $1, reset_expires = $2 WHERE email = $3", [
      resetToken,
      resetExpires,
      email,
    ])

    await sendEmail({
      to: email,
      subject: "Password Reset Request",
      html: `
      <h1>Password Reset</h1>
      <p>You requested a password reset. Click the link below to reset your password:</p>
      <a href="${process.env.CLIENT_URL}/reset-password?token=${resetToken}">Reset Password</a>
      <p>This link will expire in 1 hour.</p>
    `,
    })

    res.json({ message: "If the email exists, a reset link has been sent" })
  }),
)

// Reset password
router.post(
  "/reset-password",
  validateRequest({ body: resetPasswordSchema }),
  asyncHandler(async (req, res) => {
    const { token, password } = req.body

    const userResult = await query("SELECT id FROM users WHERE reset_token = $1 AND reset_expires > $2", [
      token,
      new Date(),
    ])

    if (userResult.rows.length === 0) {
      return res.status(400).json({ error: "Invalid or expired reset token" })
    }

    const hashedPassword = await bcrypt.hash(password, 12)

    await query("UPDATE users SET password = $1, reset_token = null, reset_expires = null WHERE reset_token = $2", [
      hashedPassword,
      token,
    ])

    res.json({ message: "Password reset successfully" })
  }),
)

// Logout
router.post(
  "/logout",
  asyncHandler(async (req, res) => {
    const { refreshToken } = req.body

    if (refreshToken) {
      try {
        const decoded = jwt.verify(refreshToken, process.env.JWT_REFRESH_SECRET!) as any
        await deleteCache(`refresh_token:${decoded.userId}`)
      } catch (error) {
        // Token might be invalid, but we still want to logout
      }
    }

    res.json({ message: "Logged out successfully" })
  }),
)

export default router
