import { createContext, useContext, useState, useEffect, ReactNode } from "react";
import { clearAuthToken } from "@/lib/queryClient";

interface User {
  username: string;
  role: "manager" | "reviewer" | "owner";
  locationId?: number | null;
}

interface AuthContextType {
  user: User | null;
  login: (user: User) => void;
  logout: () => void;
  isLoading: boolean;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    // Verify auth on mount (supports both JWT and session)
    async function verifyAuth() {
      try {
        // Get token from localStorage for JWT auth
        const token = localStorage.getItem('auth_token');
        
        const response = await fetch("/api/auth/me", {
          credentials: "include",
          headers: token ? { "Authorization": `Bearer ${token}` } : {},
        });
        
        if (response.ok) {
          const userData = await response.json();
          setUser(userData);
        } else {
          // Token invalid, clear it
          clearAuthToken();
        }
      } catch (error) {
        // No valid auth
        console.error("Auth verification failed:", error);
        clearAuthToken();
      } finally {
        setIsLoading(false);
      }
    }

    verifyAuth();
  }, []);

  const login = (userData: User) => {
    setUser(userData);
  };

  const logout = async () => {
    try {
      const token = localStorage.getItem('auth_token');
      await fetch("/api/auth/logout", {
        method: "POST",
        credentials: "include",
        headers: token ? { "Authorization": `Bearer ${token}` } : {},
      });
    } catch (error) {
      console.error("Logout failed:", error);
    } finally {
      // Clear JWT token
      clearAuthToken();
      setUser(null);
    }
  };

  return (
    <AuthContext.Provider value={{ user, login, logout, isLoading }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (context === undefined) {
    throw new Error("useAuth must be used within an AuthProvider");
  }
  return context;
}
