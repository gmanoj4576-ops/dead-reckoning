/**
 * APEX MAPS - SEARCH SERVICE MODULE
 * Geocoding & place search via OpenStreetMap Nominatim API.
 */

class SearchService {
  constructor() {
    this.debounceTimer = null;
    this.baseUrl = 'https://nominatim.openstreetmap.org/search';
    this.reverseUrl = 'https://nominatim.openstreetmap.org/reverse';
  }

  /**
   * Search places with auto-suggestions
   * @param {string} query 
   * @param {number} limit 
   * @returns {Promise<Array<{name: string, address: string, lat: number, lng: number}>>}
   */
  async searchPlaces(query, limit = 5) {
    if (!query || query.trim().length < 2) return [];

    try {
      const url = `${this.baseUrl}?format=json&q=${encodeURIComponent(query)}&limit=${limit}&addressdetails=1`;
      const response = await fetch(url, {
        headers: {
          'Accept-Language': 'en-US,en;q=0.9'
        }
      });

      if (!response.ok) throw new Error("Search request failed.");

      const data = await response.json();
      return data.map(item => ({
        name: item.display_name.split(',')[0],
        address: item.display_name,
        lat: parseFloat(item.lat),
        lng: parseFloat(item.lon),
        type: item.type,
        category: item.category
      }));
    } catch (err) {
      console.error("Search API error:", err);
      return [];
    }
  }

  /**
   * Reverse geocode lat/lng to human readable address
   * @param {number} lat 
   * @param {number} lng 
   * @returns {Promise<{name: string, address: string}>}
   */
  async reverseGeocode(lat, lng) {
    try {
      const url = `${this.reverseUrl}?format=json&lat=${lat}&lon=${lng}&zoom=18&addressdetails=1`;
      const response = await fetch(url);
      if (!response.ok) throw new Error("Reverse geocode failed.");

      const data = await response.json();
      const parts = data.display_name.split(',');
      return {
        name: parts[0] || "Selected Location",
        address: data.display_name
      };
    } catch (err) {
      console.error("Reverse geocode error:", err);
      return {
        name: "Selected Location",
        address: `${lat.toFixed(4)}, ${lng.toFixed(4)}`
      };
    }
  }

  /**
   * Debounce helper
   */
  debounce(fn, delay = 350) {
    return (...args) => {
      clearTimeout(this.debounceTimer);
      this.debounceTimer = setTimeout(() => fn(...args), delay);
    };
  }
}

export const searchService = new SearchService();
