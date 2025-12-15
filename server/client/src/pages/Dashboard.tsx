import { useState, useEffect } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/contexts/AuthContext";
import { useLocation } from "@/contexts/LocationContext";
import { queryClient, apiRequest } from "@/lib/queryClient";
import {
  Users,
  Award,
  Clock,
  Video,
  Flag,
  Save,
  TrendingUp,
  AlertTriangle,
  ShieldCheck,
  BarChart3,
  Package,
  Plus,
  Trash2,
  Calendar,
  Check,
  Filter,
  Bell,
  MapPin,
  ChevronDown,
  Pencil,
} from "lucide-react";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import type {
  Customer,
  InventoryItem,
  Notification,
  Location,
  Camera,
  Review,
  VideoClip,
} from "@shared/schema";

import logoImage from "@/assets/logo.png";
import { Input } from "@/components/ui/input";
import { Link } from "wouter";
import { InventoryUploadModal } from "@/components/InventoryUploadModal";
import { HLSPlayer } from "@/components/HLSPlayer";

type TabView = "video" | "loyalty" | "analytics" | "inventory";

// Helper function to detect video MIME type from URL or filename
function getVideoMimeType(url: string): string {
  try {
    // Extract pathname without query strings or fragments
    const pathname = url.includes("://")
      ? new URL(url).pathname
      : url.split("?")[0].split("#")[0];
    const extension = pathname.split(".").pop()?.toLowerCase();

    switch (extension) {
      case "mp4":
      case "m4v":
        return "video/mp4";
      case "webm":
        return "video/webm";
      case "ogg":
      case "ogv":
        return "video/ogg";
      case "mov":
        return "video/quicktime";
      case "avi":
        return "video/x-msvideo";
      default:
        return "video/mp4"; // default fallback for unknown types
    }
  } catch {
    // If URL parsing fails, fallback to video/mp4
    return "video/mp4";
  }
}

// Helper function to get initials from customer name or face ID
function getCustomerInitials(customer: Customer): string {
  if (customer.name && customer.name !== "Unknown Customer") {
    const nameParts = customer.name.split(" ");
    if (nameParts.length >= 2) {
      return `${nameParts[0][0]}${nameParts[nameParts.length - 1][0]}`.toUpperCase();
    }
    return customer.name.substring(0, 2).toUpperCase();
  }
  // Use face ID for initials if no name
  return customer.faceId.substring(0, 2).toUpperCase();
}

// Helper function to get avatar background color based on customer ID
function getAvatarColor(customerId: number): string {
  const colors = [
    "bg-blue-500 dark:bg-blue-600",
    "bg-green-500 dark:bg-green-600",
    "bg-purple-500 dark:bg-purple-600",
    "bg-orange-500 dark:bg-orange-600",
    "bg-pink-500 dark:bg-pink-600",
    "bg-teal-500 dark:bg-teal-600",
  ];
  return colors[customerId % colors.length];
}

