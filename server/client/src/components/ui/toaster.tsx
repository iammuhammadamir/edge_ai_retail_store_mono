import { useToast } from "@/contexts/ToastContext";

export function Toaster() {
  const { toasts } = useToast();

  return (
    <div className="fixed bg-white top-4 right-4 z-[999999] flex flex-col gap-2">
      {toasts.map((toast) => (
        <div
          key={toast.id}
          className={`rounded-md border p-4 shadow-lg ${
            toast.variant === "destructive"
              ? "bg-destructive text-destructive-foreground"
              : "bg-card"
          }`}
          data-testid={`toast-${toast.id}`}
        >
          {toast.title && (
            <div className="font-semibold" data-testid="toast-title">
              {toast.title}
            </div>
          )}
          {toast.description && (
            <div className="text-sm opacity-90" data-testid="toast-description">
              {toast.description}
            </div>
          )}
        </div>
      ))}
    </div>
  );
}
