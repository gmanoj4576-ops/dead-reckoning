/**
 * APEX MAPS - LOCATION SERVICE MODULE
 * High-accuracy Geolocation API integration with retries and IP city fallback.
 */

class LocationService {
  constructor() {
    this.currentPosition = null;
    this.watchId = null;
    this.listeners = [];
    this.defaultFallback = { lat: 40.7128, lng: -74.0060, name: 'Default City' };
  }

  /**
   * Request user's current GPS position with progressive retries
   * @returns {Promise<{lat: number, lng: number, accuracy: number}>}
   */
  async getCurrentLocation() {
    return new Promise((resolve) => {
      if (!navigator.geolocation) {
        this.fetchIpLocation().then(resolve);
        return;
      }

      // Try High Accuracy GPS first
      navigator.geolocation.getCurrentPosition(
        (position) => {
          const coords = {
            lat: position.coords.latitude,
            lng: position.coords.longitude,
            accuracy: position.coords.accuracy || 10,
            heading: position.coords.heading || 0,
            speed: position.coords.speed || 0
          };
          this.currentPosition = coords;
          resolve(coords);
        },
        (err) => {
          console.warn("High-accuracy GPS failed, trying standard accuracy...", err.message);
          
          // Retry with Standard Accuracy
          navigator.geolocation.getCurrentPosition(
            (position) => {
              const coords = {
                lat: position.coords.latitude,
                lng: position.coords.longitude,
                accuracy: position.coords.accuracy || 50,
                heading: position.coords.heading || 0,
                speed: position.coords.speed || 0
              };
              this.currentPosition = coords;
              resolve(coords);
            },
            async () => {
              console.warn("GPS unavailable, fetching IP city location fallback...");
              const ipCoords = await this.fetchIpLocation();
              resolve(ipCoords);
            },
            { enableHighAccuracy: false, timeout: 15000, maximumAge: 30000 }
          );
        },
        { enableHighAccuracy: true, timeout: 20000, maximumAge: 0 }
      );
    });
  }

  /**
   * Fetch user's city coordinates via IP fallback if GPS is turned off in phone settings
   */
  async fetchIpLocation() {
    try {
      const res = await fetch('https://ipapi.co/json/');
      if (res.ok) {
        const data = await res.json();
        if (data.latitude && data.longitude) {
          const coords = {
            lat: data.latitude,
            lng: data.longitude,
            accuracy: 5000,
            name: data.city || 'My Location'
          };
          this.currentPosition = coords;
          return coords;
        }
      }
    } catch (e) {
      console.warn("IP location fallback error:", e);
    }
    return this.defaultFallback;
  }

  /**
   * Start continuous position watching
   */
  startTracking(callback) {
    if (!navigator.geolocation) return;

    this.stopTracking();

    this.watchId = navigator.geolocation.watchPosition(
      (position) => {
        const coords = {
          lat: position.coords.latitude,
          lng: position.coords.longitude,
          accuracy: position.coords.accuracy || 10,
          heading: position.coords.heading || 0,
          speed: position.coords.speed || 0
        };
        this.currentPosition = coords;
        if (callback) callback(coords);
      },
      (error) => {
        console.warn("Location tracking error:", error);
      },
      {
        enableHighAccuracy: true,
        timeout: 15000,
        maximumAge: 1000
      }
    );
  }

  stopTracking() {
    if (this.watchId !== null) {
      navigator.geolocation.clearWatch(this.watchId);
      this.watchId = null;
    }
  }
}

export const locationService = new LocationService();