// Location Selector Component (for Owners)
function LocationSelector() {
  const { currentLocationId, setCurrentLocationId, locations } = useLocation();
  const [isOpen, setIsOpen] = useState(false);

  // Don't render if no locations available yet or only one location
  if (!locations || locations.length <= 1) return null;

  // Find current location from the list
  const currentLocation = locations.find((loc) => loc.id === currentLocationId);

  return (
    <Popover open={isOpen} onOpenChange={setIsOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          className="gap-2"
          data-testid="button-location-selector"
        >
          <MapPin className="h-4 w-4" />
          {currentLocation?.name || "Select Location"}
          <ChevronDown className="h-4 w-4" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-64 p-2" data-testid="popover-location-list">
        <div className="space-y-1">
          {locations.map((location) => (
            <button
              key={location.id}
              onClick={() => {
                setCurrentLocationId(location.id);
                setIsOpen(false);
              }}
              className={`w-full text-left px-3 py-2 rounded-md text-sm hover-elevate active-elevate-2 ${location.id === currentLocationId
                ? "bg-accent text-accent-foreground"
                : ""
                }`}
              data-testid={`button-location-${location.id}`}
            >
              <div className="font-medium">{location.name}</div>
            </button>
          ))}
        </div>
      </PopoverContent>
    </Popover>
  );
}

// Notification Bell Component
function NotificationBell() {
  const { toast } = useToast();
  const [isOpen, setIsOpen] = useState(false);
  const [selectedClip, setSelectedClip] = useState<VideoClip | null>(null);

  // Fetch notifications
  const {
    data: notifications,
    isLoading,
    isError,
  } = useQuery<Notification[]>({
    queryKey: ["/api/notifications"],
    refetchInterval: 30000, // Refresh every 30 seconds
    retry: 2,
  });

  const unreadCount = (notifications || []).filter(
    (n: Notification) => !n.isRead,
  ).length;

  // Mark notification as read
  const markAsReadMutation = useMutation({
    mutationFn: (id: number) =>
      apiRequest(`/api/notifications/${id}/read`, {
        method: "PATCH",
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/notifications"] });
    },
  });

  // Mark all as read
  const markAllAsReadMutation = useMutation({
    mutationFn: () =>
      apiRequest("/api/notifications/read-all", {
        method: "PATCH",
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/notifications"] });
      toast({
        title: "All notifications marked as read",
      });
    },
  });

  const handleNotificationClick = (notification: Notification) => {
    if (!notification.isRead) {
      markAsReadMutation.mutate(notification.id);
    }
  };

  const getNotificationIcon = (type: string) => {
    switch (type) {
      case "customer_flagged":
        return <Flag className="h-4 w-4 text-yellow-500" />;
      case "theft_confirmed":
        return <AlertTriangle className="h-4 w-4 text-red-500" />;
      case "inventory_expired":
        return <Package className="h-4 w-4 text-orange-500" />;
      default:
        return <Bell className="h-4 w-4" />;
    }
  };

  return (
    <Popover open={isOpen} onOpenChange={setIsOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          className="relative"
          data-testid="button-notifications"
        >
          <Bell className="h-5 w-5" />
          {unreadCount > 0 && (
            <Badge
              variant="destructive"
              className="absolute -top-1 -right-1 h-5 w-5 flex items-center justify-center p-0 text-xs"
              data-testid="badge-notification-count"
            >
              {unreadCount > 9 ? "9+" : unreadCount}
            </Badge>
          )}
        </Button>
      </PopoverTrigger>
      <PopoverContent
        className="w-96 p-0 bg-white dark:bg-gray-950"
        align="end"
        data-testid="panel-notifications"
      >
        <div className="flex items-center justify-between p-4 border-b">
          <h3 className="font-semibold">Notifications</h3>
          {unreadCount > 0 && (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => markAllAsReadMutation.mutate()}
              data-testid="button-mark-all-read"
            >
              Mark all as read
            </Button>
          )}
        </div>
        <ScrollArea className="max-h-96">
          {isLoading ? (
            <div
              className="p-8 text-center text-muted-foreground"
              data-testid="text-notifications-loading"
            >
              <div className="h-6 w-6 border-2 border-primary border-t-transparent rounded-full animate-spin mx-auto mb-2" />
              <p>Loading notifications...</p>
            </div>
          ) : isError ? (
            <div
              className="p-8 text-center text-muted-foreground"
              data-testid="text-notifications-error"
            >
              <AlertTriangle className="h-12 w-12 mx-auto mb-2 opacity-20 text-destructive" />
              <p>Failed to load notifications</p>
            </div>
          ) : !notifications || notifications.length === 0 ? (
            <div
              className="p-8 text-center text-muted-foreground"
              data-testid="text-no-notifications"
            >
              <Bell className="h-12 w-12 mx-auto mb-2 opacity-20" />
              <p>No notifications</p>
            </div>
          ) : (
            <div className="divide-y">
              {notifications.map((notification: Notification) => (
                <button
                  key={notification.id}
                  onClick={() => handleNotificationClick(notification)}
                  className={`w-full p-4 text-left hover-elevate transition-colors ${!notification.isRead ? "bg-muted/50" : ""
                    }`}
                  data-testid={`notification-${notification.id}`}
                >
                  <div className="flex items-start gap-3">
                    <div className="mt-1">
                      {getNotificationIcon(notification.type)}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-start justify-between gap-2">
                        <p className="font-medium text-sm">
                          {notification.title}
                        </p>
                        {!notification.isRead && (
                          <div
                            className="h-2 w-2 rounded-full bg-primary flex-shrink-0 mt-1"
                            data-testid={`unread-indicator-${notification.id}`}
                          />
                        )}
                      </div>
                      <p className="text-sm text-muted-foreground mt-1">
                        {notification.message}
                      </p>
                      <p className="text-xs text-muted-foreground mt-2">
                        {new Date(notification.createdAt).toLocaleString()}
                      </p>
                    </div>
                  </div>
                </button>
              ))}
            </div>
          )}
        </ScrollArea>
      </PopoverContent>
    </Popover>
  );
}

export default function Dashboard() {
  const { user, logout } = useAuth();
  const { toast } = useToast();
  const {
    currentLocationId,
    setCurrentLocationId,
    locations,
    setLocations,
    currentLocation,
  } = useLocation();

  const [selectedCamera, setSelectedCamera] = useState<Camera | null>(null);
  const [activeTab, setActiveTab] = useState<TabView>("video");
  const [showAddForm, setShowAddForm] = useState(false);
  const [newCustomer, setNewCustomer] = useState({
    faceId: "",
    name: "",
    photoUrl: "",
  });

  const [cameraStatusFilter, setCameraStatusFilter] = useState<string[]>([
    "pending",
    "suspect",
    "confirmed_theft",
    "clear",
  ]);

  const toggleCameraStatusFilter = (value: string) => {
    setCameraStatusFilter((prev) =>
      prev.includes(value) ? prev.filter((v) => v !== value) : [...prev, value],
    );
  };

  const { data: cameraReviews = [] } = useQuery({
    queryKey: ["camera-reviews", currentLocationId],
    queryFn: () =>
      apiRequest(`/api/camera-reviews?locationId=${currentLocationId}`),
    enabled: !!currentLocationId,
  });

  // Guard against missing user (should not happen due to ProtectedRoute)
  if (!user) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <p className="text-muted-foreground">Unauthorized</p>
      </div>
    );
  }

  // Fetch all locations (owners can see all, others see their assigned location)
  const { data: locationsData = [] } = useQuery<Location[]>({
    queryKey: ["/api/admin/locations"],
    enabled: user.role === "owner" || user.role === "reviewer",
  });

  // Initialize location context
  useEffect(() => {
    if (
      (user.role === "owner" || user.role === "reviewer") &&
      locationsData.length > 0
    ) {
      // For owners/reviewers, use data from API
      setLocations(locationsData);

      if (!currentLocationId) {
        setCurrentLocationId(locationsData[0].id);
      }
    } else if (user.role !== "owner" && user.locationId) {
      // For non-owners, use their assigned location
      if (!currentLocationId) {
        setCurrentLocationId(user.locationId);
        setLocations([
          {
            id: user.locationId,
            name: `Location ${user.locationId}`,
            createdAt: new Date(),
          },
        ]);
      }
    }
  }, [
    user.role,
    user.locationId,
    locationsData,
    currentLocationId,
    setLocations,
    setCurrentLocationId,
  ]);

  // Fetch cameras for current location
  const { data: cameras = [], isLoading: camerasLoading } = useQuery<Camera[]>({
    queryKey: ["/api/cameras", currentLocationId],
    queryFn: () => apiRequest(`/api/cameras?locationId=${currentLocationId}`),
    enabled: !!currentLocationId,
  });

  const filteredCameras = cameras.filter((cam) => {
    const review = cameraReviews.find((r) => r.cameraId === cam.id);
    const decision = review ? review.decision : "pending";
    return cameraStatusFilter.includes(decision);
  });

  // Fetch customers for loyalty program (scoped by location)
  const { data: customers = [], isLoading: customersLoading } = useQuery<
    Customer[]
  >({
    queryKey: ["/api/customers", currentLocationId],
    queryFn: () => apiRequest(`/api/customers?locationId=${currentLocationId}`),
    enabled: !!currentLocationId,
  });

  // Create customer mutation (location-specific)
  const createCustomerMutation = useMutation({
    mutationFn: async () => {
      return await apiRequest("/api/customers", {
        method: "POST",
        body: JSON.stringify({
          faceId: newCustomer.faceId,
          name: newCustomer.name || null,
          photoUrl: newCustomer.photoUrl || null,
          locationId: currentLocationId,
          points: 0,
          lastSeen: new Date(),
        }),
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: ["/api/customers", currentLocationId],
      });
      toast({
        title: "Customer added",
        description: "New customer has been added successfully.",
      });
      setShowAddForm(false);
      setNewCustomer({ faceId: "", name: "", photoUrl: "" });
    },
    onError: (error: any) => {
      toast({
        variant: "destructive",
        title: "Error",
        description: error.message || "Failed to add customer.",
      });
    },
  });

  const createReviewMutation = useMutation({
    mutationFn: async (data: {
      cameraId?: number;
      decision: string;
      reviewerRole: string;
      reviewerUsername: string;
    }) => {
      return await apiRequest("/api/camera-reviews", {
        method: "POST",
        body: JSON.stringify(data),
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["camera-reviews"] });
      queryClient.invalidateQueries({
        queryKey: ["camera-reviews", currentLocationId],
      });
      queryClient.invalidateQueries({ queryKey: ["/api/reviews"] });
      queryClient.invalidateQueries({
        queryKey: ["/api/reviews", currentLocationId],
      });
      queryClient.invalidateQueries({ queryKey: ["/api/notifications"] });
      queryClient.invalidateQueries({
        queryKey: ["/api/customers", currentLocationId],
      });
      toast({
        title: "Review submitted",
        description: "Camera classification has been recorded.",
      });
      setSelectedCamera(null);
    },
    onError: () => {
      toast({
        variant: "destructive",
        title: "Error",
        description: "Failed to submit review.",
      });
    },
  });

  const updateCameraStatusMutation = useMutation({
    mutationFn: async (data: { cameraId: number; status: string }) => {
      return await apiRequest(`/api/cameras/${data.cameraId}/status`, {
        method: "PATCH",
        body: JSON.stringify({ status: data.status }),
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/cameras", currentLocationId] });
      queryClient.invalidateQueries({ queryKey: ["/api/notifications"] });
      toast({
        title: "Camera status updated",
        description: "Camera status has been updated successfully.",
      });
      setSelectedCamera(null);
    },
    onError: () => {
      toast({
        variant: "destructive",
        title: "Error",
        description: "Failed to update camera status.",
      });
    },
  });

  const handleClassify = (
    decision: "clear" | "suspect" | "confirmed_theft",
  ) => {
    if (!selectedCamera) return;
    updateCameraStatusMutation.mutate({
      cameraId: selectedCamera.id,
      status: decision,
    });
  };

  // Set default selection when cameras load
  useEffect(() => {
    if (!selectedCamera && cameras.length > 0) {
      setSelectedCamera(cameras[0]);
    }
  }, [cameras, selectedCamera]);

  if (camerasLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <p className="text-muted-foreground">Loading cameras...</p>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background">
      {/* Header */}
      <header className="border-b bg-card">
        <div className="container mx-auto px-4 py-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <img
              src={logoImage}
              alt="Smoothflow AI Logo"
              className="h-12 w-auto"
              data-testid="img-logo"
            />
            <div>
              <h1 className="text-2xl font-bold" data-testid="text-app-title">
                Smoothflow AI
              </h1>
              <p
                className="text-sm text-muted-foreground"
                data-testid="text-user-role"
              >
                {user.role === "manager"
                  ? "Manager Dashboard"
                  : user.role === "reviewer"
                    ? "AI Reviewer Dashboard"
                    : "Owner Dashboard"}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-3">
            <Badge variant="secondary" data-testid="badge-username">
              {user.username}
            </Badge>
            {user.role === "owner" && <LocationSelector />}
            {user.role === "reviewer" && <LocationSelector />}
            {user.role === "owner" && (
              <Link href="/admin">
                <Button variant="outline" data-testid="button-admin">
                  Admin
                </Button>
              </Link>
            )}
            <NotificationBell />
            <Button
              variant="outline"
              onClick={logout}
              data-testid="button-logout"
            >
              Logout
            </Button>
          </div>
        </div>
      </header>

      <div className="container mx-auto px-4 py-8">
        {/* Tab Navigation */}
        <div className="flex gap-2 mb-6 border-b">
          <Button
            variant={activeTab === "video" ? "default" : "ghost"}
            onClick={() => setActiveTab("video")}
            className="rounded-b-none"
            data-testid="tab-video"
          >
            <Video className="h-4 w-4 mr-2" />
            Video Feed
          </Button>
          <Button
            variant={activeTab === "loyalty" ? "default" : "ghost"}
            onClick={() => setActiveTab("loyalty")}
            className="rounded-b-none"
            data-testid="tab-loyalty"
          >
            <Users className="h-4 w-4 mr-2" />
            Customer Loyalty
          </Button>
          <Button
            variant={activeTab === "inventory" ? "default" : "ghost"}
            onClick={() => setActiveTab("inventory")}
            className="rounded-b-none"
            data-testid="tab-inventory"
          >
            <Package className="h-4 w-4 mr-2" />
            Inventory
          </Button>
          {user.role === "owner" && (
            <Button
              variant={activeTab === "analytics" ? "default" : "ghost"}
              onClick={() => setActiveTab("analytics")}
              className="rounded-b-none"
              data-testid="tab-analytics"
            >
              <Award className="h-4 w-4 mr-2" />
              Analytics
            </Button>
          )}

          {user.role === "reviewer" && (
            <Button
              variant={activeTab === "analytics" ? "default" : "ghost"}
              onClick={() => setActiveTab("analytics")}
              className="rounded-b-none"
              data-testid="tab-analytics"
            >
              <Award className="h-4 w-4 mr-2" />
              Analytics
            </Button>
          )}
        </div>

        {/* Video Feed Tab */}
        {activeTab === "video" && (
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
            {/* Left Column: Camera Grid */}
            <div>
              <div className="flex items-center justify-between mb-4 gap-3 flex-wrap">
                <h2 className="text-xl font-semibold">
                  Cameras ({filteredCameras.length})
                </h2>

                {/* Filter Popover */}
                <Popover>
                  <PopoverTrigger asChild>
                    <Button variant="outline" size="sm" className="gap-2">
                      <Filter className="h-4 w-4" />
                      Filter
                      {cameraStatusFilter.length < 4 && (
                        <Badge variant="secondary" className="ml-1 h-5 px-1.5">
                          {cameraStatusFilter.length}
                        </Badge>
                      )}
                    </Button>
                  </PopoverTrigger>

                  <PopoverContent
                    className="w-64 bg-white dark:bg-gray-950"
                    align="end"
                  >
                    <div className="space-y-4">
                      <div>
                        <h4 className="font-medium text-sm mb-3">
                          Filter by Status
                        </h4>
                        <div className="space-y-2">
                          {[
                            {
                              value: "pending",
                              label: "Pending",
                              variant: "secondary",
                            },
                            {
                              value: "suspect",
                              label: "Suspect",
                              variant: "secondary",
                            },
                            {
                              value: "confirmed_theft",
                              label: "Confirmed Theft",
                              variant: "destructive",
                            },
                            {
                              value: "clear",
                              label: "Clear",
                              variant: "default",
                            },
                          ].map((status) => (
                            <button
                              key={status.value}
                              onClick={() =>
                                toggleCameraStatusFilter(status.value)
                              }
                              className="flex items-center justify-between w-full p-2 rounded-md hover-elevate"
                            >
                              <div className="flex items-center gap-2">
                                <div
                                  className={`w-4 h-4 border-2 rounded flex items-center justify-center ${cameraStatusFilter.includes(status.value)
                                    ? "bg-primary border-primary"
                                    : "border-muted-foreground/30"
                                    }`}
                                >
                                  {cameraStatusFilter.includes(
                                    status.value,
                                  ) && (
                                      <Check className="h-3 w-3 text-primary-foreground" />
                                    )}
                                </div>
                                <span className="text-sm">{status.label}</span>
                              </div>

                              <Badge
                                variant={status.variant}
                                className="text-xs"
                              >
                                {
                                  cameraReviews.filter(
                                    (r) => r.decision === status.value,
                                  ).length
                                }
                              </Badge>
                            </button>
                          ))}
                        </div>
                      </div>

                      <div className="flex gap-2 pt-2 border-t">
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() =>
                            setCameraStatusFilter([
                              "pending",
                              "suspect",
                              "confirmed_theft",
                              "clear",
                            ])
                          }
                          className="flex-1"
                        >
                          Select All
                        </Button>
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => setCameraStatusFilter([])}
                          className="flex-1"
                        >
                          Clear All
                        </Button>
                      </div>
                    </div>
                  </PopoverContent>
                </Popover>
              </div>

              {/* CAMERA LIST */}
              <div className="space-y-4">
                {filteredCameras.length === 0 ? (
                  <Card>
                    <CardContent className="p-6">
                      <p className="text-center text-muted-foreground">
                        No cameras match the selected filters
                      </p>
                    </CardContent>
                  </Card>
                ) : (
                  filteredCameras.map((camera) => {
                    const review = cameraReviews.find(
                      (r) => r.cameraId === camera.id,
                    );
                    const decision = review ? review.decision : "pending";

                    return (
                      <Card
                        key={camera.id}
                        className={`cursor-pointer hover-elevate ${selectedCamera?.id === camera.id
                          ? "border-primary border-2"
                          : ""
                          }`}
                        onClick={() => {
                          console.log("clicked");
                          setSelectedCamera(camera);
                        }}
                      >
                        <CardContent className="p-4">
                          <div className="flex gap-3">
                            <div className="flex-shrink-0 relative">
                              <div className="w-32 h-20 bg-muted rounded-md overflow-hidden">
                                <video
                                  muted
                                  preload="metadata"
                                  className="w-full h-full object-cover"
                                >
                                  <source
                                    src={camera.streamUrl}
                                    type="video/mp4"
                                  />
                                </video>

                                <div className="absolute top-1 left-1">
                                  <Badge className="bg-black/70 text-white text-xs px-1 py-0 h-auto">
                                    {camera.name}
                                  </Badge>
                                </div>
                              </div>
                            </div>

                            <div className="flex-1 min-w-0">
                              <div className="flex items-start justify-between mb-2">
                                <div className="min-w-0 flex-1">
                                  <h3 className="font-semibold text-sm truncate">
                                    {camera.name}
                                  </h3>
                                  <p className="text-xs text-muted-foreground">
                                    Camera Feed
                                  </p>
                                  <p className="text-xs text-muted-foreground mt-0.5">
                                    Status: <span className="capitalize">{camera.status}</span>
                                  </p>
                                </div>

                                <Badge
                                  variant={
                                    camera.status === "confirmed_theft"
                                      ? "destructive"
                                      : camera.status === "suspect"
                                        ? "secondary"
                                        : "default"
                                  }
                                >
                                  {camera.status}
                                </Badge>
                              </div>
                            </div>
                          </div>
                        </CardContent>
                      </Card>
                    );
                  })
                )}
              </div>
            </div>

            {/* Right Column: Live Stream */}
            <div className="space-y-8">
              <div>
                <h2 className="text-xl font-semibold mb-4">Live Stream</h2>

                {selectedCamera ? (
                  <Card>
                    <CardHeader>
                      <CardTitle className="flex items-center gap-2">
                        <span className="relative flex h-3 w-3">
                          <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-red-400 opacity-75"></span>
                          <span className="relative inline-flex rounded-full h-3 w-3 bg-red-500"></span>
                        </span>
                        {selectedCamera.name}
                      </CardTitle>
                    </CardHeader>

                    <CardContent className="space-y-4">
                      <div className="aspect-video bg-black rounded-md overflow-hidden relative">
                        {selectedCamera.streamUrl ? (
                          <HLSPlayer
                            src={selectedCamera.streamUrl}
                            className="w-full h-full"
                            autoPlay={true}
                            muted={true}
                            controls={true}
                          />
                        ) : (
                          <div className="w-full h-full flex items-center justify-center text-white">
                            <div className="text-center">
                              <Video className="h-12 w-12 mx-auto mb-2 opacity-50" />
                              <p className="text-sm text-gray-400">No stream URL configured</p>
                            </div>
                          </div>
                        )}
                      </div>

                      <div className="flex items-center justify-between text-sm text-muted-foreground">
                        <span>Status: <Badge variant="outline">{selectedCamera.status}</Badge></span>
                        <span>Location: {currentLocationId}</span>
                      </div>
                    </CardContent>
                  </Card>
                ) : (
                  <Card>
                    <CardContent className="p-12 text-center text-muted-foreground">
                      <Video className="h-12 w-12 mx-auto mb-2 opacity-20" />
                      <p>Select a camera to view live stream</p>
                    </CardContent>
                  </Card>
                )}
              </div>
            </div>
          </div>
        )}

        {/* Customer Loyalty Tab */}
        {activeTab === "loyalty" && (
          <div>
            <div className="flex justify-between items-center mb-4" >

              <h2
                className="text-xl font-semibold "
                data-testid="text-customers-heading"
              >
                Customer Recognition & Loyalty Program
              </h2>

              {user.role === "manager" && (
                <Button
                  onClick={() => setShowAddForm(!showAddForm)}
                  data-testid="button-add-customer"
                >
                  <Plus className="h-4 w-4 mr-2" />
                  Add Customer
                </Button>
              )}

            </div>


            {showAddForm && (
              <Card className="mb-4" data-testid="card-add-customer">
                <CardHeader>
                  <CardTitle>Add New Customer</CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="space-y-3">
                    <Input
                      placeholder="Face ID (required, e.g., FACE_12345)"
                      value={newCustomer.faceId}
                      onChange={(e) =>
                        setNewCustomer({ ...newCustomer, faceId: e.target.value })
                      }
                      data-testid="input-customer-faceid"
                    />
                    <Input
                      placeholder="Customer Name (optional)"
                      value={newCustomer.name}
                      onChange={(e) =>
                        setNewCustomer({ ...newCustomer, name: e.target.value })
                      }
                      data-testid="input-customer-name"
                    />
                    <Input
                      placeholder="Photo URL (optional)"
                      value={newCustomer.photoUrl}
                      onChange={(e) =>
                        setNewCustomer({ ...newCustomer, photoUrl: e.target.value })
                      }
                      data-testid="input-customer-photo"
                    />
                    {/* <p className="text-sm text-muted-foreground">
                      Customer will be added to: <strong>{currentLocation?.name}</strong>
                    </p> */}
                    <div className="flex gap-2">
                      <Button
                        onClick={() => {
                          if (!newCustomer.faceId) {
                            toast({
                              title: "Face ID required",
                              description: "Please enter a Face ID",
                              variant: "destructive",
                            });
                            return;
                          }
                          createCustomerMutation.mutate();
                        }}
                        disabled={createCustomerMutation.isPending}
                        data-testid="button-save-customer"
                      >
                        <Save className="h-4 w-4 mr-2" />
                        {createCustomerMutation.isPending ? "Saving..." : "Save"}
                      </Button>
                      <Button
                        variant="outline"
                        onClick={() => {
                          setShowAddForm(false);
                          setNewCustomer({ faceId: "", name: "", photoUrl: "" });
                        }}
                        data-testid="button-cancel-add-customer"
                      >
                        Cancel
                      </Button>
                    </div>
                  </div>
                </CardContent>
              </Card>
            )}

            {customersLoading ? (
              <Card>
                <CardContent className="p-6">
                  <p className="text-center text-muted-foreground">
                    Loading customers...
                  </p>
                </CardContent>
              </Card>
            ) : customers.length === 0 ? (
              <Card>
                <CardContent className="p-6">
                  <p
                    className="text-center text-muted-foreground"
                    data-testid="text-no-customers"
                  >
                    No customers tracked yet
                  </p>
                </CardContent>
              </Card>
            ) : (
              <>
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                  {customers.map((customer) => (
                    <CustomerCard
                      key={customer.id}
                      customer={customer}
                      isManager={user.role === "manager"}
                    />
                  ))}
                </div>

                {/* Loyalty Program Info */}
                <Card className="mt-4 bg-muted/50">
                  <CardHeader className="pb-3">
                    <CardTitle className="text-sm">Program Info</CardTitle>
                  </CardHeader>
                  <CardContent className="text-xs text-muted-foreground space-y-1">
                    <p>• 1 visit counted per detection • 5+ visits = Regular</p>
                    <p>
                      • Tracked:{" "}
                      <span
                        className="font-semibold"
                        data-testid="text-total-customers"
                      >
                        {customers.length}
                      </span>{" "}
                      | Regular:{" "}
                      <span
                        className="font-semibold"
                        data-testid="text-regular-customers"
                      >
                        {customers.filter((c) => c.points >= 5).length}
                      </span>
                    </p>
                  </CardContent>
                </Card>
              </>
            )}
          </div>
        )}

        {/* Inventory Tab */}
        {activeTab === "inventory" && <InventoryManagement />}

        {/* Analytics Tab - Owner Only */}
        {activeTab === "analytics" &&
          (user.role === "owner" || user.role === "reviewer") && (
            <AnalyticsDashboard setActiveTab={setActiveTab} />
          )}
      </div>
    </div>
  );
}

// Analytics Dashboard Component
function AnalyticsDashboard({
  setActiveTab,
}: {
  setActiveTab: (tab: TabView) => void;
}) {
  const { currentLocationId } = useLocation();

  // Fetch all required data (filtered by current location)
  const { data: customers = [] } = useQuery<Customer[]>({
    queryKey: ["/api/customers", currentLocationId],
    queryFn: () => apiRequest(`/api/customers?locationId=${currentLocationId}`),
    enabled: !!currentLocationId,
  });

  const { data: reviews = [] } = useQuery<Review[]>({
    queryKey: ["/api/reviews", currentLocationId],
    queryFn: () => apiRequest(`/api/reviews?locationId=${currentLocationId}`),
    enabled: !!currentLocationId,
  });

  const { data: inventory = [] } = useQuery<InventoryItem[]>({
    queryKey: ["/api/inventory", currentLocationId],
    queryFn: () => apiRequest(`/api/inventory?locationId=${currentLocationId}`),
    enabled: !!currentLocationId,
  });

  // Calculate expired inventory
  const expiredInventoryCount = inventory.filter(
    (item) => new Date(item.expirationDate).getTime() < Date.now(),
  ).length;

  // Calculate expiring soon inventory (within 7 days)
  const expiringSoonCount = inventory.filter((item) => {
    const daysUntilExpiration = Math.floor(
      (new Date(item.expirationDate).getTime() - Date.now()) /
      (1000 * 60 * 60 * 24),
    );
    return daysUntilExpiration <= 7 && daysUntilExpiration >= 0;
  }).length;

  return (
    <div className="space-y-8">
      <div>
        <h2
          className="text-xl font-semibold mb-4"
          data-testid="text-analytics-heading"
        >
          Business Analytics Dashboard
        </h2>

        {/* Key Metrics Overview */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-5 gap-4 mb-8">
          <Card data-testid="card-metric-customers">
            <CardHeader className="pb-3">
              <div className="flex items-center justify-between">
                <CardTitle className="text-sm font-medium">
                  Total Customers
                </CardTitle>
                <Users className="h-4 w-4 text-muted-foreground" />
              </div>
            </CardHeader>
            <CardContent>
              <button
                type="button"
                onClick={() => setActiveTab("loyalty")}
                className="text-3xl font-bold hover:underline cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring rounded"
                aria-label="View all customers in Customer Loyalty tab"
                data-testid="text-metric-total-customers"
              >
                {customers.length}
              </button>
              <p className="text-xs text-muted-foreground mt-1">
                {customers.filter((c) => c.points >= 5).length} regular customers
              </p>
            </CardContent>
          </Card>

          <Card data-testid="card-metric-reviews">
            <CardHeader className="pb-3">
              <div className="flex items-center justify-between">
                <CardTitle className="text-sm font-medium">
                  Security Reviews
                </CardTitle>
                <ShieldCheck className="h-4 w-4 text-muted-foreground" />
              </div>
            </CardHeader>
            <CardContent>
              <button
                type="button"
                onClick={() => setActiveTab("video")}
                className="text-3xl font-bold hover:underline cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring rounded"
                aria-label="View security reviews in Video Feed tab"
                data-testid="text-metric-total-reviews"
              >
                {reviews.length}
              </button>
              <p className="text-xs text-muted-foreground mt-1">
                Total clip classifications
              </p>
            </CardContent>
          </Card>

          <Card data-testid="card-metric-theft">
            <CardHeader className="pb-3">
              <div className="flex items-center justify-between">
                <CardTitle className="text-sm font-medium">
                  Theft Incidents
                </CardTitle>
                <AlertTriangle className="h-4 w-4 text-destructive" />
              </div>
            </CardHeader>
            <CardContent>
              <button
                type="button"
                onClick={() => setActiveTab("video")}
                className="text-3xl font-bold text-destructive hover:underline cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring rounded"
                aria-label="View theft incidents in Video Feed tab"
                data-testid="text-metric-theft-count"
              >
                {reviews.filter((r) => r.decision === "confirmed_theft").length}
              </button>
              <p className="text-xs text-muted-foreground mt-1">
                Confirmed theft cases
              </p>
            </CardContent>
          </Card>

          <Card data-testid="card-metric-suspect">
            <CardHeader className="pb-3">
              <div className="flex items-center justify-between">
                <CardTitle className="text-sm font-medium">
                  Suspect Cases
                </CardTitle>
                <Flag className="h-4 w-4 text-muted-foreground" />
              </div>
            </CardHeader>
            <CardContent>
              <button
                type="button"
                onClick={() => setActiveTab("video")}
                className="text-3xl font-bold text-secondary-foreground hover:underline cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring rounded"
                aria-label="View suspect cases in Video Feed tab"
                data-testid="text-metric-suspect-count"
              >
                {reviews.filter((r) => r.decision === "suspect").length}
              </button>
              <p className="text-xs text-muted-foreground mt-1">
                Under investigation
              </p>
            </CardContent>
          </Card>

          <Card data-testid="card-metric-expired-inventory">
            <CardHeader className="pb-3">
              <div className="flex items-center justify-between">
                <CardTitle className="text-sm font-medium">
                  Expired Items
                </CardTitle>
                <Package className="h-4 w-4 text-destructive" />
              </div>
            </CardHeader>
            <CardContent>
              <button
                type="button"
                onClick={() => setActiveTab("inventory")}
                className="text-3xl font-bold text-destructive hover:underline cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring rounded"
                aria-label="View expired inventory in Inventory tab"
                data-testid="text-metric-expired-count"
              >
                {expiredInventoryCount}
              </button>
              <p className="text-xs text-muted-foreground mt-1">
                {expiringSoonCount} expiring soon
              </p>
            </CardContent>
          </Card>
        </div>

        {/* Customer Breakdown */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-8">
          <Card data-testid="card-customer-breakdown">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <BarChart3 className="h-5 w-5" />
                Customer Breakdown
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <span className="text-sm font-medium">Regular Customers</span>
                  <button
                    type="button"
                    onClick={() => setActiveTab("loyalty")}
                    aria-label="View regular customers in Customer Loyalty tab"
                    data-testid="badge-regular-count"
                  >
                    <Badge
                      variant="default"
                      className="cursor-pointer hover:opacity-80"
                    >
                      {customers.filter((c) => c.points >= 5).length}
                    </Badge>
                  </button>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-sm font-medium">New Customers</span>
                  <button
                    type="button"
                    onClick={() => setActiveTab("loyalty")}
                    aria-label="View new customers in Customer Loyalty tab"
                    data-testid="badge-new-count"
                  >
                    <Badge
                      variant="secondary"
                      className="cursor-pointer hover:opacity-80"
                    >
                      {customers.filter((c) => c.points < 5).length}
                    </Badge>
                  </button>
                </div>
                <div className="flex items-center justify-between pt-2 border-t">
                  <span className="text-sm font-medium">
                    Total Visits
                  </span>
                  <button
                    type="button"
                    onClick={() => setActiveTab("loyalty")}
                    className="font-bold hover:underline cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring rounded"
                    aria-label="View total visits in Customer Loyalty tab"
                    data-testid="text-total-points"
                  >
                    {customers.reduce((sum, c) => sum + c.points, 0)}
                  </button>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-sm font-medium">
                    Avg Visits per Customer
                  </span>
                  <button
                    type="button"
                    onClick={() => setActiveTab("loyalty")}
                    className="font-bold hover:underline cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring rounded"
                    aria-label="View customer visits in Customer Loyalty tab"
                    data-testid="text-avg-points"
                  >
                    {customers.length > 0
                      ? (
                        customers.reduce((sum, c) => sum + c.points, 0) /
                        customers.length
                      ).toFixed(1)
                      : "0"}
                  </button>
                </div>
              </div>
            </CardContent>
          </Card>

          <Card data-testid="card-flag-breakdown">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Flag className="h-5 w-5" />
                Customer Flags
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <div className="w-3 h-3 rounded-full bg-green-500" />
                    <span className="text-sm font-medium">Green (Safe)</span>
                  </div>
                  <button
                    type="button"
                    onClick={() => setActiveTab("loyalty")}
                    aria-label="View green-flagged customers in Customer Loyalty tab"
                    data-testid="badge-green-count"
                  >
                    <Badge
                      variant="outline"
                      className="cursor-pointer hover:opacity-80"
                    >
                      {customers.filter((c) => c.flag === "green").length}
                    </Badge>
                  </button>
                </div>
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <div className="w-3 h-3 rounded-full bg-yellow-500" />
                    <span className="text-sm font-medium">
                      Yellow (Caution)
                    </span>
                  </div>
                  <button
                    type="button"
                    onClick={() => setActiveTab("loyalty")}
                    aria-label="View yellow-flagged customers in Customer Loyalty tab"
                    data-testid="badge-yellow-count"
                  >
                    <Badge
                      variant="outline"
                      className="cursor-pointer hover:opacity-80"
                    >
                      {customers.filter((c) => c.flag === "yellow").length}
                    </Badge>
                  </button>
                </div>
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <div className="w-3 h-3 rounded-full bg-red-500" />
                    <span className="text-sm font-medium">Red (Alert)</span>
                  </div>
                  <button
                    type="button"
                    onClick={() => setActiveTab("loyalty")}
                    aria-label="View red-flagged customers in Customer Loyalty tab"
                    data-testid="badge-red-count"
                  >
                    <Badge
                      variant="outline"
                      className="cursor-pointer hover:opacity-80"
                    >
                      {customers.filter((c) => c.flag === "red").length}
                    </Badge>
                  </button>
                </div>
                <div className="flex items-center justify-between pt-2 border-t">
                  <span className="text-sm font-medium">Unflagged</span>
                  <button
                    type="button"
                    onClick={() => setActiveTab("loyalty")}
                    aria-label="View unflagged customers in Customer Loyalty tab"
                    data-testid="badge-unflagged-count"
                  >
                    <Badge
                      variant="secondary"
                      className="cursor-pointer hover:opacity-80"
                    >
                      {customers.filter((c) => !c.flag).length}
                    </Badge>
                  </button>
                </div>
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Review Statistics */}
        <Card data-testid="card-review-stats">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <TrendingUp className="h-5 w-5" />
              Review Performance
            </CardTitle>
            <CardDescription>
              Security clip classification summary
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <div className="space-y-2">
                <p className="text-sm font-medium text-muted-foreground">
                  Clear Cases
                </p>
                <button
                  type="button"
                  onClick={() => setActiveTab("video")}
                  className="text-2xl font-bold hover:underline cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring rounded"
                  aria-label="View clear cases in Video Feed tab"
                  data-testid="text-clear-count"
                >
                  {reviews.filter((r) => r.decision === "clear").length}
                </button>
                <p className="text-xs text-muted-foreground">
                  {reviews.length > 0
                    ? `${Math.round((reviews.filter((r) => r.decision === "clear").length / reviews.length) * 100)}%`
                    : "0%"}{" "}
                  of total
                </p>
              </div>
              <div className="space-y-2">
                <p className="text-sm font-medium text-muted-foreground">
                  Suspect Cases
                </p>
                <button
                  type="button"
                  onClick={() => setActiveTab("video")}
                  className="text-2xl font-bold hover:underline cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring rounded"
                  aria-label="View suspect cases in Video Feed tab"
                  data-testid="text-suspect-review-count"
                >
                  {reviews.filter((r) => r.decision === "suspect").length}
                </button>
                <p className="text-xs text-muted-foreground">
                  {reviews.length > 0
                    ? `${Math.round((reviews.filter((r) => r.decision === "suspect").length / reviews.length) * 100)}%`
                    : "0%"}{" "}
                  of total
                </p>
              </div>
              <div className="space-y-2">
                <p className="text-sm font-medium text-muted-foreground">
                  Confirmed Thefts
                </p>
                <button
                  type="button"
                  onClick={() => setActiveTab("video")}
                  className="text-2xl font-bold text-destructive hover:underline cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring rounded"
                  aria-label="View confirmed thefts in Video Feed tab"
                  data-testid="text-theft-review-count"
                >
                  {
                    reviews.filter((r) => r.decision === "confirmed_theft")
                      .length
                  }
                </button>
                <p className="text-xs text-muted-foreground">
                  {reviews.length > 0
                    ? `${Math.round((reviews.filter((r) => r.decision === "confirmed_theft").length / reviews.length) * 100)}%`
                    : "0%"}{" "}
                  of total
                </p>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

// Inventory Management Component
function InventoryManagement() {
  const { toast } = useToast();
  const { currentLocationId } = useLocation();
  const [isAddingNew, setIsAddingNew] = useState(false);
  const [newItem, setNewItem] = useState({
    itemName: "",
    batchNumber: "",
    quantity: "",
    expirationDate: "",
    category: "",
  });

  // Fetch inventory items (filtered by current location)
  const { data: inventory = [], isLoading } = useQuery<InventoryItem[]>({
    queryKey: ["/api/inventory", currentLocationId],
    queryFn: () => apiRequest(`/api/inventory?locationId=${currentLocationId}`),
    enabled: !!currentLocationId,
  });

  // Add new item mutation
  const addItemMutation = useMutation({
    mutationFn: async (item: typeof newItem) => {
      return await apiRequest("/api/inventory", {
        method: "POST",
        body: JSON.stringify({
          itemName: item.itemName,
          batchNumber: item.batchNumber,
          quantity: parseInt(item.quantity),
          expirationDate: new Date(item.expirationDate),
          category: item.category || null,
          locationId: currentLocationId,
        }),
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: ["/api/inventory", currentLocationId],
      });
      toast({
        title: "Item added",
        description: "Inventory item has been added successfully.",
      });
      setIsAddingNew(false);
      setNewItem({
        itemName: "",
        batchNumber: "",
        quantity: "",
        expirationDate: "",
        category: "",
      });
    },
    onError: () => {
      toast({
        variant: "destructive",
        title: "Error",
        description: "Failed to add inventory item.",
      });
    },
  });

  // Update item mutation
  const updateItemMutation = useMutation({
    mutationFn: async ({
      id,
      updates,
    }: {
      id: number;
      updates: Partial<InventoryItem>;
    }) => {
      return await apiRequest(`/api/inventory/${id}`, {
        method: "PATCH",
        body: JSON.stringify(updates),
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: ["/api/inventory", currentLocationId],
      });
      toast({
        title: "Item updated",
        description: "Inventory item has been updated.",
      });
    },
    onError: () => {
      toast({
        variant: "destructive",
        title: "Error",
        description: "Failed to update inventory item.",
      });
    },
  });

  // Delete item mutation
  const deleteItemMutation = useMutation({
    mutationFn: async (id: number) => {
      return await apiRequest(`/api/inventory/${id}`, {
        method: "DELETE",
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: ["/api/inventory", currentLocationId],
      });
      toast({
        title: "Item deleted",
        description: "Inventory item has been deleted.",
      });
    },
    onError: () => {
      toast({
        variant: "destructive",
        title: "Error",
        description: "Failed to delete inventory item.",
      });
    },
  });

  const handleAddItem = () => {
    if (
      !newItem.itemName ||
      !newItem.batchNumber ||
      !newItem.quantity ||
      !newItem.expirationDate
    ) {
      toast({
        variant: "destructive",
        title: "Validation Error",
        description: "Please fill in all required fields.",
      });
      return;
    }
    addItemMutation.mutate(newItem);
  };

  const handleUpdateQuantity = (id: number, quantity: string) => {
    const qty = parseInt(quantity);
    if (isNaN(qty) || qty < 0) return;
    updateItemMutation.mutate({ id, updates: { quantity: qty } });
  };

  const handleUpdateExpiration = (id: number, date: string) => {
    if (!date) return;
    updateItemMutation.mutate({
      id,
      updates: { expirationDate: new Date(date) },
    });
  };

  const isExpiringSoon = (expirationDate: Date) => {
    const daysUntilExpiration = Math.floor(
      (new Date(expirationDate).getTime() - Date.now()) / (1000 * 60 * 60 * 24),
    );
    return daysUntilExpiration <= 7 && daysUntilExpiration >= 0;
  };

  const isExpired = (expirationDate: Date) => {
    return new Date(expirationDate).getTime() < Date.now();
  };

  // State for the new "Add New Item" dialog
  const [isAddDialogOpen, setIsAddDialogOpen] = useState(false);

  // Category filter state
  const [selectedCategory, setSelectedCategory] = useState<string>("all");

  // Get unique categories from inventory
  const categories = Array.from(
    new Set(inventory.map((item) => item.category || "Uncategorized"))
  ).sort();

  // Filter inventory by selected category
  const filteredInventory = selectedCategory === "all"
    ? inventory
    : inventory.filter(
        (item) => (item.category || "Uncategorized") === selectedCategory
      );

  return (
    <div>
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 mb-6">
        <div>
          <h2 className="text-2xl font-bold tracking-tight">Inventory</h2>
          <p className="text-muted-foreground">
            Manage stock levels and track expiration dates
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          {/* Category Filter */}
          <Popover>
            <PopoverTrigger asChild>
              <Button variant="outline" className="gap-2">
                <Filter className="h-4 w-4" />
                {selectedCategory === "all" ? "All Categories" : selectedCategory}
                <ChevronDown className="h-4 w-4" />
              </Button>
            </PopoverTrigger>
            <PopoverContent className="w-56 p-2 bg-white" align="end">
              <div className="space-y-1">
                <button
                  onClick={() => setSelectedCategory("all")}
                  className={`w-full text-left px-3 py-2 rounded-md text-sm hover:bg-muted ${
                    selectedCategory === "all" ? "bg-accent text-accent-foreground font-medium" : ""
                  }`}
                >
                  All Categories
                  <Badge variant="secondary" className="ml-2">
                    {inventory.length}
                  </Badge>
                </button>
                {categories.map((category) => (
                  <button
                    key={category}
                    onClick={() => setSelectedCategory(category)}
                    className={`w-full text-left px-3 py-2 rounded-md text-sm hover:bg-muted flex items-center justify-between ${
                      selectedCategory === category ? "bg-accent text-accent-foreground font-medium" : ""
                    }`}
                  >
                    <span>{category}</span>
                    <Badge variant="outline">
                      {inventory.filter((i) => (i.category || "Uncategorized") === category).length}
                    </Badge>
                  </button>
                ))}
              </div>
            </PopoverContent>
          </Popover>
          <InventoryUploadModal locationId={currentLocationId ?? 0} />
          <Dialog open={isAddDialogOpen} onOpenChange={setIsAddDialogOpen}>
            <DialogTrigger asChild>
              <Button>
                <Plus className="mr-2 h-4 w-4" /> Add New Item
              </Button>
            </DialogTrigger>
            <DialogContent className="sm:max-w-[600px] bg-white">
              <DialogHeader>
                <DialogTitle className="flex items-center gap-2">
                  <Package className="h-5 w-5 text-primary" />
                  Add New Inventory Item
                </DialogTitle>
                <DialogDescription>
                  Fill in the details below to add a new item to your inventory.
                </DialogDescription>
              </DialogHeader>
              <div className="grid gap-4 py-4" data-testid="card-add-inventory">
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <label className="text-sm font-medium">
                      Item Name <span className="text-destructive">*</span>
                    </label>
                    <Input
                      value={newItem.itemName}
                      onChange={(e) =>
                        setNewItem({ ...newItem, itemName: e.target.value })
                      }
                      placeholder="e.g., Milk (1 Gallon)"
                      data-testid="input-new-item-name"
                    />
                  </div>
                  <div className="space-y-2">
                    <label className="text-sm font-medium">
                      Batch Number <span className="text-destructive">*</span>
                    </label>
                    <Input
                      value={newItem.batchNumber}
                      onChange={(e) =>
                        setNewItem({ ...newItem, batchNumber: e.target.value })
                      }
                      placeholder="e.g., BATCH-2024-001"
                      data-testid="input-new-batch-number"
                    />
                  </div>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                  <div className="space-y-2">
                    <label className="text-sm font-medium">
                      Quantity <span className="text-destructive">*</span>
                    </label>
                    <Input
                      type="number"
                      min="0"
                      value={newItem.quantity}
                      onChange={(e) =>
                        setNewItem({ ...newItem, quantity: e.target.value })
                      }
                      placeholder="e.g., 24"
                      data-testid="input-new-quantity"
                    />
                  </div>
                  <div className="space-y-2">
                    <label className="text-sm font-medium">
                      Expiration Date <span className="text-destructive">*</span>
                    </label>
                    <Input
                      type="date"
                      value={newItem.expirationDate}
                      onChange={(e) =>
                        setNewItem({ ...newItem, expirationDate: e.target.value })
                      }
                      data-testid="input-new-expiration"
                    />
                  </div>
                  <div className="space-y-2">
                    <label className="text-sm font-medium">Category</label>
                    <Input
                      value={newItem.category}
                      onChange={(e) =>
                        setNewItem({ ...newItem, category: e.target.value })
                      }
                      placeholder="e.g., Dairy"
                      data-testid="input-new-category"
                    />
                  </div>
                </div>
              </div>
              <DialogFooter className="gap-2 sm:gap-0">
                <Button
                  variant="outline"
                  onClick={() => {
                    setIsAddDialogOpen(false);
                    setNewItem({
                      itemName: "",
                      batchNumber: "",
                      quantity: "",
                      expirationDate: "",
                      category: "",
                    });
                  }}
                  data-testid="button-cancel-new-item"
                >
                  Cancel
                </Button>
                <Button
                  onClick={() => {
                    handleAddItem();
                    if (!addItemMutation.isPending) {
                      setIsAddDialogOpen(false);
                    }
                  }}
                  disabled={addItemMutation.isPending}
                  data-testid="button-save-new-item"
                >
                  <Save className="mr-2 h-4 w-4" />
                  {addItemMutation.isPending ? "Saving..." : "Save Item"}
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        </div>
      </div>

      {/* The original `isAddingNew` conditional rendering is replaced by the Dialog */}
      {/* {isAddingNew && (
        <Card className="mb-4" data-testid="card-add-inventory">
          <CardHeader>
            <CardTitle className="text-base">Add New Inventory Item</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              <div>
                <label className="text-sm font-medium mb-1 block">
                  Item Name *
                </label>
                <Input
                  value={newItem.itemName}
                  onChange={(e) =>
                    setNewItem({ ...newItem, itemName: e.target.value })
                  }
                  placeholder="e.g., Milk (1 Gallon)"
                  data-testid="input-new-item-name"
                />
              </div>
              <div>
                <label className="text-sm font-medium mb-1 block">
                  Batch Number *
                </label>
                <Input
                  value={newItem.batchNumber}
                  onChange={(e) =>
                    setNewItem({ ...newItem, batchNumber: e.target.value })
                  }
                  placeholder="e.g., BATCH-2024-001"
                  data-testid="input-new-batch-number"
                />
              </div>
              <div>
                <label className="text-sm font-medium mb-1 block">
                  Quantity *
                </label>
                <Input
                  type="number"
                  min="0"
                  value={newItem.quantity}
                  onChange={(e) =>
                    setNewItem({ ...newItem, quantity: e.target.value })
                  }
                  placeholder="e.g., 24"
                  data-testid="input-new-quantity"
                />
              </div>
              <div>
                <label className="text-sm font-medium mb-1 block">
                  Expiration Date *
                </label>
                <Input
                  type="date"
                  value={newItem.expirationDate}
                  onChange={(e) =>
                    setNewItem({ ...newItem, expirationDate: e.target.value })
                  }
                  data-testid="input-new-expiration"
                />
              </div>
              <div>
                <label className="text-sm font-medium mb-1 block">
                  Category
                </label>
                <Input
                  value={newItem.category}
                  onChange={(e) =>
                    setNewItem({ ...newItem, category: e.target.value })
                  }
                  placeholder="e.g., Dairy"
                  data-testid="input-new-category"
                />
              </div>
              <div className="flex items-end gap-2">
                <Button
                  onClick={handleAddItem}
                  disabled={addItemMutation.isPending}
                  className="flex-1"
                  data-testid="button-save-new-item"
                >
                  Save Item
                </Button>
                <Button
                  variant="outline"
                  onClick={() => {
                    setIsAddingNew(false);
                    setNewItem({
                      itemName: "",
                      batchNumber: "",
                      quantity: "",
                      expirationDate: "",
                      category: "",
                    });
                  }}
                  data-testid="button-cancel-new-item"
                >
                  Cancel
                </Button>
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Inventory Table */}
      {isLoading ? (
        <Card>
          <CardContent className="p-6">
            <p className="text-center text-muted-foreground">
              Loading inventory...
            </p>
          </CardContent>
        </Card>
      ) : inventory.length === 0 ? (
        <Card>
          <CardContent className="p-6">
            <p
              className="text-center text-muted-foreground"
              data-testid="text-no-inventory"
            >
              No inventory items yet. Click "Add New Item" to get started.
            </p>
          </CardContent>
        </Card>
      ) : filteredInventory.length === 0 ? (
        <Card>
          <CardContent className="p-6">
            <p className="text-center text-muted-foreground">
              No items found in "{selectedCategory}" category.
              <Button
                variant="link"
                className="px-1"
                onClick={() => setSelectedCategory("all")}
              >
                Show all items
              </Button>
            </p>
          </CardContent>
        </Card>
      ) : (
        <Card data-testid="card-inventory-table">
          <CardContent className="p-0">
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead className="bg-muted/50 border-b">
                  <tr>
                    <th className="text-left p-3 text-sm font-medium">
                      Item Name
                    </th>
                    <th className="text-left p-3 text-sm font-medium">Batch</th>
                    <th className="text-left p-3 text-sm font-medium">
                      Category
                    </th>
                    <th className="text-left p-3 text-sm font-medium">
                      Quantity
                    </th>
                    <th className="text-left p-3 text-sm font-medium">
                      Expiration Date
                    </th>
                    <th className="text-left p-3 text-sm font-medium">
                      Status
                    </th>
                    <th className="text-left p-3 text-sm font-medium">
                      Actions
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {filteredInventory.map((item) => (
                    <InventoryRow
                      key={item.id}
                      item={item}
                      onUpdateQuantity={handleUpdateQuantity}
                      onUpdateExpiration={handleUpdateExpiration}
                      onDelete={() => deleteItemMutation.mutate(item.id)}
                      isExpired={isExpired(item.expirationDate)}
                      isExpiringSoon={isExpiringSoon(item.expirationDate)}
                    />
                  ))}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

// Inventory Row Component with inline editing
function InventoryRow({
  item,
  onUpdateQuantity,
  onUpdateExpiration,
  onDelete,
  isExpired,
  isExpiringSoon,
}: {
  item: InventoryItem;
  onUpdateQuantity: (id: number, quantity: string) => void;
  onUpdateExpiration: (id: number, date: string) => void;
  onDelete: () => void;
  isExpired: boolean;
  isExpiringSoon: boolean;
}) {
  const [editingQuantity, setEditingQuantity] = useState(false);
  const [quantity, setQuantity] = useState(item.quantity.toString());
  const [editingExpiration, setEditingExpiration] = useState(false);
  const [expirationDate, setExpirationDate] = useState(
    new Date(item.expirationDate).toISOString().split("T")[0],
  );

  const handleQuantityBlur = () => {
    if (quantity !== item.quantity.toString()) {
      onUpdateQuantity(item.id, quantity);
    }
    setEditingQuantity(false);
  };

  const handleExpirationBlur = () => {
    const itemDate = new Date(item.expirationDate).toISOString().split("T")[0];
    if (expirationDate !== itemDate) {
      onUpdateExpiration(item.id, expirationDate);
    }
    setEditingExpiration(false);
  };

  return (
    <tr
      className="border-b hover-elevate"
      data-testid={`row-inventory-${item.id}`}
    >
      <td className="p-3">
        <div>
          <p className="font-medium" data-testid={`text-item-name-${item.id}`}>
            {item.itemName}
          </p>
        </div>
      </td>
      <td className="p-3">
        <span
          className="text-sm text-muted-foreground"
          data-testid={`text-batch-${item.id}`}
        >
          {item.batchNumber}
        </span>
      </td>
      <td className="p-3">
        <Badge variant="outline" data-testid={`badge-category-${item.id}`}>
          {item.category || "Uncategorized"}
        </Badge>
      </td>
      <td className="p-3">
        {editingQuantity ? (
          <Input
            type="number"
            min="0"
            value={quantity}
            onChange={(e) => setQuantity(e.target.value)}
            onBlur={handleQuantityBlur}
            onKeyDown={(e) => {
              if (e.key === "Enter") handleQuantityBlur();
              if (e.key === "Escape") {
                setQuantity(item.quantity.toString());
                setEditingQuantity(false);
              }
            }}
            autoFocus
            className="w-24"
            data-testid={`input-quantity-${item.id}`}
          />
        ) : (
          <button
            onClick={() => setEditingQuantity(true)}
            className="font-medium hover:underline cursor-pointer text-left"
            data-testid={`text-quantity-${item.id}`}
          >
            {item.quantity}
          </button>
        )}
      </td>
      <td className="p-3">
        {editingExpiration ? (
          <Input
            type="date"
            value={expirationDate}
            onChange={(e) => setExpirationDate(e.target.value)}
            onBlur={handleExpirationBlur}
            onKeyDown={(e) => {
              if (e.key === "Enter") handleExpirationBlur();
              if (e.key === "Escape") {
                setExpirationDate(
                  new Date(item.expirationDate).toISOString().split("T")[0],
                );
                setEditingExpiration(false);
              }
            }}
            autoFocus
            className="w-40"
            data-testid={`input-expiration-${item.id}`}
          />
        ) : (
          <button
            onClick={() => setEditingExpiration(true)}
            className="flex items-center gap-1 hover:underline cursor-pointer text-left"
            data-testid={`text-expiration-${item.id}`}
          >
            <Calendar className="h-3 w-3" />
            {new Date(item.expirationDate).toLocaleDateString()}
          </button>
        )}
      </td>
      <td className="p-3">
        {isExpired ? (
          <Badge variant="destructive" data-testid={`badge-status-${item.id}`}>
            Expired
          </Badge>
        ) : isExpiringSoon ? (
          <Badge
            className="bg-yellow-500 hover:bg-yellow-600"
            data-testid={`badge-status-${item.id}`}
          >
            Expiring Soon
          </Badge>
        ) : (
          <Badge variant="secondary" data-testid={`badge-status-${item.id}`}>
            Good
          </Badge>
        )}
      </td>
      <td className="p-3">
        <Button
          variant="ghost"
          size="sm"
          onClick={onDelete}
          className="hover:bg-destructive/10"
          data-testid={`button-delete-${item.id}`}
        >
          <Trash2 className="h-4 w-4 text-destructive" />
        </Button>
      </td>
    </tr>
  );
}

// Customer Card Component with flag functionality
function CustomerCard({
  customer,
  isManager,
}: {
  customer: Customer;
  isManager: boolean;
}) {
  const { toast } = useToast();
  const { currentLocationId } = useLocation();
  const [isUpdating, setIsUpdating] = useState(false);

  const updateFlagMutation = useMutation({
    mutationFn: async (flag: string | null) => {
      return await apiRequest(`/api/customers/${customer.id}/flag`, {
        method: "PATCH",
        body: JSON.stringify({ flag }),
      });
    },
    onSuccess: () => {
      // Invalidate with current location from component scope
      queryClient.invalidateQueries({
        queryKey: ["/api/customers", currentLocationId],
      });
      queryClient.invalidateQueries({ queryKey: ["/api/notifications"] });
      toast({
        title: "Flag updated",
        description: "Customer flag has been updated.",
      });
      setIsUpdating(false);
    },
    onError: () => {
      toast({
        variant: "destructive",
        title: "Error",
        description: "Failed to update flag.",
      });
      setIsUpdating(false);
    },
  });

  const deleteCustomerMutation = useMutation({
    mutationFn: async () => {
      return await apiRequest(`/api/customers/${customer.id}`, {
        method: "DELETE",
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: ["/api/customers", currentLocationId],
      });
      toast({
        title: "Customer deleted",
        description: "Customer has been removed successfully.",
      });
    },
    onError: (error: any) => {
      toast({
        variant: "destructive",
        title: "Error",
        description: error.message || "Failed to delete customer.",
      });
    },
  });

  const [editingName, setEditingName] = useState(false);
  const [newName, setNewName] = useState(customer.name || "");

  const updateNameMutation = useMutation({
    mutationFn: async (name: string) => {
      return await apiRequest(`/api/customers/${customer.id}/name`, {
        method: "PATCH",
        body: JSON.stringify({ name }),
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: ["/api/customers", currentLocationId],
      });
      toast({
        title: "Name updated",
        description: "Customer name has been updated.",
      });
      setEditingName(false);
    },
    onError: () => {
      toast({
        variant: "destructive",
        title: "Error",
        description: "Failed to update name.",
      });
    },
  });

  const handleFlagChange = (flag: string | null) => {
    setIsUpdating(true);
    updateFlagMutation.mutate(flag);
  };

  return (
    <Card
      className="hover-elevate"
      data-testid={`card-customer-${customer.id}`}
    >
      <CardHeader className="pb-3">
        <div className="flex items-start justify-between gap-3 flex-wrap">
          <div className="flex items-start gap-3 flex-1 min-w-0 flex-wrap">
            {/* Customer Avatar */}
            {customer.photoUrl ? (
              <img
                src={customer.photoUrl}
                alt={customer.name || "Customer"}
                className="flex-shrink-0 w-12 h-12 rounded-full object-cover"
                data-testid={`avatar-customer-${customer.id}`}
              />
            ) : (
              <div
                className={`flex-shrink-0 w-12 h-12 rounded-full ${getAvatarColor(customer.id)} flex items-center justify-center text-white font-semibold`}
                data-testid={`avatar-customer-${customer.id}`}
              >
                {getCustomerInitials(customer)}
              </div>
            )}

            {/* Customer Info */}
            <div className="flex-1 min-w-0">
              {editingName ? (
                <div className="flex items-center gap-2">
                  <Input
                    value={newName}
                    onChange={(e) => setNewName(e.target.value)}
                    placeholder="Enter name"
                    className="h-7 text-sm"
                    autoFocus
                    onKeyDown={(e) => {
                      if (e.key === "Enter") {
                        updateNameMutation.mutate(newName);
                      } else if (e.key === "Escape") {
                        setEditingName(false);
                        setNewName(customer.name || "");
                      }
                    }}
                  />
                  <Button
                    size="icon"
                    variant="ghost"
                    className="h-7 w-7"
                    onClick={() => updateNameMutation.mutate(newName)}
                    disabled={updateNameMutation.isPending}
                  >
                    <Check className="h-3 w-3" />
                  </Button>
                </div>
              ) : (
                <div className="flex items-center gap-1">
                  <CardTitle
                    className="text-sm"
                    data-testid={`text-customer-name-${customer.id}`}
                  >
                    {customer.name || "Unknown Customer"}
                  </CardTitle>
                  {isManager && (
                    <Button
                      size="icon"
                      variant="ghost"
                      className="h-6 w-6"
                      onClick={() => {
                        setNewName(customer.name || "");
                        setEditingName(true);
                      }}
                    >
                      <Pencil className="h-3 w-3" />
                    </Button>
                  )}
                </div>
              )}
              <CardDescription
                className="text-xs"
                data-testid={`text-customer-faceid-${customer.id}`}
              >
                ID: {customer.faceId}
              </CardDescription>
            </div>
          </div>

          <div className="flex items-center gap-2">
            {/* Regular/New Badge */}
            <Badge
              variant={customer.points >= 5 ? "default" : "secondary"}
              className="flex-shrink-0"
              data-testid={`badge-customer-status-${customer.id}`}
            >
              {customer.points >= 5 ? "Regular" : "New"}
            </Badge>

            {/* Delete Button (Manager Only) */}
            {isManager && (
              <AlertDialog>
                <AlertDialogTrigger asChild>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="flex-shrink-0 h-9 w-9"
                    data-testid={`button-delete-customer-${customer.id}`}
                  >
                    <Trash2 className="h-4 w-4 text-destructive" />
                  </Button>
                </AlertDialogTrigger>
                <AlertDialogContent style={{ backgroundColor: "white" }}>
                  <AlertDialogHeader>
                    <AlertDialogTitle>Delete Customer</AlertDialogTitle>
                    <AlertDialogDescription>
                      Are you sure you want to delete {customer.name || "this customer"}? This action cannot be undone.
                    </AlertDialogDescription>
                  </AlertDialogHeader>
                  <AlertDialogFooter>
                    <AlertDialogCancel data-testid={`button-cancel-delete-${customer.id}`}>
                      Cancel
                    </AlertDialogCancel>
                    <AlertDialogAction
                      onClick={() => deleteCustomerMutation.mutate()}
                      disabled={deleteCustomerMutation.isPending}
                      className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                      data-testid={`button-confirm-delete-${customer.id}`}
                      style={{ backgroundColor: "red", color: "white" }}
                    >
                      {deleteCustomerMutation.isPending ? "Deleting..." : "Delete"}
                    </AlertDialogAction>
                  </AlertDialogFooter>
                </AlertDialogContent>
              </AlertDialog>
            )}
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-2">
        <div className="flex items-center gap-2">
          <Award className="h-4 w-4 text-yellow-500" />
          <span
            className="text-sm font-semibold"
            data-testid={`text-customer-points-${customer.id}`}
          >
            {customer.points} Visits
          </span>
        </div>
        <div className="text-xs text-muted-foreground">
          <div className="flex items-center gap-1">
            <Clock className="h-3 w-3" />
            <span data-testid={`text-customer-lastseen-${customer.id}`}>
              Last: {new Date(customer.lastSeen).toLocaleString()}
            </span>
          </div>
        </div>
        {customer.points >= 5 && (
          <div className="pt-1 border-t">
            <p className="text-xs text-green-600 dark:text-green-400 font-medium">
              ✓ Loyalty Member
            </p>
          </div>
        )}

        {/* Flag Controls for Managers */}
        {
          <div className="pt-2 border-t">
            <p className="text-xs font-medium mb-2">Flag:</p>
            <div className="flex gap-1">
              <Button
                size="sm"
                variant={customer.flag === "green" ? "default" : "outline"}
                onClick={() => handleFlagChange("green")}
                disabled={isUpdating}
                className="flex-1 h-7"
                data-testid={`button-flag-green-${customer.id}`}
              >
                <Flag
                  className={`h-3 w-3 ${customer.flag === "green" ? "text-white" : "text-green-600"}`}
                />
              </Button>
              <Button
                size="sm"
                variant={customer.flag === "yellow" ? "default" : "outline"}
                onClick={() => handleFlagChange("yellow")}
                disabled={isUpdating}
                className="flex-1 h-7"
                data-testid={`button-flag-yellow-${customer.id}`}
              >
                <Flag
                  className={`h-3 w-3 ${customer.flag === "yellow" ? "text-white" : "text-yellow-600"}`}
                />
              </Button>
              <Button
                size="sm"
                variant={customer.flag === "red" ? "default" : "outline"}
                onClick={() => handleFlagChange("red")}
                disabled={isUpdating}
                className="flex-1 h-7"
                data-testid={`button-flag-red-${customer.id}`}
              >
                <Flag
                  className={`h-3 w-3 ${customer.flag === "red" ? "text-white" : "text-red-600"}`}
                />
              </Button>
              {customer.flag && (
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => handleFlagChange(null)}
                  disabled={isUpdating}
                  className="h-7 px-2"
                  data-testid={`button-flag-clear-${customer.id}`}
                >
                  Clear
                </Button>
              )}
            </div>
          </div>
        }
      </CardContent>
    </Card>
  );
}
