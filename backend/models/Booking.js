import mongoose from "mongoose";

const bookingSchema = new mongoose.Schema({
    unitId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Unit',
        required: true
    },
    businessId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Business',
        required: true
    },
    customerId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        required: true
    },
    code: {
        type: String,
        required: true,
        unique: true
    },
    document: {
        url: {
            type: String,
        },
        publicId: {
            type: String
        },
        format: String,
        deliveryType: { type: String, enum: ['upload', 'authenticated'] }
    },
    status: {
        type: String,
        // progress = pending payment; confirmation requires server-verified Stripe payment.
        enum: ['cancelled', 'progress', 'confirmed', 'expired', 'completed'],
        default: 'progress'
    },
    startDate: {
        type: Date,
        required: true
    },
    endDate: {
        type: Date,
        required: true
    },
    isValid:{
        type: Boolean,
        default: false
    },
    stripeSessionId: {
        type: String,
        index: true
    },
    stripePaymentIntentId: String,
    lastStripeEventId: String,
    paymentStatus: {
        type: String,
        enum: ['unpaid', 'paid', 'failed', 'expired', 'refunded'],
        default: 'unpaid'
    },
    expiresAt: Date,
    confirmedAt: Date,
    paymentCheckedAt: Date,
    guests: { type: Number, min: 1, default: 1, validate: Number.isInteger },
    // Price snapshot: all amounts are USD values, amountMinor is Stripe cents.
    unitPrice: { type: Number, min: 0 },
    currency: { type: String, enum: ['USD'] },
    quantity: { type: Number, min: 1 },
    subtotal: { type: Number, min: 0 },
    fees: { type: Number, default: 0, min: 0 },
    totalAmount: { type: Number, min: 0 },
    amountMinor: { type: Number, min: 1 },

}, {timestamps: true});

bookingSchema.index({ unitId: 1, status: 1, startDate: 1, endDate: 1 });

const Booking = mongoose.model('Booking', bookingSchema);
export default Booking;
