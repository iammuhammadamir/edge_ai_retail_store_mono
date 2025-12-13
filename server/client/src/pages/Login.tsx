import { useState, useEffect, useRef } from "react";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/contexts/AuthContext";
import { apiRequest, setAuthToken } from "@/lib/queryClient";

declare global {
  interface Window {
    grecaptcha: {
      render: (container: string | HTMLElement, parameters: {
        sitekey: string;
        callback?: (token: string) => void;
        'expired-callback'?: () => void;
      }) => number;
      reset: (widgetId?: number) => void;
      getResponse: (widgetId?: number) => string;
    };
  }
}

export default function Login() {
  const { login } = useAuth();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [failedAttempts, setFailedAttempts] = useState(0);
  const [showCaptcha, setShowCaptcha] = useState(false);
  const [captchaToken, setCaptchaToken] = useState<string>("");
  const captchaRef = useRef<HTMLDivElement>(null);
  const captchaWidgetId = useRef<number | null>(null);
  const { toast } = useToast();

  // Load failed attempts from sessionStorage on mount
  useEffect(() => {
    const savedAttempts = sessionStorage.getItem("loginFailedAttempts");
    if (savedAttempts) {
      const attempts = parseInt(savedAttempts, 10);
      setFailedAttempts(attempts);
      if (attempts >= 3) {
        setShowCaptcha(true);
      }
    }
  }, []);

  // Load reCAPTCHA script and render widget when captcha is shown
  useEffect(() => {
    if (!showCaptcha) return;

    // Check if script is already loaded and ready
    if (window.grecaptcha && typeof window.grecaptcha.render === 'function') {
      // Script is loaded, render immediately
      renderCaptcha();
      return;
    }

    // Check if script tag already exists
    const existingScript = document.querySelector('script[src*="recaptcha/api.js"]');
    if (existingScript) {
      // Script is loading, wait for it
      const checkReady = setInterval(() => {
        if (window.grecaptcha && typeof window.grecaptcha.render === 'function') {
          clearInterval(checkReady);
          renderCaptcha();
        }
      }, 100);

      return () => clearInterval(checkReady);
    }

    // Load reCAPTCHA script
    const script = document.createElement("script");
    script.src = "https://www.google.com/recaptcha/api.js?onload=onRecaptchaLoad&render=explicit";
    script.async = true;
    script.defer = true;
    
    // Define global callback for when script loads
    (window as any).onRecaptchaLoad = () => {
      console.log("reCAPTCHA script loaded");
      renderCaptcha();
    };
    
    script.onerror = () => {
      console.error("Failed to load reCAPTCHA script");
      toast({
        title: "CAPTCHA Error",
        description: "Failed to load CAPTCHA. Please check your internet connection.",
        variant: "destructive",
      });
    };
    
    document.head.appendChild(script);

    return () => {
      // Cleanup
      delete (window as any).onRecaptchaLoad;
    };
  }, [showCaptcha]);

  const renderCaptcha = () => {
    if (captchaRef.current && window.grecaptcha && captchaWidgetId.current === null) {
      const siteKey = import.meta.env.VITE_RECAPTCHA_SITE_KEY;
      
      if (!siteKey) {
        console.error("RECAPTCHA_SITE_KEY not configured");
        toast({
          title: "Configuration Error",
          description: "reCAPTCHA is not properly configured. Please contact support.",
          variant: "destructive",
        });
        return;
      }
      
      try {
        captchaWidgetId.current = window.grecaptcha.render(captchaRef.current, {
          sitekey: siteKey,
          callback: (token: string) => {
            setCaptchaToken(token);
          },
          'expired-callback': () => {
            setCaptchaToken("");
          },
        });
      } catch (error) {
        console.error("Error rendering reCAPTCHA:", error);
        toast({
          title: "CAPTCHA Error",
          description: "Failed to load CAPTCHA. Please refresh the page.",
          variant: "destructive",
        });
      }
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    // Check if CAPTCHA is required but not solved
    if (showCaptcha && !captchaToken) {
      toast({
        title: "CAPTCHA Required",
        description: "Please complete the CAPTCHA verification",
        variant: "destructive",
      });
      return;
    }

    setLoading(true);

    try {
      const response = await apiRequest("/api/auth/login", {
        method: "POST",
        body: JSON.stringify({ 
          username, 
          password,
          captchaToken: showCaptcha ? captchaToken : undefined,
        }),
      });

      // Store JWT token
      if (response.token) {
        setAuthToken(response.token);
      }

      // Successful login - reset failed attempts
      sessionStorage.removeItem("loginFailedAttempts");
      setFailedAttempts(0);
      setShowCaptcha(false);

      // Use user data from response
      const user = response.user || response;
      login(user);
      toast({
        title: "Login successful",
        description: `Welcome back, ${user.username}!`,
      });
    } catch (error: any) {
      // Check if server requires CAPTCHA (authoritative decision from backend)
      const requiresCaptcha = error?.requiresCaptcha === true;
      
      if (requiresCaptcha && !showCaptcha) {
        // Server says CAPTCHA is required, update UI immediately
        setShowCaptcha(true);
        setFailedAttempts(3); // Set to threshold to show proper UI state
        sessionStorage.setItem("loginFailedAttempts", "3");
      } else {
        // Increment failed attempts for local tracking
        const newAttempts = failedAttempts + 1;
        setFailedAttempts(newAttempts);
        sessionStorage.setItem("loginFailedAttempts", newAttempts.toString());

        // Show CAPTCHA after 3 failed attempts (frontend fallback)
        if (newAttempts >= 3) {
          setShowCaptcha(true);
        }
      }

      // Reset CAPTCHA if it was shown
      if (showCaptcha && window.grecaptcha && captchaWidgetId.current !== null) {
        window.grecaptcha.reset(captchaWidgetId.current);
        setCaptchaToken("");
      }

      toast({
        title: "Login failed",
        description:
          error instanceof Error ? error.message : "Invalid credentials",
        variant: "destructive",
      });
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-background p-4">
      <Card className="w-full max-w-md">
        <CardHeader>
          <CardTitle className="text-2xl" data-testid="text-login-title">
            Smoothflow AI
          </CardTitle>
          <CardDescription data-testid="text-login-description">
            Sign in to access the security management system
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="username">Username</Label>
              <Input
                id="username"
                data-testid="input-username"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                required
                autoComplete="username"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="password">Password</Label>
              <Input
                id="password"
                data-testid="input-password"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                autoComplete="current-password"
              />
            </div>

            {/* Show warning message after failed attempts */}
            {failedAttempts > 0 && failedAttempts < 3 && (
              <div className="text-sm text-destructive" data-testid="text-failed-attempts">
                Login failed. {3 - failedAttempts} attempt{3 - failedAttempts !== 1 ? 's' : ''} remaining before CAPTCHA is required.
              </div>
            )}

            {/* reCAPTCHA widget */}
            {showCaptcha && (
              <div className="flex justify-center py-2">
                <div ref={captchaRef} data-testid="recaptcha-widget"></div>
              </div>
            )}

            <Button
              type="submit"
              className="w-full"
              disabled={loading}
              data-testid="button-login"
            >
              {loading ? "Signing in..." : "Sign In"}
            </Button>
          </form>
          {/* Test Account Information */}
          {/* <div className="mt-6 p-3 bg-muted rounded-md border border-border">
            <p className="text-sm font-medium text-foreground mb-2">Test Accounts:</p>
            <div className="space-y-1 text-sm text-muted-foreground">
              <p>• <strong>Manager:</strong> manager / manager123</p>
              <p>• <strong>Reviewer:</strong> reviewer / reviewer123</p>
            </div>
          </div>*/}
        </CardContent>
      </Card>
    </div>
  );
}
