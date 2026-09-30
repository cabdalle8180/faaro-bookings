import { Router } from "express";
import {
  getAllUnits,
  getAllBusinesses,
  getUnitById,
  getBusinessById,
  createBooking,
  getMyBookings,
  getMyBookingById,
  cancelPendingBooking,
  getUnitAvailability,
  syncMyBookingPayment,
} from "../controllers/customer.js";
import { protect } from "../middlewares/authmiddleware.js";
import upload from "../middlewares/multer.js";

const router = Router();

// All routes require a signed-in customer.
router.use(protect, (req, res, next) => {
  if (req.user.role !== "customer") {
    res.status(403);
    return next(new Error("Customer access required"));
  }

  next();
});

router.get("/units", getAllUnits);
router.get("/units/:id", getUnitById);
router.get("/units/:id/availability", getUnitAvailability);

router.get("/businesses", getAllBusinesses);
router.get("/business/:id", getBusinessById);

router.post("/booking", upload.single("document"), createBooking);
router.get("/bookings", getMyBookings);
router.get("/booking/:id", getMyBookingById);
router.post("/booking/:id/cancel", cancelPendingBooking);
router.post("/booking/:id/payment-status", syncMyBookingPayment);

export default router;
