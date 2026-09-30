import dotenv from "dotenv";
import path from "node:path";
import { fileURLToPath } from "node:url";
import mongoose from "mongoose";

const directory = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.join(directory, "..", ".env") });
if (!process.env.MONGODB_URI) throw new Error("MONGODB_URI is required");

try {
  await mongoose.connect(process.env.MONGODB_URI);
  const collection = mongoose.connection.collection("favorites");
  const legacy = await collection.find({ customaId: { $exists: true } }).toArray();
  const seen = new Set();
  for (const favorite of legacy) {
    const key = `${favorite.customaId}:${favorite.unitId}`;
    if (seen.has(key) || (favorite.customerId && String(favorite.customerId) !== String(favorite.customaId)) ||
        await collection.findOne({ _id: { $ne: favorite._id }, customerId: favorite.customaId,
          unitId: favorite.unitId })) {
      throw new Error(`Favorite migration collision at record ${favorite._id}; resolve duplicates before retrying`);
    }
    seen.add(key);
  }
  if (!legacy.length) {
    console.log("No legacy favorite records require migration");
  } else {
    const session = await mongoose.startSession();
    try {
      await session.withTransaction(async () => {
        for (const favorite of legacy) {
          await collection.updateOne({ _id: favorite._id, customaId: favorite.customaId },
            { $set: { customerId: favorite.customaId }, $unset: { customaId: "" } }, { session });
        }
      });
    } finally {
      await session.endSession();
    }
    console.log(`Migrated ${legacy.length} favorite records`);
  }
} finally {
  await mongoose.disconnect();
}
