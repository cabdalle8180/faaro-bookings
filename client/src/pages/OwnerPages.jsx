import { useState } from "react";
import { ArrowRight, BarChart3, BedDouble, Building2, CalendarDays, CarFront, CheckCircle2, CirclePlus, CreditCard, LayoutDashboard, List, MapPin, Plus, Settings, ShieldCheck, Star, UserRound, Users } from "lucide-react";
import { Link, Outlet } from "react-router-dom";
import { useAuth } from "../auth/AuthProvider";
import { Badge, Button, Card, DashboardLayout, Input, PageHeader, Select, UnavailableState } from "../components/UI";

const navItems = [
  { to: "/owner", label: "Dashboard", icon: LayoutDashboard, end: true },
  { to: "/owner/business", label: "Business Profile", icon: Building2 },
  { to: "/owner/units", label: "Units & Inventory", icon: BedDouble },
  { to: "/owner/availability", label: "Availability", icon: CalendarDays },
  { to: "/owner/bookings", label: "Bookings & Escrow", icon: CreditCard },
  { to: "/owner/revenue", label: "Payments & Revenue", icon: BarChart3 },
  { to: "/owner/reviews", label: "Reviews", icon: Star },
  { to: "/owner/profile", label: "Profile", icon: UserRound },
  { to: "/owner/settings", label: "Settings", icon: Settings },
];

export function OwnerShell() {
  return <DashboardLayout area="owner" navItems={navItems} topAction={<Link to="/owner/units/new" className="btn btn-primary w-full justify-center"><CirclePlus size={16} /> New Unit</Link>}><Outlet /></DashboardLayout>;
}

function OwnerFeature({ eyebrow, title, description, columns, action }) {
  return <><PageHeader eyebrow={eyebrow} title={title} description={description} action={action} /><Card className="p-6"><div className="tabs-line">{columns.map((column, index) => <span key={column} className={index === 0 ? "active" : ""}>{column}</span>)}</div><UnavailableState title={`${title} are not available yet`} description="The current backend does not expose this owner functionality. No records or totals are simulated." /></Card></>;
}

export function OwnerAvailability() { return <OwnerFeature eyebrow="PARTNER HUB" title="Availability" description="Manage inventory dates, rates, and open units." columns={["Calendar", "Rates", "Inventory Claims"]} />; }
export function OwnerBookings() { return <OwnerFeature eyebrow="PARTNER HUB" title="Bookings & Escrow" description="Track upcoming check-ins, handovers, and reservations." columns={["Upcoming", "In progress", "Completed", "Cancelled"]} />; }
export function OwnerRevenue() { return <OwnerFeature eyebrow="PARTNER HUB" title="Payments & Revenue" description="Review payouts, revenue, and payment activity." columns={["Overview", "Payouts", "Transactions"]} />; }
export function OwnerReviews() { return <OwnerFeature eyebrow="PARTNER HUB" title="Reviews" description="See customer feedback linked to your business." columns={["All Reviews", "New", "Responded"]} />; }

export function OwnerProfile() {
  const { user } = useAuth();
  return <><PageHeader eyebrow="PARTNER HUB" title="Profile" description="Account details from your latest real login." /><Card className="p-6 max-w-2xl"><div className="profile-fields"><div><span>Full name</span><strong>{user?.fullName || "—"}</strong></div><div><span>Email</span><strong>{user?.email || "—"}</strong></div><div><span>Phone</span><strong>{user?.phone || "—"}</strong></div><div><span>Role</span><Badge tone="green">{user?.role}</Badge></div></div><UnavailableState compact title="Editing unavailable" description="The backend does not provide a profile update endpoint." /></Card></>;
}

export function OwnerSettings() { return <OwnerFeature eyebrow="PARTNER HUB" title="Settings" description="Configure partner notifications and operational preferences." columns={["Account", "Notifications", "Business"]} />; }


