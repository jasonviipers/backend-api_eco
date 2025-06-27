import Stripe from "stripe";
import { logger } from "../utils/logger";
import { env } from "../utils/env";

let stripe: Stripe;

export const initializeStripe = (): void => {
	try {
		stripe = new Stripe(env.STRIPE_SECRET_KEY, {
			apiVersion: "2025-05-28.basil",
		});

		logger.info("Stripe initialized successfully");
	} catch (error) {
		logger.error("Stripe initialization failed:", error);
		throw error;
	}
};

export const getStripe = (): Stripe => {
	if (!stripe) {
		throw new Error("Stripe not initialized");
	}
	return stripe;
};
