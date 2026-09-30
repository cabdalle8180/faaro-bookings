import dotenv from "dotenv";
import path from "node:path";
import { fileURLToPath } from "node:url";

import connectDB from "./config/db.js";
import { createApp } from "./app.js";
import { validateEnvironment } from "./config/env.js";
import { startPaymentReconciliation } from "./services/paymentReconciliation.js";


const currentDir = path.dirname(fileURLToPath(import.meta.url));
const envPath = path.join(currentDir, ".env");

const envResult = dotenv.config({ path: envPath });

if (envResult.error && !process.env.MONGODB_URI) {
  throw envResult.error;
}

validateEnvironment();
const app = createApp();
const PORT = process.env.PORT || 5000;
await connectDB();

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
  startPaymentReconciliation();
});
