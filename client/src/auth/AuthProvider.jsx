import { createContext, useCallback, useContext, useEffect, useState } from "react";
import { authApi } from "../api/auth";
import { setAccessToken, setUnauthorizedHandler, setSessionHandler } from "../api/client";

const STORAGE_KEY = "faaro.authenticatedUser";
const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [status, setStatus] = useState("loading");

  const clearSession = useCallback(() => {
    setAccessToken(null);
    try { localStorage.removeItem(STORAGE_KEY); } catch { /* Private browsing may disable storage. */ }
    setUser(null);
    setStatus("guest");
  }, []);

  const acceptUser = useCallback((account) => {
    if (!account?._id || !["customer", "owner", "admin"].includes(account.role)) throw new Error("Invalid account response");
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(account)); } catch { /* The HTTP-only cookie restores the session. */ }
    setUser(account); setStatus("authenticated");
  }, []);

  useEffect(() => {
    setUnauthorizedHandler(clearSession);
    setSessionHandler(acceptUser);
    let active = true;
    authApi.refresh()
      .then(({ accessToken, data }) => {
        if (!active) return;
        if (!accessToken || !data?._id) {
          clearSession();
          return;
        }
        setAccessToken(accessToken);
        acceptUser(data);
      })
      .catch(() => active && clearSession());
    return () => {
      active = false;
      setUnauthorizedHandler(null);
      setSessionHandler(null);
    };
  }, [clearSession, acceptUser]);

  const login = async (credentials) => {
    const result = await authApi.login(credentials);
    if (!result?.accessToken || !result?.data?._id || !result?.data?.role) {
      throw new Error("The login response did not include the account details needed to continue.");
    }
    const authenticatedUser = result.data;
    setAccessToken(result.accessToken);
    acceptUser(authenticatedUser);
    return authenticatedUser;
  };

  const logout = async () => {
    await authApi.logout();
    clearSession();
  };

  return (
    <AuthContext.Provider value={{ user, status, login, logout, clearSession }}>
      {children}
    </AuthContext.Provider>
  );
}

export const useAuth = () => {
  const context = useContext(AuthContext);
  if (!context) throw new Error("useAuth must be used inside AuthProvider");
  return context;
};
