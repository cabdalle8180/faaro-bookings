import mongoose from "mongoose";

const favoriteSchema = new mongoose.Schema({
    customerId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        required: true
    },
    unitId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Unit',
        required: true
    },
}, {timestamps: true})

// Partial index leaves legacy customaId documents available for migration.
favoriteSchema.index({ customerId: 1, unitId: 1 }, {
    unique: true,
    partialFilterExpression: { customerId: { $type: 'objectId' } }
});

const Favorite = mongoose.model('Favorite', favoriteSchema);

export default Favorite
