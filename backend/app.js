import express from "express";
import cookieParser from "cookie-parser";
import cors from "cors";
import errorMiddleware from "./middlewares/errorMiddleware.js";
import authRoutes from "./routes/authRoutes.js";
import adminRoutes from "./routes/adminRoutes.js";
import customerRoutes from "./routes/customerRoutes.js";
import catalogRoutes from "./routes/catalogRoutes.js";
import ownerRoutes from "./routes/ownerRoutes.js";
import { stripeWebhook } from "./controllers/stripeWebhook.js";
import { parseHttpUrl } from "./config/env.js";
export const createApp = () => {
  const app = express();
  const clientUrl = process.env.CLIENT_URL || process.env.Client_URI;
  const clientOrigin = clientUrl ? parseHttpUrl(clientUrl, "CLIENT_URL").origin : false;

  // Stripe signs the original bytes. This route must precede JSON parsing.
  app.post("/api/stripe/webhook", express.raw({ type: "application/json" }), stripeWebhook);
  app.use(express.json());
  app.use(cors({ origin: clientOrigin, credentials: true }));
  app.use(cookieParser());

  app.get("/", (req, res) => {
    res.send("The server is running");
  });
  app.use("/api/auth", authRoutes);
  app.use("/api/admin/users", adminRoutes);
  app.use("/api/customer", customerRoutes);
  app.use("/api/catalog", catalogRoutes);
  app.use("/api/owner", ownerRoutes);

  app.use(errorMiddleware);
  return app;
};
