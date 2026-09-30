import { useEffect, useRef, useState } from "react";
import { ArrowLeft, ArrowRight, Check, Eye, EyeOff, KeyRound, LockKeyhole, Mail, ShieldCheck, UserRound } from "lucide-react";
import { Link, Navigate, useLocation, useNavigate, useSearchParams } from "react-router-dom";
import { authApi } from "../api/auth";
import { errorMessage } from "../api/client";
import { useAuth } from "../auth/AuthProvider";
import { loginDestination } from "../auth/navigation";
import { Badge, Brand, Button, Card, Input, SiteFooter } from "../components/UI";

function AuthLayout({ kind, title, subtitle, children }) {
  return <div className="auth-page"><header className="auth-top"><Brand /><div className="auth-top-action">{kind === "register" ? "Already have an account?" : "New to FAARO?"}<Link to={kind === "register" ? "/login" : "/register"} className="btn btn-secondary btn-small">{kind === "register" ? "Log in" : "Sign up"} <ArrowRight size={16} /></Link></div></header><div className="auth-grid"><aside className="auth-aside"><div className="auth-promo"><Badge tone="white"><ShieldCheck size={13} /> FAARO MEMBER PORTAL</Badge><h2>{kind === "register" ? "Join the unified marketplace for stays & mobility." : "Welcome back to your FAARO journey."}</h2><p>{kind === "register" ? "One secure account for travel and partner access." : "Sign in to manage the parts of your journey supported by your account."}</p><div className="auth-promo-list"><div><ShieldCheck size={19} /><span>Secure account verification</span></div><div><KeyRound size={19} /><span>One sign-in for your role</span></div><div><LockKeyhole size={19} /><span>Protected access to your workspace</span></div></div><span className="auth-watermark">FAARO</span></div><Card className="auth-aside-note"><ShieldCheck size={23} className="text-[#a83c03]" /><div><strong>Real account access</strong><p>Your information is loaded from the FAARO API. Unavailable marketplace features are clearly marked.</p></div></Card></aside><Card className="auth-form-card"><div className="auth-form-heading"><Badge tone="blue">MEMBER PORTAL</Badge><h1>{title}</h1><p>{subtitle}</p></div>{children}</Card></div><SiteFooter /></div>;
}

function SocialButtons() {
  return <><div className="social-row"><button type="button" className="btn btn-secondary social-button" disabled title="Google sign-in is not supported by the current backend"><span className="google-g">G</span> Google <small>Unavailable</small></button><button type="button" className="btn btn-secondary social-button" disabled title="Apple sign-in is not supported by the current backend"><span className="text-xl">●</span> Apple ID <small>Unavailable</small></button></div><div className="form-divider"><span>or continue with email</span></div></>;
}

export function LoginPage() {
  const { user, login } = useAuth();
  const location = useLocation();
  const navigate = useNavigate();
  const [form, setForm] = useState({ email: "", password: "" });
  const [showPassword, setShowPassword] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  if (user) return <Navigate to={loginDestination(user.role, location.state?.from)} replace />;

  const submit = async (event) => {
    event.preventDefault();
    setError("");
    setBusy(true);
    try {
      const account = await login(form);
      const destination = loginDestination(account.role, location.state?.from);
      navigate(destination, { replace: true });
    } catch (requestError) {
      setError(errorMessage(requestError));
    } finally {
      setBusy(false);
    }
  };

  return <AuthLayout kind="login" title="Welcome back to FAARO" subtitle="Log in to manage your bookings, account, or partner workspace."><SocialButtons /><form onSubmit={submit} className="auth-form"><Input label="Email address" type="email" placeholder="name@example.com" value={form.email} onChange={(event) => setForm({ ...form, email: event.target.value })} required /><div className="password-label"><span>Password</span><Link to="/forgot-password">Forgot password?</Link></div><div className="password-wrap"><input className="input" type={showPassword ? "text" : "password"} value={form.password} onChange={(event) => setForm({ ...form, password: event.target.value })} placeholder="Enter your password" required /><button type="button" aria-label={showPassword ? "Hide password" : "Show password"} onClick={() => setShowPassword(!showPassword)}>{showPassword ? <EyeOff size={18} /> : <Eye size={18} />}</button></div><label className="checkbox-line opacity-70"><input type="checkbox" disabled /><span>Remember this device for 30 days <small>(not supported by the API)</small></span></label>{error && <div className="form-alert error" role="alert">{error}{error.toLowerCase().includes("verify") && <Link to={`/resend-verification?email=${encodeURIComponent(form.email)}`}>Request a new link</Link>}</div>}<Button type="submit" variant="dark" loading={busy} className="w-full justify-center">Log In to FAARO <ArrowRight size={18} /></Button></form><div className="auth-card-footer"><div className="info-strip"><KeyRound size={18} /><span>One sign-in routes you to the workspace assigned to your real account role.</span></div><p>Don’t have an account? <Link to="/register">Sign Up</Link></p></div></AuthLayout>;
}

