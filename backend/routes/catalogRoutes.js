import { Router } from "express";
import { publicBusinesses, publicBusiness, publicUnits, publicUnit, publicAvailability } from "../controllers/catalog.js";
const router = Router();
router.get("/businesses", publicBusinesses);
router.get("/businesses/:id", publicBusiness);
router.get("/units", publicUnits);
router.get("/units/:id", publicUnit);
router.get("/units/:id/availability", publicAvailability);
export default router;
