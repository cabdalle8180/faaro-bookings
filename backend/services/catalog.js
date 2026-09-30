import Business from "../models/business.js";
import User from "../models/User.js";
import { bookingError } from "./booking.js";

export const activeBusinessFilter = async (session) => {
  const owners = await User.find({ role: "owner", status: "active" }).select("_id").session(session || null);
  return { status: "active", ownerId: { $in: owners.map((owner) => owner._id) } };
};

export const findActiveBusiness = async (id, session) => Business.findOne({
  _id: id, ...await activeBusinessFilter(session),
}).session(session || null);

export const unitCapacity = (unit) => unit.details?.hotel?.capacity ??
  unit.details?.apartment?.maxGuests ?? unit.details?.car?.seats;

export const validateGuests = (unit, input = 1) => {
  const guests = Number(input);
  if (!Number.isSafeInteger(guests) || guests < 1) throw bookingError(400, "Guests must be a positive whole number");
  const capacity = unitCapacity(unit);
  if (capacity != null && guests > capacity) throw bookingError(400, `This unit accommodates up to ${capacity} guests`);
  return guests;
};
