export const paidBooking = (booking) => booking?.status === "confirmed" ||
  (booking?.status === "progress" && booking?.isValid === true);
export const displayStatus = (booking) => paidBooking(booking) ? "confirmed" : booking?.status;

export function paymentReturnTitle(booking, kind) {
  if (paidBooking(booking)) return "Reservation confirmed";
  if (booking?.status === "completed") return "Reservation completed";
  if (booking?.status === "expired") return "Payment session expired";
  if (booking?.status === "cancelled") return "Pending booking cancelled";
  if (booking?.status === "progress") return kind === "cancel" ? "Checkout not completed" : "Waiting for payment confirmation";
  return "Reservation status";
}
