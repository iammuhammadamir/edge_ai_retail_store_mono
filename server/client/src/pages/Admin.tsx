import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/contexts/AuthContext";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { Users, MapPin, Video, Plus, Trash2, Edit2, Save, X } from "lucide-react";
import type { Location, Camera, User } from "@shared/schema";
import { Link } from "wouter";
import logoImage from "@/assets/logo.png";

type TabView = "users" | "locations" | "cameras";

export default function Admin() {
  const { user, logout } = useAuth();
  const [activeTab, setActiveTab] = useState<TabView>("locations");

  // Guard against non-owners
  if (!user || user.role !== "owner") {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-center">
          <h1 className="text-2xl font-bold mb-2">Access Denied</h1>
          <p className="text-muted-foreground mb-4">Only owners can access the admin panel.</p>
          <Link href="/">
            <Button data-testid="button-back-dashboard">Back to Dashboard</Button>
          </Link>
        </div>
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
              alt="AI Security Logo" 
              className="h-12 w-auto"
              data-testid="img-logo"
            />
            <div>
              <h1 className="text-2xl font-bold" data-testid="text-app-title">
                Admin Panel
              </h1>
              <p className="text-sm text-muted-foreground" data-testid="text-user-role">
                Manage Locations, Cameras, and Users
              </p>
            </div>
          </div>
          <div className="flex items-center gap-3">
            <Badge variant="secondary" data-testid="badge-username">
              {user.username}
            </Badge>
            <Link href="/">
              <Button variant="outline" data-testid="button-back-dashboard">
                Back to Dashboard
              </Button>
            </Link>
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
            variant={activeTab === "locations" ? "default" : "ghost"}
            onClick={() => setActiveTab("locations")}
            className="rounded-b-none"
            data-testid="tab-locations"
          >
            <MapPin className="h-4 w-4 mr-2" />
            Locations
          </Button>
          <Button
            variant={activeTab === "cameras" ? "default" : "ghost"}
            onClick={() => setActiveTab("cameras")}
            className="rounded-b-none"
            data-testid="tab-cameras"
          >
            <Video className="h-4 w-4 mr-2" />
            Cameras
          </Button>
          <Button
            variant={activeTab === "users" ? "default" : "ghost"}
            onClick={() => setActiveTab("users")}
            className="rounded-b-none"
            data-testid="tab-users"
          >
            <Users className="h-4 w-4 mr-2" />
            Users
          </Button>
        </div>

        {/* Tab Content */}
        {activeTab === "locations" && <LocationsTab />}
        {activeTab === "cameras" && <CamerasTab />}
        {activeTab === "users" && <UsersTab />}
      </div>
    </div>
  );
}

