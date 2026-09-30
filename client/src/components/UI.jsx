import { ArrowRight, AlertCircle, ChevronRight, CircleHelp, Inbox, LoaderCircle, LockKeyhole, Menu, X } from "lucide-react";
import { Link, NavLink, Navigate, useLocation } from "react-router-dom";
import { useState } from "react";
import { useAuth } from "../auth/AuthProvider";
import { roleHome } from "../auth/navigation";

export { roleHome };

export function Brand({ compact = false, light = false }) {
  return (
    <Link to="/" className={`brand ${light ? "brand-light" : ""}`} aria-label="FAARO home">
      <span className="brand-mark">F</span>
      {!compact && <span>FAARO</span>}
    </Link>
  );
}

export function Button({ children, variant = "primary", className = "", loading = false, disabled = false, type = "button", ...props }) {
  return (
    <button className={`btn btn-${variant} ${className}`} type={type} disabled={loading || disabled} aria-busy={loading} {...props}>
      {loading && <LoaderCircle size={17} className="animate-spin" />} {children}
    </button>
  );
}

export function Card({ children, className = "", ...props }) {
  return <div className={`card ${className}`} {...props}>{children}</div>;
}

export function Badge({ children, tone = "blue" }) {
  return <span className={`badge badge-${tone}`}>{children}</span>;
}

export function Input({ label, hint, error, required, className = "", ...props }) {
  return (
    <label className={`field ${className}`}>
      {label && <span className="field-label">{label}{required && <b className="text-[#a63d05]"> *</b>}</span>}
      <input className={`input ${error ? "input-error" : ""}`} required={required} {...props} />
      {hint && <small className="field-hint">{hint}</small>}
      {error && <small className="field-error">{error}</small>}
    </label>
  );
}

export function Select({ label, children, className = "", ...props }) {
  return <label className={`field ${className}`}><span className="field-label">{label}</span><select className="input" {...props}>{children}</select></label>;
}

export function LoadingState({ label = "Loading information…" }) {
  return <div className="state-panel" role="status"><LoaderCircle className="animate-spin text-[#a83c03]" size={27} /><h3>{label}</h3></div>;
}

export function EmptyState({ title = "Nothing here yet", description, action }) {
  return <div className="state-panel"><div className="state-icon"><Inbox size={27} /></div><h3>{title}</h3>{description && <p>{description}</p>}{action}</div>;
}

export function UnavailableState({ title = "This feature is currently unavailable", description, compact = false, action }) {
  return <div className={`state-panel unavailable ${compact ? "state-compact" : ""}`}><div className="state-icon"><LockKeyhole size={25} /></div><h3>{title}</h3><p>{description || "The current backend does not provide this information yet."}</p>{action}</div>;
}

export function ErrorState({ error, onRetry }) {
  return <div className="state-panel state-error"><div className="state-icon"><AlertCircle size={26} /></div><h3>We couldn’t load this section</h3><p>{error}</p>{onRetry && <Button variant="secondary" onClick={onRetry}>Try again <ArrowRight size={16} /></Button>}</div>;
}

export function Modal({ title, children, onClose, footer }) {
  return <div className="modal-backdrop" onMouseDown={onClose} role="presentation"><div className="modal-card" role="dialog" aria-modal="true" aria-label={title} onMouseDown={(event) => event.stopPropagation()}><div className="modal-head"><h2>{title}</h2><button className="icon-button" onClick={onClose} aria-label="Close"><X size={19} /></button></div><div className="modal-content">{children}</div>{footer && <div className="modal-footer">{footer}</div>}</div></div>;
}

export function PageHeader({ eyebrow, title, description, action }) {
  return <div className="page-heading"><div><span className="eyebrow">{eyebrow}</span><h1>{title}</h1>{description && <p>{description}</p>}</div>{action}</div>;
}

