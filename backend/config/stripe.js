import Stripe from "stripe";

let stripe;

export const getStripe = () => {
    if (!process.env.STRIPE_SECRET_KEY) {
        throw new Error("STRIPE_SECRET_KEY is not configured");
    }

    // server.js loads backend/.env before a request reaches this function.
    stripe ??= new Stripe(process.env.STRIPE_SECRET_KEY);
    return stripe;
};