import Stripe from "stripe"
import { logger } from "../utils/logger"

let stripe: Stripe

export const initializeStripe = (): void => {
  try {
    if (!process.env.STRIPE_SECRET_KEY) {
      throw new Error("STRIPE_SECRET_KEY is required")
    }

    stripe = new Stripe(process.env.STRIPE_SECRET_KEY, {
      apiVersion: "2023-10-16",
    })

    logger.info("Stripe initialized successfully")
  } catch (error) {
    logger.error("Stripe initialization failed:", error)
    throw error
  }
}

export const getStripe = (): Stripe => {
  if (!stripe) {
    throw new Error("Stripe not initialized")
  }
  return stripe
}