export function SiteHeader() {
  const { user } = useAuth();
  const location = useLocation();
  const category = new URLSearchParams(location.search).get("category") || "all";
  const nav = [{ category: "hotel", label: "Hotels" }, { category: "car_rental", label: "Cars" }, { category: "apartment", label: "Apartments" }, { category: "all", label: "Explore" }];
  const [open, setOpen] = useState(false);
  return <header className="site-header"><div className="site-header-inner"><Brand />
    <nav className={open ? "site-nav nav-open" : "site-nav"} aria-label="Main navigation">{nav.map((item) => {
      const active = location.pathname === "/search" && category === item.category;
      return <Link key={item.category} to={item.category === "all" ? "/search" : `/search?category=${item.category}`} onClick={() => setOpen(false)} className={active ? "active" : ""} aria-current={active ? "page" : undefined}>{item.label}</Link>;
    })}</nav>
    <div className="site-actions"><Link className="text-link max-sm:hidden" to={user ? roleHome(user.role) : "/register"}>List your property</Link><span className="header-divider" /><button className="icon-button max-sm:hidden" aria-label="Help" title="Help"><CircleHelp size={18} /></button>{user ? <Link className="avatar-link" to={roleHome(user.role)} title={user.fullName}>{user.fullName?.charAt(0)?.toUpperCase() || "F"}</Link> : <Link className="btn btn-primary btn-small" to="/login">Log in <ArrowRight size={15} /></Link>}<button className="icon-button mobile-menu" aria-label="Open menu" onClick={() => setOpen(!open)}>{open ? <X size={20} /> : <Menu size={20} />}</button></div></div></header>;
}

export function SiteFooter() {
  return <footer className="site-footer"><div className="footer-inner"><Brand /><span>© {new Date().getFullYear()} FAARO. All rights reserved.</span><div className="footer-links"><span>Privacy Policy</span><span>Terms of Service</span><span>Security &amp; Escrow</span><span>Destinations</span><span>Host Guarantee</span></div></div></footer>;
}

export function DashboardLayout({ area, navItems, children, topAction }) {
  const { user, logout } = useAuth();
  const [open, setOpen] = useState(false);
  const [logoutError, setLogoutError] = useState("");
  return <div className={`dashboard-shell dashboard-${area}`}><aside className={`dashboard-sidebar ${open ? "sidebar-open" : ""}`}><div className="sidebar-brand"><Brand /><small>{area === "admin" ? "CONSOLE" : area === "owner" ? "PARTNER HUB" : "CUSTOMER SPACE"}</small></div>{topAction && <div className="sidebar-action">{topAction}</div>}<nav className="sidebar-nav">{navItems.map(({ to, label, icon: Icon, end }) => <NavLink key={to} to={to} end={end} onClick={() => setOpen(false)} className={({ isActive }) => `sidebar-link ${isActive ? "sidebar-active" : ""}`}><Icon size={17} /><span>{label}</span><ChevronRight className="nav-chevron" size={14} /></NavLink>)}</nav><div className="sidebar-bottom"><div className="sidebar-user"><span className="user-initial">{user?.fullName?.charAt(0)?.toUpperCase() || "F"}</span><span><strong>{user?.fullName}</strong><small>{user?.role}</small></span></div><button className="sidebar-link logout-link" onClick={async () => { try { await logout(); window.location.assign("/login"); } catch (error) { setLogoutError(error.message); } }}>Log out <ArrowRight size={15} /></button>{logoutError && <small className="field-error">{logoutError}</small>}</div></aside><div className="dashboard-main"><header className="dashboard-topbar"><button className="icon-button mobile-menu" onClick={() => setOpen(!open)} aria-label="Toggle sidebar"><Menu size={20} /></button><span>{area === "admin" ? "Platform governance" : area === "owner" ? "Partner operations" : "Your FAARO account"}</span><div className="topbar-right"><Badge tone="green">● Secure session</Badge><Link className="avatar-link" to={`/${area}/profile`}>{user?.fullName?.charAt(0)?.toUpperCase() || "F"}</Link></div></header><main className="dashboard-content">{children}</main><SiteFooter /></div>{open && <button className="sidebar-scrim" onClick={() => setOpen(false)} aria-label="Close sidebar" />}</div>;
}

export function ProtectedRoute({ role, children }) {
  const { user, status } = useAuth();
  const location = useLocation();
  if (status === "loading") return <div className="page-loader"><LoadingState label="Restoring your secure session…" /></div>;
  if (!user) return <Navigate to="/login" replace state={{ from: location.pathname + location.search }} />;
  if (user.role !== role) return <div className="page-loader"><Card className="p-8 text-center"><h2 className="text-2xl font-bold">Access restricted</h2><p className="mt-2 text-slate-600">This area is for {role} accounts.</p><Link to={roleHome(user.role)} className="btn btn-primary mt-5">Go to your workspace <ArrowRight size={16} /></Link></Card></div>;
  return children;
}
