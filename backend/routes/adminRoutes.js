import express from "express";
import {
  suspendUser,
  createBusiness,
  getAllUsers,
  getAllBusiness,
} from "../controllers/admin_crude.js";
import { protect, adminOnly } from "../middlewares/authmiddleware.js";
import upload from "../middlewares/multer.js";

const router = express.Router();

// Every route below requires a signed-in admin.
router.use(protect, adminOnly);

router.get("/", getAllUsers);
router.get("/owners", getAllBusiness);
router.post("/suspend/:id", suspendUser);
router.post(
  "/businessOwner/:id",
  upload.array("images", 5),
  createBusiness
);

export default router;