export function RegisterPage() {
  const [form, setForm] = useState({ fullName: "", email: "", phone: "", password: "", confirm: "" });
  const [terms, setTerms] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const passwordValid = form.password.length >= 12 && form.password.length <= 24;

  const submit = async (event) => {
    event.preventDefault();
    setError("");
    setSuccess("");
    if (form.password !== form.confirm) return setError("Passwords do not match.");
    if (!passwordValid) return setError("Password must be between 12 and 24 characters.");
    if (!terms) return setError("Please accept the terms before creating an account.");
    setBusy(true);
    try {
      const result = await authApi.register({ fullName: form.fullName, email: form.email, phone: form.phone, password: form.password });
      setSuccess(result.message || "Account created successfully.");
    } catch (requestError) {
      setError(errorMessage(requestError));
    } finally {
      setBusy(false);
    }
  };

  return <AuthLayout kind="register" title="Create your FAARO Account" subtitle="One account for your FAARO travel and partner access."><div className="purpose-label">SELECT ACCOUNT PURPOSE</div><div className="purpose-grid"><div className="purpose-choice selected"><UserRound size={21} /><div><strong>Traveler &amp; Guest</strong><span>Register a customer account.</span></div><span className="radio-dot" /></div><div className="purpose-choice disabled" title="Owner registration is not available through the public API"><KeyRound size={21} /><div><strong>Host &amp; Fleet Partner</strong><span>Admin setup is required.</span></div><span className="radio-empty" /></div></div><SocialButtons /><form onSubmit={submit} className="auth-form"><Input label="Full Legal Name" placeholder="Your full name" value={form.fullName} onChange={(event) => setForm({ ...form, fullName: event.target.value })} required hint="Use the name associated with your account." /><Input label="Email Address" type="email" placeholder="name@example.com" value={form.email} onChange={(event) => setForm({ ...form, email: event.target.value })} required /><Input label="Mobile Phone Number" type="tel" placeholder="Your phone number" value={form.phone} onChange={(event) => setForm({ ...form, phone: event.target.value })} required /><div className="two-fields"><div><span className="field-label">Password *</span><div className="password-wrap"><input className="input" type={showPassword ? "text" : "password"} value={form.password} onChange={(event) => setForm({ ...form, password: event.target.value })} required placeholder="12–24 characters" /><button type="button" aria-label="Toggle password visibility" onClick={() => setShowPassword(!showPassword)}>{showPassword ? <EyeOff size={18} /> : <Eye size={18} />}</button></div></div><Input label="Confirm Password" type={showPassword ? "text" : "password"} value={form.confirm} onChange={(event) => setForm({ ...form, confirm: event.target.value })} required placeholder="Repeat password" /></div><div className="strength-box"><div><span>Password requirement</span><strong className={passwordValid ? "text-emerald-700" : "text-[#a83c03]"}>{passwordValid ? "Met" : "12–24 characters"}</strong></div><div className="strength-track"><span style={{ width: `${Math.min(100, form.password.length / 12 * 100)}%` }} /></div><small>The current backend accepts passwords between 12 and 24 characters.</small></div><label className="checkbox-line"><input type="checkbox" checked={terms} onChange={(event) => setTerms(event.target.checked)} /><span>I agree to the <u>FAARO Terms of Service</u> and <u>Privacy Policy</u>.</span></label><label className="checkbox-line"><input type="checkbox" /><span>Send me travel and partner updates. (Optional)</span></label>{error && <div className="form-alert error" role="alert">{error}</div>}{success && <div className="form-alert success" role="status"><Check size={18} />{success}<Link to="/login">Go to login</Link></div>}<Button type="submit" loading={busy} className="w-full justify-center">Create Account <ArrowRight size={18} /></Button></form><div className="auth-card-footer"><p>Already a member? <Link to="/login">Log in here</Link></p></div></AuthLayout>;
}

function SimpleAuthPage({ title, description, children }) {
  return <div className="simple-auth"><header className="auth-top"><Brand /><Link to="/login" className="text-link flex items-center gap-2"><ArrowLeft size={16} /> Back to login</Link></header><Card className="simple-auth-card"><div className="simple-auth-icon"><Mail size={27} /></div><h1>{title}</h1><p>{description}</p>{children}</Card><SiteFooter /></div>;
}