// Locations Tab Component
function LocationsTab() {
  const { toast } = useToast();
  const [editingId, setEditingId] = useState<number | null>(null);
  const [editForm, setEditForm] = useState({ name: "", address: "" });
  const [newLocation, setNewLocation] = useState({ name: "", address: "" });
  const [showAddForm, setShowAddForm] = useState(false);

  const { data: locations = [], isLoading } = useQuery<Location[]>({
    queryKey: ["/api/admin/locations"],
  });

  const createMutation = useMutation({
    mutationFn: (data: { name: string; address: string }) =>
      apiRequest("/api/admin/locations", { method: "POST", body: JSON.stringify(data) }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/locations"] });
      toast({ title: "Location created successfully" });
      setNewLocation({ name: "", address: "" });
      setShowAddForm(false);
    },
    onError: () => {
      toast({ title: "Failed to create location", variant: "destructive" });
    },
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, data }: { id: number; data: { name: string; address: string } }) =>
      apiRequest(`/api/admin/locations/${id}`, { method: "PATCH", body: JSON.stringify(data) }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/locations"] });
      toast({ title: "Location updated successfully" });
      setEditingId(null);
    },
    onError: () => {
      toast({ title: "Failed to update location", variant: "destructive" });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (id: number) => apiRequest(`/api/admin/locations/${id}`, { method: "DELETE" }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/locations"] });
      toast({ title: "Location deleted successfully" });
    },
    onError: (error:any) => {

      toast({
        title: "Failed to delete location",
        description: error.message,
        variant: "destructive",        
      });

    },
  });

  const startEdit = (location: Location) => {
    setEditingId(location.id);
    setEditForm({ name: location.name, address: location.address || "" });
  };

  const saveEdit = (id: number) => {
    updateMutation.mutate({ id, data: editForm });
  };

  const cancelEdit = () => {
    setEditingId(null);
  };

  if (isLoading) {
    return <div className="text-muted-foreground">Loading locations...</div>;
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-xl font-semibold" data-testid="text-locations-title">Locations</h2>
        <Button onClick={() => setShowAddForm(!showAddForm)} data-testid="button-add-location">
          <Plus className="h-4 w-4 mr-2" />
          Add Location
        </Button>
      </div>

      {showAddForm && (
        <Card className="mb-4" data-testid="card-add-location">
          <CardHeader>
            <CardTitle>Add New Location</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-3">
              <Input
                placeholder="Location Name"
                value={newLocation.name}
                onChange={(e) => setNewLocation({ ...newLocation, name: e.target.value })}
                data-testid="input-location-name"
              />
              <Input
                placeholder="Address"
                value={newLocation.address}
                onChange={(e) => setNewLocation({ ...newLocation, address: e.target.value })}
                data-testid="input-location-address"
              />
              <div className="flex gap-2">
                <Button
                  onClick={() => createMutation.mutate(newLocation)}
                  disabled={!newLocation.name || !newLocation.address || createMutation.isPending}
                  data-testid="button-save-location"
                >
                  <Save className="h-4 w-4 mr-2" />
                  Save
                </Button>
                <Button
                  variant="outline"
                  onClick={() => {
                    setShowAddForm(false);
                    setNewLocation({ name: "", address: "" });
                  }}
                  data-testid="button-cancel-add"
                >
                  <X className="h-4 w-4 mr-2" />
                  Cancel
                </Button>
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      <div className="space-y-3">
        {locations.map((location) => (
          <Card key={location.id} data-testid={`card-location-${location.id}`}>
            <CardContent className="p-4">
              {editingId === location.id ? (
                <div className="space-y-3">
                  <Input
                    value={editForm.name}
                    onChange={(e) => setEditForm({ ...editForm, name: e.target.value })}
                    data-testid={`input-edit-name-${location.id}`}
                  />
                  <Input
                    value={editForm.address}
                    onChange={(e) => setEditForm({ ...editForm, address: e.target.value })}
                    data-testid={`input-edit-address-${location.id}`}
                  />
                  <div className="flex gap-2">
                    <Button
                      size="sm"
                      onClick={() => saveEdit(location.id)}
                      disabled={updateMutation.isPending}
                      data-testid={`button-save-${location.id}`}
                    >
                      <Save className="h-4 w-4 mr-2" />
                      Save
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={cancelEdit}
                      data-testid={`button-cancel-${location.id}`}
                    >
                      <X className="h-4 w-4 mr-2" />
                      Cancel
                    </Button>
                  </div>
                </div>
              ) : (
                <div className="flex items-center justify-between">
                  <div>
                    <h3 className="font-semibold" data-testid={`text-location-name-${location.id}`}>
                      {location.name}
                    </h3>
                    <p className="text-sm text-muted-foreground" data-testid={`text-location-address-${location.id}`}>
                      {location.address}
                    </p>
                  </div>
                  <div className="flex gap-2">
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => startEdit(location)}
                      data-testid={`button-edit-${location.id}`}
                    >
                      <Edit2 className="h-4 w-4" />
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => deleteMutation.mutate(location.id)}
                      disabled={deleteMutation.isPending}
                      data-testid={`button-delete-${location.id}`}
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                </div>
              )}
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}

// Cameras Tab Component
function CamerasTab() {
  const { toast } = useToast();
  const [editingId, setEditingId] = useState<number | null>(null);
  const [editForm, setEditForm] = useState({ name: "", streamUrl: "", locationId: 1 });
  const [newCamera, setNewCamera] = useState({ name: "", streamUrl: "", locationId: 1 });
  const [showAddForm, setShowAddForm] = useState(false);

  const { data: cameras = [], isLoading: camerasLoading } = useQuery<Camera[]>({
    queryKey: ["/api/admin/cameras"],
  });

  const { data: locations = [] } = useQuery<Location[]>({
    queryKey: ["/api/admin/locations"],
  });

  const createMutation = useMutation({
    mutationFn: (data: { name: string; streamUrl: string; locationId: number }) =>
      apiRequest("/api/admin/cameras", { method: "POST", body: JSON.stringify(data) }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/cameras"] });
      toast({ title: "Camera created successfully" });
      setNewCamera({ name: "", streamUrl: "", locationId: locations[0]?.id || 1 });
      setShowAddForm(false);
    },
    onError: () => {
      toast({ title: "Failed to create camera", variant: "destructive" });
    },
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, data }: { id: number; data: { name: string; streamUrl: string; locationId: number } }) =>
      apiRequest(`/api/admin/cameras/${id}`, { method: "PATCH", body: JSON.stringify(data) }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/cameras"] });
      toast({ title: "Camera updated successfully" });
      setEditingId(null);
    },
    onError: () => {
      toast({ title: "Failed to update camera", variant: "destructive" });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (id: number) => apiRequest(`/api/admin/cameras/${id}`, { method: "DELETE" }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/cameras"] });
      toast({ title: "Camera deleted successfully" });
    },
    onError: (error: any) => {
      const message = error?.message || "Failed to delete camera";
      toast({ title: message, variant: "destructive" });
    },
  });

  const startEdit = (camera: Camera) => {
    setEditingId(camera.id);
    setEditForm({ name: camera.name, streamUrl: camera.streamUrl, locationId: camera.locationId });
  };

  const saveEdit = (id: number) => {
    updateMutation.mutate({ id, data: editForm });
  };

  const cancelEdit = () => {
    setEditingId(null);
  };

  const getLocationName = (locationId: number) => {
    return locations.find(l => l.id === locationId)?.name || "Unknown";
  };

  if (camerasLoading) {
    return <div className="text-muted-foreground">Loading cameras...</div>;
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-xl font-semibold" data-testid="text-cameras-title">Cameras</h2>
        <Button onClick={() => setShowAddForm(!showAddForm)} data-testid="button-add-camera">
          <Plus className="h-4 w-4 mr-2" />
          Add Camera
        </Button>
      </div>

      {showAddForm && (
        <Card className="mb-4" data-testid="card-add-camera">
          <CardHeader>
            <CardTitle>Add New Camera</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-3">
              <Input
                placeholder="Camera Name"
                value={newCamera.name}
                onChange={(e) => setNewCamera({ ...newCamera, name: e.target.value })}
                data-testid="input-camera-name"
              />
              <Input
                placeholder="Stream URL (e.g., /videos/sample.mp4 or rtsp://...)"
                value={newCamera.streamUrl}
                onChange={(e) => setNewCamera({ ...newCamera, streamUrl: e.target.value })}
                data-testid="input-camera-stream-url"
              />
              <select
                className="w-full px-3 py-2 border rounded-md"
                value={newCamera.locationId}
                onChange={(e) => setNewCamera({ ...newCamera, locationId: parseInt(e.target.value) })}
                data-testid="select-camera-location"
              >
                {locations.length > 0 ? (
                  locations.map((loc) => (
                    <option key={loc.id} value={loc.id}>
                      {loc.name}
                    </option>
                  ))
                ) : (
                  <option value="">No locations available</option>
                )}
              </select>
              <div className="flex gap-2">
                <Button
                  onClick={() => createMutation.mutate(newCamera)}
                  disabled={!newCamera.name || !newCamera.streamUrl || createMutation.isPending}
                  data-testid="button-save-camera"
                >
                  <Save className="h-4 w-4 mr-2" />
                  Save
                </Button>
                <Button
                  variant="outline"
                  onClick={() => {
                    setShowAddForm(false);
                    setNewCamera({ name: "", streamUrl: "", locationId: locations[0]?.id || 1 });
                  }}
                  data-testid="button-cancel-add-camera"
                >
                  <X className="h-4 w-4 mr-2" />
                  Cancel
                </Button>
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      <div className="space-y-3">
        {cameras.map((camera) => (
          <Card key={camera.id} data-testid={`card-camera-${camera.id}`}>
            <CardContent className="p-4">
              {editingId === camera.id ? (
                <div className="space-y-3">
                  <Input
                    value={editForm.name}
                    onChange={(e) => setEditForm({ ...editForm, name: e.target.value })}
                    data-testid={`input-edit-camera-name-${camera.id}`}
                  />
                  <Input
                    value={editForm.streamUrl}
                    onChange={(e) => setEditForm({ ...editForm, streamUrl: e.target.value })}
                    placeholder="Stream URL"
                    data-testid={`input-edit-camera-stream-url-${camera.id}`}
                  />
                  <select
                    className="w-full px-3 py-2 border rounded-md"
                    value={editForm.locationId}
                    onChange={(e) => setEditForm({ ...editForm, locationId: parseInt(e.target.value) })}
                    data-testid={`select-edit-location-${camera.id}`}
                  >
                    {locations.map((loc) => (
                      <option key={loc.id} value={loc.id}>
                        {loc.name}
                      </option>
                    ))}
                  </select>
                  <div className="flex gap-2">
                    <Button
                      size="sm"
                      onClick={() => saveEdit(camera.id)}
                      disabled={updateMutation.isPending}
                      data-testid={`button-save-camera-${camera.id}`}
                    >
                      <Save className="h-4 w-4 mr-2" />
                      Save
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={cancelEdit}
                      data-testid={`button-cancel-camera-${camera.id}`}
                    >
                      <X className="h-4 w-4 mr-2" />
                      Cancel
                    </Button>
                  </div>
                </div>
              ) : (
                <div className="flex items-center justify-between">
                  <div>
                    <h3 className="font-semibold" data-testid={`text-camera-name-${camera.id}`}>
                      {camera.name}
                    </h3>
                    <p className="text-sm text-muted-foreground" data-testid={`text-camera-location-${camera.id}`}>
                      Location: {getLocationName(camera.locationId)}
                    </p>
                    <p className="text-xs text-muted-foreground truncate max-w-md" data-testid={`text-camera-stream-url-${camera.id}`}>
                      Stream: {camera.streamUrl}
                    </p>
                  </div>
                  <div className="flex gap-2">
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => startEdit(camera)}
                      data-testid={`button-edit-camera-${camera.id}`}
                    >
                      <Edit2 className="h-4 w-4" />
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => deleteMutation.mutate(camera.id)}
                      disabled={deleteMutation.isPending}
                      data-testid={`button-delete-camera-${camera.id}`}
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                </div>
              )}
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}

// Users Tab Component
function UsersTab() {
  const { toast } = useToast();
  const [editingUsername, setEditingUsername] = useState<string | null>(null);
  const [editForm, setEditForm] = useState({ username: "", role: "manager" as "manager" | "reviewer" | "owner", locationId: null as number | null });
  const [newUser, setNewUser] = useState({ username: "", password: "", role: "manager" as "manager" | "reviewer" | "owner", locationId: null as number | null });
  const [showAddForm, setShowAddForm] = useState(false);

  // User type without password (since API excludes it for security)
  type UserWithoutPassword = Omit<User, "password">;

  const { data: users = [], isLoading } = useQuery<UserWithoutPassword[]>({
    queryKey: ["/api/admin/users"],
  });

  // Fetch locations for dropdown
  const { data: locations = [] } = useQuery<Location[]>({
    queryKey: ["/api/admin/locations"],
  });

  const createMutation = useMutation({
    mutationFn: (data: { username: string; password: string; role: "manager" | "reviewer" | "owner"; locationId?: number | null }) =>
      apiRequest("/api/admin/users", { method: "POST", body: JSON.stringify(data) }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/users"] });
      toast({ title: "User created successfully" });
      setNewUser({ username: "", password: "", role: "manager", locationId: null });
      setShowAddForm(false);
    },
    onError: () => {
      toast({ title: "Failed to create user", variant: "destructive" });
    },
  });

  const updateMutation = useMutation({
    mutationFn: ({ username, data }: { username: string; data: { role?: "manager" | "reviewer" | "owner"; locationId?: number | null } }) =>
      apiRequest(`/api/admin/users/${username}`, { method: "PATCH", body: JSON.stringify(data) }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/users"] });
      toast({ title: "User updated successfully" });
      setEditingUsername(null);
    },
    onError: () => {
      toast({ title: "Failed to update user", variant: "destructive" });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (username: string) => apiRequest(`/api/admin/users/${username}`, { method: "DELETE" }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/users"] });
      toast({ title: "User deleted successfully" });
    },
    onError: () => {
      toast({ title: "Failed to delete user", variant: "destructive" });
    },
  });

  const startEdit = (user: UserWithoutPassword) => {
    setEditingUsername(user.username);
    setEditForm({ 
      username: user.username, 
      role: (user.role as "manager" | "reviewer" | "owner"),
      locationId: user.locationId || null
    });
  };

  const saveEdit = (username: string) => {
    updateMutation.mutate({ username, data: { role: editForm.role, locationId: editForm.locationId } });
  };

  const cancelEdit = () => {
    setEditingUsername(null);
  };

  const getRoleBadgeVariant = (role: string) => {
    switch (role) {
      case "owner": return "default";
      case "reviewer": return "secondary";
      case "manager": return "outline";
      default: return "outline";
    }
  };

  if (isLoading) {
    return <div className="text-muted-foreground">Loading users...</div>;
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-xl font-semibold" data-testid="text-users-title">Users</h2>
        <Button onClick={() => setShowAddForm(!showAddForm)} data-testid="button-add-user">
          <Plus className="h-4 w-4 mr-2" />
          Add User
        </Button>
      </div>

      {showAddForm && (
        <Card className="mb-4" data-testid="card-add-user">
          <CardHeader>
            <CardTitle>Add New User</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-3">
              <Input
                placeholder="Username"
                value={newUser.username}
                onChange={(e) => setNewUser({ ...newUser, username: e.target.value })}
                data-testid="input-user-username"
              />
              <Input
                type="password"
                placeholder="Password"
                value={newUser.password}
                onChange={(e) => setNewUser({ ...newUser, password: e.target.value })}
                data-testid="input-user-password"
              />
              <select
                className="w-full px-3 py-2 border rounded-md"
                value={newUser.role}
                onChange={(e) => setNewUser({ ...newUser, role: e.target.value as "manager" | "reviewer" | "owner" })}
                data-testid="select-user-role"
              >
                <option value="manager">Manager</option>
                <option value="reviewer">Reviewer</option>
                <option value="owner">Owner</option>
              </select>
              {(newUser.role === "manager" ) && (
                <select
                  className="w-full px-3 py-2 border rounded-md"
                  value={newUser.locationId || ""}
                  onChange={(e) => setNewUser({ ...newUser, locationId: e.target.value ? parseInt(e.target.value) : null })}
                  data-testid="select-user-location"
                >
                  <option value="">Select Location</option>
                  {locations.map((location) => (
                    <option key={location.id} value={location.id}>
                      {location.name}
                    </option>
                  ))}
                </select>
              )}
              <div className="flex gap-2">
                <Button
                  onClick={() => createMutation.mutate(newUser)}
                  disabled={!newUser.username || !newUser.password || createMutation.isPending}
                  data-testid="button-save-user"
                >
                  <Save className="h-4 w-4 mr-2" />
                  Save
                </Button>
                <Button
                  variant="outline"
                  onClick={() => {
                    setShowAddForm(false);
                    setNewUser({ username: "", password: "", role: "manager", locationId: null });
                  }}
                  data-testid="button-cancel-add-user"
                >
                  <X className="h-4 w-4 mr-2" />
                  Cancel
                </Button>
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      <div className="space-y-3">
        {users.map((user) => (
          <Card key={user.username} data-testid={`card-user-${user.username}`}>
            <CardContent className="p-4">
              {editingUsername === user.username ? (
                <div className="space-y-3">
                  <div className="font-medium text-sm text-muted-foreground">
                    Username: {user.username}
                  </div>
                  <select
                    className="w-full px-3 py-2 border rounded-md"
                    value={editForm.role}
                    onChange={(e) => {
                      const role = e.target.value;
                      if (role === "manager" || role === "reviewer" || role === "owner") {
                        setEditForm({ ...editForm, role });
                      }
                    }}
                    data-testid={`select-edit-role-${user.username}`}
                  >
                    <option value="manager">Manager</option>
                    <option value="reviewer">Reviewer</option>
                    <option value="owner">Owner</option>
                  </select>
                  {(editForm.role === "manager" ) && (
                    <select
                      className="w-full px-3 py-2 border rounded-md"
                      value={editForm.locationId || ""}
                      onChange={(e) => setEditForm({ ...editForm, locationId: e.target.value ? parseInt(e.target.value) : null })}
                      data-testid={`select-edit-location-${user.username}`}
                    >
                      <option value="">Select Location</option>
                      {locations.map((location) => (
                        <option key={location.id} value={location.id}>
                          {location.name}
                        </option>
                      ))}
                    </select>
                  )}
                  <div className="flex gap-2">
                    <Button
                      size="sm"
                      onClick={() => saveEdit(user.username)}
                      disabled={updateMutation.isPending}
                      data-testid={`button-save-user-${user.username}`}
                    >
                      <Save className="h-4 w-4 mr-2" />
                      Save
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={cancelEdit}
                      data-testid={`button-cancel-user-${user.username}`}
                    >
                      <X className="h-4 w-4 mr-2" />
                      Cancel
                    </Button>
                  </div>
                </div>
              ) : (
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <div>
                      <h3 className="font-semibold" data-testid={`text-user-username-${user.username}`}>
                        {user.username}
                      </h3>
                      <div className="flex gap-2 mt-1">
                        <Badge variant={getRoleBadgeVariant(user.role)} data-testid={`badge-user-role-${user.username}`}>
                          {user.role}
                        </Badge>
                        {user.locationId && (
                          <Badge variant="secondary" data-testid={`badge-user-location-${user.username}`}>
                            {locations.find(l => l.id === user.locationId)?.name || `Location ${user.locationId}`}
                          </Badge>
                        )}
                      </div>
                    </div>
                  </div>
                  <div className="flex gap-2">
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => startEdit(user)}
                      data-testid={`button-edit-user-${user.username}`}
                    >
                      <Edit2 className="h-4 w-4" />
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => deleteMutation.mutate(user.username)}
                      disabled={deleteMutation.isPending}
                      data-testid={`button-delete-user-${user.username}`}
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                </div>
              )}
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}
