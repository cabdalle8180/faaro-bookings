import mongoose from "mongoose";

const reviewSchema = new mongoose.Schema({
    customerId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        required: true
    },
    businessId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Business',
        required: true
    },
    unitId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Unit',
        required: true
    },
    stars: {
        type: Number,
        required: true,
        min: [1, 'stars must be at least 1 star'],
        max: [5, 'stars cannot exceed 5 stars'],
        validate: {
            validator: Number.isInteger,
            message: 'stars must be a whole number'
        }
    },
    description: {
        type: String
    }
}, {timestamps: true});

const Review = mongoose.model('Review', reviewSchema);

export default Review
