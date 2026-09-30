import mongoose from "mongoose";
import asyncHandler from "express-async-handler";
import { getStripe } from "../config/stripe.js";
import { confirmCheckoutSession, expireCheckoutSession } from "../services/booking.js";

const CHECKOUT_EVENTS = new Set([
    "checkout.session.completed",
    "checkout.session.async_payment_succeeded",
    "checkout.session.async_payment_failed",
    "checkout.session.expired",
]);

export const stripeWebhook = asyncHandler(async (req, res) => {
    const stripe = getStripe();

    if (!process.env.STRIPE_WEBHOOK_SECRET) {
        throw new Error("STRIPE_WEBHOOK_SECRET is not configured");
    }

    let event;

    try {
        event = stripe.webhooks.constructEvent(
            req.body,
            req.headers["stripe-signature"],
            process.env.STRIPE_WEBHOOK_SECRET
        );
    } catch {
        return res.status(400).json({
            success: false,
            message: "Invalid Stripe webhook signature",
        });
    }

    // Other Stripe events must not enter the booking payment state machine.
    if (!CHECKOUT_EVENTS.has(event.type)) {
        return res.status(200).json({ received: true });
    }

    const session = event.data?.object;
    const bookingId = session?.metadata?.bookingId;

    if (session?.object !== "checkout.session" || session.mode !== "payment" || !session.id ||
        !mongoose.isObjectIdOrHexString(bookingId)) {
        return res.status(200).json({ received: true });
    }

    switch (event.type) {
        case "checkout.session.completed":
        case "checkout.session.async_payment_succeeded":
            if (session.payment_status === "paid") {
                await confirmCheckoutSession(session, event.id);
            }
            break;

        case "checkout.session.async_payment_failed":
        case "checkout.session.expired": {
            await expireCheckoutSession(session, event.id,
                event.type === "checkout.session.async_payment_failed" ? "failed" : "expired");
            break;
        }

        default:
            break;
    }

    console.info("Stripe webhook processed", { eventId: event.id, type: event.type });
    return res.status(200).json({ received: true });
});
