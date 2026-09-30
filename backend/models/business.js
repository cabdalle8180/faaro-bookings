import mongoose from "mongoose";

const businessSchema = new mongoose.Schema({
    ownerId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        required: true
    },
    name: {
        type: String,
        required: true
    },
    description: {
        type: String
    },
    category: {
        type: String,
        enum: ['hotel', 'car_rental', 'apartment'],
        required: true
    },
    contactPhone: {
        type: String,
        required: true
    },
    city: {
        type: String,
        required: true
    },
    status: {
        type: String,
        enum: ['active', 'suspended'],
        default: 'active'
    },
    address: {
        type: String,
        required: true
    },
    images: [{
        url: {
            type: String,
            required: true
        },
        publicId: {
            type: String,
            required: true
        }
    }],
    openHours: {
        type: String,
        required: true
    }
}, {timestamps: true});

// Existing owner APIs manage one Business per owner.
businessSchema.index({ ownerId: 1 }, { unique: true });

const Business = mongoose.model('Business', businessSchema);

export default Business
