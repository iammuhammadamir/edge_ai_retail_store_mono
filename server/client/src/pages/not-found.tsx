import { Link } from "wouter";
import { Button } from "@/components/ui/button";

export default function NotFound() {
  return (
    <div className="min-h-screen flex items-center justify-center bg-background">
      <div className="text-center space-y-4">
        <h1 className="text-6xl font-bold" data-testid="text-404">404</h1>
        <p className="text-xl text-muted-foreground" data-testid="text-not-found">
          Page not found
        </p>
        <Link href="/">
          <Button data-testid="button-home">
            Go Home
          </Button>
        </Link>
      </div>
    </div>
  );
}
