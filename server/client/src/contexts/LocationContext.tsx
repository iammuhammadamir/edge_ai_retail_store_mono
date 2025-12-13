import { createContext, useContext, useState, useEffect, ReactNode } from "react";
import type { Location } from "@shared/schema";

interface LocationContextType {
  currentLocationId: number | null;
  setCurrentLocationId: (id: number) => void;
  locations: Location[];
  setLocations: (locations: Location[]) => void;
  currentLocation: Location | null;
}

const LocationContext = createContext<LocationContextType | undefined>(undefined);

export function LocationProvider({ children }: { children: ReactNode }) {
  const [currentLocationId, setCurrentLocationId] = useState<number | null>(() => {
    const stored = localStorage.getItem("currentLocationId");
    return stored ? parseInt(stored) : null;
  });
  
  const [locations, setLocations] = useState<Location[]>([]);

  useEffect(() => {
    if (currentLocationId !== null) {
      localStorage.setItem("currentLocationId", currentLocationId.toString());
    }
  }, [currentLocationId]);

  const currentLocation = locations.find(loc => loc.id === currentLocationId) || null;

  return (
    <LocationContext.Provider
      value={{
        currentLocationId,
        setCurrentLocationId,
        locations,
        setLocations,
        currentLocation,
      }}
    >
      {children}
    </LocationContext.Provider>
  );
}

export function useLocation() {
  const context = useContext(LocationContext);
  if (context === undefined) {
    throw new Error("useLocation must be used within a LocationProvider");
  }
  return context;
}
