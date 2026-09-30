import Booking from "../models/Booking.js";
import { getStripe } from "../config/stripe.js";
import { reconcileBookingPayment } from "./booking.js";

// Webhooks remain the primary notification path. Recover missed delivery after
// downtime, even when the customer never returns from Checkout.
export const reconcilePendingPayments = async () => {
  if (!process.env.STRIPE_SECRET_KEY) return;
  const pending = await Booking.find({ status: "progress", isValid: false,
    stripeSessionId: { $type: "string" },
    $or: [{ paymentCheckedAt: { $exists: false } }, { paymentCheckedAt: { $lt: new Date(Date.now() - 30000) } }],
  }).sort({ paymentCheckedAt: 1, createdAt: 1 }).limit(100);
  for (const booking of pending) {
    try { await reconcileBookingPayment(booking, getStripe()); }
    catch (error) { console.error("Payment reconciliation failed", String(booking._id), error.name); }
    finally { await Booking.updateOne({ _id: booking._id }, { $set: { paymentCheckedAt: new Date() } }); }
  }
};

export const startPaymentReconciliation = () => {
  let running = false;
  const tick = async () => {
    if (running) return;
    running = true;
    try { await reconcilePendingPayments(); }
    catch (error) { console.error("Payment reconciliation unavailable:", error.name); }
    finally { running = false; }
  };
  const timer = setInterval(tick, 30000);
  timer.unref();
  void tick();
  return () => clearInterval(timer);
};
