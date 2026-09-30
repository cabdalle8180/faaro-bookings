import mongoose from "mongoose";

const connectDB = async () => {
  const uri = process.env.MONGODB_URI?.trim();

  if (!uri) {
    throw new Error("MONGODB_URI is missing. Check backend/.env");
  }

  const connection = await mongoose.connect(uri);

  const topology = await connection.connection.db.admin().command({ hello: 1 });
  if (!topology.setName && topology.msg !== "isdbgrid") {
    await mongoose.disconnect();
    throw new Error("MongoDB transactions require a replica set or sharded cluster");
  }

  console.log(`MongoDB connected: ${connection.connection.host}`);
  return connection;
};

export default connectDB;
