import { BrowserRouter, Link, Route, Routes } from "react-router-dom";
import { AuthProvider } from "./auth/AuthProvider";
import { Brand, Card, ProtectedRoute, SiteFooter, SiteHeader } from "./components/UI";
import { ForgotPasswordPage, LoginPage, RegisterPage, ResendVerificationPage, ResetPasswordPage, VerifyEmailPage } from "./pages/AuthPages";
import { HomePage, ListingDetailPage, SearchPage, UnitDetailPage } from "./pages/PublicPages";
import { BookingCheckout, CustomerBookingDetailLive, CustomerBookingsLive, CustomerCatalog, CustomerUnitDetail, PaymentReturn } from "./pages/BookingFlow";
import { CustomerDashboard, CustomerProfile, CustomerRefunds, CustomerReviews, CustomerSettings, CustomerShell } from "./pages/CustomerPages";
import { OwnerAvailability, OwnerProfile, OwnerRevenue, OwnerReviews, OwnerSettings, OwnerShell } from "./pages/OwnerPages";
import { OwnerBookingDetailLive, OwnerBookingsLive, OwnerDashboardLive } from "./pages/OwnerLive";
import { OwnerBusinessLive, OwnerUnitsLive, OwnerUnitEditorLive } from "./pages/OwnerManagement";
import { AdminBookings, AdminBusinesses, AdminDashboard, AdminPayments, AdminRefunds, AdminReviews, AdminSettings, AdminShell, AdminStatistics, AdminUsers } from "./pages/AdminPages";

function NotFound() {
  return <><SiteHeader /><main className="not-found"><Card className="p-10 text-center"><div className="text-5xl font-bold text-[#a83c03]">404</div><h1 className="text-2xl font-bold mt-4">Page not found</h1><p className="text-slate-600 mt-2">The page you requested does not exist.</p><Link to="/" className="btn btn-primary mt-6">Go home</Link></Card></main><SiteFooter /></>;
}

export default function App() {
  return <BrowserRouter><AuthProvider><Routes>
    <Route path="/" element={<HomePage />} />
    <Route path="/search" element={<SearchPage />} />
    <Route path="/listing" element={<ListingDetailPage />} />
    <Route path="/listing/:id" element={<ListingDetailPage />} />
    <Route path="/units/:id" element={<UnitDetailPage />} />
    <Route path="/checkout" element={<ProtectedRoute role="customer"><BookingCheckout /></ProtectedRoute>} />
    <Route path="/payment/success" element={<ProtectedRoute role="customer"><PaymentReturn kind="success" /></ProtectedRoute>} />
    <Route path="/payment/cancel" element={<ProtectedRoute role="customer"><PaymentReturn kind="cancel" /></ProtectedRoute>} />
    <Route path="/login" element={<LoginPage />} />
    <Route path="/register" element={<RegisterPage />} />
    <Route path="/verify-email" element={<VerifyEmailPage />} />
    <Route path="/resend-verification" element={<ResendVerificationPage />} />
    <Route path="/forgot-password" element={<ForgotPasswordPage />} />
    <Route path="/reset-password" element={<ResetPasswordPage />} />

    <Route path="/customer" element={<ProtectedRoute role="customer"><CustomerShell /></ProtectedRoute>}>
      <Route index element={<CustomerDashboard />} />
      <Route path="catalog" element={<CustomerCatalog />} />
      <Route path="units/:id" element={<CustomerUnitDetail />} />
      <Route path="bookings" element={<CustomerBookingsLive />} />
      <Route path="bookings/:id" element={<CustomerBookingDetailLive />} />
      <Route path="booking-details" element={<CustomerBookingDetailLive />} />
      <Route path="refunds" element={<CustomerRefunds />} />
      <Route path="reviews" element={<CustomerReviews />} />
      <Route path="profile" element={<CustomerProfile />} />
      <Route path="settings" element={<CustomerSettings />} />
    </Route>

    <Route path="/owner" element={<ProtectedRoute role="owner"><OwnerShell /></ProtectedRoute>}>
      <Route index element={<OwnerDashboardLive />} />
      <Route path="business" element={<OwnerBusinessLive />} />
      <Route path="units" element={<OwnerUnitsLive />} />
      <Route path="units/new" element={<OwnerUnitEditorLive />} />
      <Route path="units/:id/edit" element={<OwnerUnitEditorLive />} />
      <Route path="availability" element={<OwnerAvailability />} />
      <Route path="bookings" element={<OwnerBookingsLive />} />
      <Route path="bookings/:id" element={<OwnerBookingDetailLive />} />
      <Route path="revenue" element={<OwnerRevenue />} />
      <Route path="reviews" element={<OwnerReviews />} />
      <Route path="profile" element={<OwnerProfile />} />
      <Route path="settings" element={<OwnerSettings />} />
    </Route>

    <Route path="/admin" element={<ProtectedRoute role="admin"><AdminShell /></ProtectedRoute>}>
      <Route index element={<AdminDashboard />} />
      <Route path="users" element={<AdminUsers />} />
      <Route path="owners" element={<AdminUsers ownersOnly />} />
      <Route path="businesses" element={<AdminBusinesses />} />
      <Route path="bookings" element={<AdminBookings />} />
      <Route path="payments" element={<AdminPayments />} />
      <Route path="refunds" element={<AdminRefunds />} />
      <Route path="reviews" element={<AdminReviews />} />
      <Route path="statistics" element={<AdminStatistics />} />
      <Route path="settings" element={<AdminSettings />} />
    </Route>
    <Route path="*" element={<NotFound />} />
  </Routes></AuthProvider></BrowserRouter>;
}

