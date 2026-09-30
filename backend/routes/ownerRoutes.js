import { Router } from "express";
import {
  createUnit,
  updateUnit,
  deleteUnit,
  getAllBookings,
  getBookingById,
  CheckBooking,
  getMyUnits,
  getMyBusiness,
  createMyBusiness,
  updateMyBusiness,
  getMyUnitById,
} from "../controllers/owners_crude.js";
import { protect, ownerOnly } from "../middlewares/authmiddleware.js";
import upload from "../middlewares/multer.js";

const router = Router();

router.use(protect, ownerOnly);

router.get("/business", getMyBusiness);
router.post("/business", upload.array("images", 5), createMyBusiness);
router.patch("/business", upload.array("images", 5), updateMyBusiness);
router.get("/units", getMyUnits);
router.get("/units/:id", getMyUnitById);
router.post("/units", upload.array("images", 5), createUnit);
router.patch("/units/:id", upload.array("images", 5), updateUnit);
router.delete("/units/:id", deleteUnit);

router.get("/booking", getAllBookings);
router.get("/booking/:id", getBookingById);
router.post("/check-booking/:id", CheckBooking);

export default router;