export function VerifyEmailPage() {
  const [params, setParams] = useSearchParams();
  const [token, setToken] = useState(params.get("token") || "");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const autoStarted = useRef(false);
  const verify = async (value) => {
    setBusy(true);
    setError("");
    try {
      const result = await authApi.verifyEmail(value);
      setMessage(result.message || "Email verified successfully.");
      setToken("");
      setParams({}, { replace: true });
    } catch (requestError) {
      setError(errorMessage(requestError));
    } finally {
      setBusy(false);
    }
  };
  useEffect(() => {
    const linkToken = params.get("token");
    if (linkToken && !autoStarted.current) {
      autoStarted.current = true;
      verify(linkToken);
    }
  }, []);
  const submit = (event) => { event.preventDefault(); verify(token); };
  return <SimpleAuthPage title="Verify your email" description="Confirm your email address to activate your FAARO account."><form onSubmit={submit} className="auth-form">{busy && <div className="form-alert info" role="status">Verifying your email link…</div>}<Input label="Verification token" value={token} onChange={(event) => setToken(event.target.value)} required />{error && <div className="form-alert error" role="alert">{error}</div>}{message && <div className="form-alert success" role="status">{message} <Link to="/login">Log in</Link></div>}<Button type="submit" loading={busy} disabled={!!message}>Verify email <ArrowRight size={17} /></Button></form><Link to="/resend-verification" className="text-link mt-5 inline-block">Request another link</Link></SimpleAuthPage>;
}

export function ResendVerificationPage() {
  const [params] = useSearchParams();
  const [email, setEmail] = useState(params.get("email") || "");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const submit = async (event) => { event.preventDefault(); setBusy(true); setError(""); try { const result = await authApi.resendVerification(email); setMessage(result.message); } catch (requestError) { setError(errorMessage(requestError)); } finally { setBusy(false); } };
  return <SimpleAuthPage title="Request a verification link" description="Enter the email used for your account. You can request a new link after the one-minute cooldown."><form onSubmit={submit} className="auth-form"><Input label="Email address" type="email" value={email} onChange={(event) => setEmail(event.target.value)} required />{error && <div className="form-alert error">{error}</div>}{message && <div className="form-alert success">{message}</div>}<Button type="submit" loading={busy}>Send link <ArrowRight size={17} /></Button></form></SimpleAuthPage>;
}

export function ForgotPasswordPage() {
  const [email, setEmail] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const submit = async (event) => { event.preventDefault(); setBusy(true); setError(""); try { const result = await authApi.forgotPassword({ email }); setMessage(result.message); } catch (requestError) { setError(errorMessage(requestError)); } finally { setBusy(false); } };
  return <SimpleAuthPage title="Reset your password" description="We’ll send password reset instructions if an account matches this email."><form onSubmit={submit} className="auth-form"><Input label="Email address" type="email" value={email} onChange={(event) => setEmail(event.target.value)} required />{error && <div className="form-alert error">{error}</div>}{message && <div className="form-alert success">{message}</div>}<Button type="submit" loading={busy}>Send instructions <ArrowRight size={17} /></Button></form></SimpleAuthPage>;
}

export function ResetPasswordPage() {
  const [params] = useSearchParams();
  const [form, setForm] = useState({ token: params.get("token") || "", password: "", confirm: "" });
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const submit = async (event) => { event.preventDefault(); setError(""); if (form.password !== form.confirm) return setError("Passwords do not match."); setBusy(true); try { const result = await authApi.resetPassword({ token: form.token, password: form.password }); setMessage(result.message); } catch (requestError) { setError(errorMessage(requestError)); } finally { setBusy(false); } };
  return <SimpleAuthPage title="Choose a new password" description="Your new password must be between 12 and 24 characters."><form onSubmit={submit} className="auth-form"><Input label="Reset token" value={form.token} onChange={(event) => setForm({ ...form, token: event.target.value })} required /><Input label="New password" type="password" minLength={12} maxLength={24} value={form.password} onChange={(event) => setForm({ ...form, password: event.target.value })} required /><Input label="Confirm password" type="password" value={form.confirm} onChange={(event) => setForm({ ...form, confirm: event.target.value })} required />{error && <div className="form-alert error">{error}</div>}{message && <div className="form-alert success">{message} <Link to="/login">Log in</Link></div>}<Button type="submit" loading={busy}>Reset password <ArrowRight size={17} /></Button></form></SimpleAuthPage>;
}

