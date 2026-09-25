/**
 * APEX MAPS - ROUTING SERVICE MODULE
 * Integrates OSRM (Open Source Routing Machine) API for directions & polylines.
 */

class RoutingService {
  constructor() {
    this.osrmBaseUrl = 'https://router.project-osrm.org/route/v1';
  }

  /**
   * Fetch route from origin to destination
   * @param {{lat: number, lng: number}} origin 
   * @param {{lat: number, lng: number}} destination 
   * @param {string} mode 'driving' | 'bicycling' | 'walking'
   */
  async getRoute(origin, destination, mode = 'driving') {
    let profile = 'driving';
    if (mode === 'bicycling') profile = 'bike';
    if (mode === 'walking') profile = 'foot';

    const coordinatesStr = `${origin.lng},${origin.lat};${destination.lng},${destination.lat}`;
    const url = `${this.osrmBaseUrl}/${profile}/${coordinatesStr}?overview=full&geometries=geojson&steps=true`;

    try {
      const response = await fetch(url);
      if (!response.ok) throw new Error("Routing request failed.");

      const data = await response.json();
      if (!data.routes || data.routes.length === 0) {
        throw new Error("No route found between these points.");
      }

      const primaryRoute = data.routes[0];
      
      // Convert OSRM GeoJSON [lng, lat] coordinates to Leaflet [lat, lng]
      const polylineCoords = primaryRoute.geometry.coordinates.map(coord => [coord[1], coord[0]]);

      // Format step maneuvers
      const steps = [];
      if (primaryRoute.legs && primaryRoute.legs[0]) {
        primaryRoute.legs[0].steps.forEach((step, idx) => {
          steps.push({
            id: idx,
            instruction: step.maneuver.modifier 
              ? `${this.capitalize(step.maneuver.type)} ${step.maneuver.modifier} onto ${step.name || 'road'}` 
              : `${this.capitalize(step.maneuver.type)} onto ${step.name || 'road'}`,
            type: step.maneuver.type,
            modifier: step.maneuver.modifier,
            distance: step.distance,
            duration: step.duration,
            location: [step.maneuver.location[1], step.maneuver.location[0]], // [lat, lng]
            icon: this.getManeuverIcon(step.maneuver.type, step.maneuver.modifier)
          });
        });
      }

      return {
        distance: primaryRoute.distance, // in meters
        duration: primaryRoute.duration, // in seconds
        polyline: polylineCoords,
        steps: steps,
        summary: primaryRoute.legs[0]?.summary || "Direct Route"
      };
    } catch (err) {
      console.error("OSRM route error:", err);
      throw err;
    }
  }

  getManeuverIcon(type, modifier) {
    if (type === 'turn' || type === 'new name') {
      if (modifier?.includes('right')) return 'fa-solid fa-arrow-turn-up fa-rotate-90';
      if (modifier?.includes('left')) return 'fa-solid fa-arrow-turn-up fa-rotate-270';
    }
    if (modifier?.includes('right')) return 'fa-solid fa-arrow-right';
    if (modifier?.includes('left')) return 'fa-solid fa-arrow-left';
    if (type === 'roundabout') return 'fa-solid fa-rotate-right';
    if (type === 'arrive') return 'fa-solid fa-flag-checkered';
    return 'fa-solid fa-arrow-up';
  }

  capitalize(str) {
    if (!str) return '';
    return str.charAt(0).toUpperCase() + str.slice(1);
  }

  formatDistance(meters) {
    if (meters < 1000) return `${Math.round(meters)} m`;
    return `${(meters / 1000).toFixed(1)} km`;
  }

  formatDuration(seconds) {
    const mins = Math.round(seconds / 60);
    if (mins < 60) return `${mins} min`;
    const hrs = Math.floor(mins / 60);
    const remMins = mins % 60;
    return `${hrs} hr ${remMins} min`;
  }
}

export const routingService = new RoutingService();
