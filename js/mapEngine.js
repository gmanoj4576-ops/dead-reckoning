/**
 * APEX MAPS - MAP ENGINE MODULE
 * Manages Leaflet map instance, tile layers, markers, polylines, and camera views.
 */

/* global L */

class MapEngine {
  constructor() {
    this.map = null;
    this.tileLayers = {};
    this.activeTileStyle = 'satellite';
    
    // Markers & Overlays
    this.userLocationMarker = null;
    this.userAccuracyCircle = null;
    this.originMarker = null;
    this.destMarker = null;
    this.poiMarker = null;
    this.carNavMarker = null;
    this.routePolyline = null;
    this.routeBackgroundPolyline = null;
  }

  /**
   * Initialize Leaflet Map
   * @param {string} containerId 
   * @param {Array<number>} initialCoords [lat, lng]
   * @param {number} zoom 
   */
  init(containerId, initialCoords = [40.7128, -74.0060], zoom = 13) {
    this.map = L.map(containerId, {
      center: initialCoords,
      zoom: zoom,
      zoomControl: false, // We use custom zoom controls
      attributionControl: false
    });

    // Define Tile Layers
    this.tileLayers.streets = L.tileLayer(
      'https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png',
      { maxZoom: 19, subdomains: 'abcd' }
    );

    this.tileLayers.satellite = L.tileLayer(
      'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
      { maxZoom: 19 }
    );

    this.tileLayers.dark = L.tileLayer(
      'https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png',
      { maxZoom: 19, subdomains: 'abcd' }
    );

    this.tileLayers.topo = L.tileLayer(
      'https://{s}.tile.opentopomap.org/{z}/{x}/{y}.png',
      { maxZoom: 17 }
    );

    // Set Default Layer
    this.tileLayers.satellite.addTo(this.map);

    // Re-render map tiles correctly if container resizes
    setTimeout(() => this.map.invalidateSize(), 300);

    return this.map;
  }

  /**
   * Switch Active Map Layer
   * @param {string} style 'streets' | 'satellite' | 'dark' | 'topo'
   */
  setMapStyle(style) {
    if (!this.tileLayers[style] || this.activeTileStyle === style) return;

    this.map.removeLayer(this.tileLayers[this.activeTileStyle]);
    this.tileLayers[style].addTo(this.map);
    this.activeTileStyle = style;
  }

  /**
   * Update or Create User Location Marker
   * @param {number} lat 
   * @param {number} lng 
   * @param {number} accuracy Accuracy in meters
   */
  updateUserLocation(lat, lng, accuracy = 0) {
    const latLng = [lat, lng];

    if (!this.userLocationMarker) {
      const userIcon = L.divIcon({
        className: 'user-location-marker-wrapper',
        html: '<div class="user-location-marker"></div>',
        iconSize: [22, 22],
        iconAnchor: [11, 11]
      });

      this.userLocationMarker = L.marker(latLng, { icon: userIcon, zIndexOffset: 1000 }).addTo(this.map);
    } else {
      this.userLocationMarker.setLatLng(latLng);
    }

    // Accuracy circle
    if (accuracy > 0) {
      if (!this.userAccuracyCircle) {
        this.userAccuracyCircle = L.circle(latLng, {
          radius: accuracy,
          color: '#1a73e8',
          fillColor: '#1a73e8',
          fillOpacity: 0.12,
          weight: 1
        }).addTo(this.map);
      } else {
        this.userAccuracyCircle.setLatLng(latLng);
        this.userAccuracyCircle.setRadius(accuracy);
      }
    }
  }

  /**
   * Set Origin Marker (Green Pin)
   */
  setOriginMarker(lat, lng, label = "Origin") {
    if (this.originMarker) this.map.removeLayer(this.originMarker);

    const icon = L.divIcon({
      html: `<div style="color: #34a853; font-size: 2rem; filter: drop-shadow(0 2px 4px rgba(0,0,0,0.3));"><i class="fa-solid fa-location-dot"></i></div>`,
      iconSize: [30, 30],
      iconAnchor: [15, 30],
      className: 'custom-pin-icon'
    });

    this.originMarker = L.marker([lat, lng], { icon }).addTo(this.map).bindPopup(`<b>Start:</b> ${label}`);
  }

  /**
   * Set Destination Marker (Red Pin)
   */
  setDestinationMarker(lat, lng, label = "Destination") {
    if (this.destMarker) this.map.removeLayer(this.destMarker);

    const icon = L.divIcon({
      html: `<div style="color: #ea4335; font-size: 2.2rem; filter: drop-shadow(0 2px 4px rgba(0,0,0,0.3));"><i class="fa-solid fa-location-dot"></i></div>`,
      iconSize: [30, 30],
      iconAnchor: [15, 30],
      className: 'custom-pin-icon'
    });

    this.destMarker = L.marker([lat, lng], { icon }).addTo(this.map).bindPopup(`<b>Destination:</b> ${label}`);
  }

  /**
   * Set POI or Selected Search Marker (Purple Pin)
   */
  setPoiMarker(lat, lng, title, subtitle) {
    if (this.poiMarker) this.map.removeLayer(this.poiMarker);

    const icon = L.divIcon({
      html: `<div style="color: #1a73e8; font-size: 2.2rem; filter: drop-shadow(0 2px 6px rgba(0,0,0,0.4));"><i class="fa-solid fa-location-dot"></i></div>`,
      iconSize: [30, 30],
      iconAnchor: [15, 30],
      className: 'custom-pin-icon'
    });

    this.poiMarker = L.marker([lat, lng], { icon }).addTo(this.map);
  }

  /**
   * Update Car/Navigation Vehicle Marker
   */
  updateCarMarker(lat, lng, heading = 0) {
    const latLng = [lat, lng];

    if (!this.carNavMarker) {
      const carIcon = L.divIcon({
        html: `<div class="car-navigation-marker" style="transform: rotate(${heading}deg);"><i class="fa-solid fa-location-arrow"></i></div>`,
        iconSize: [36, 36],
        iconAnchor: [18, 18],
        className: 'car-icon-wrapper'
      });

      this.carNavMarker = L.marker(latLng, { icon: carIcon, zIndexOffset: 2000 }).addTo(this.map);
    } else {
      this.carNavMarker.setLatLng(latLng);
      const el = this.carNavMarker.getElement();
      if (el) {
        const inner = el.querySelector('.car-navigation-marker');
        if (inner) inner.style.transform = `rotate(${heading}deg)`;
      }
    }
  }

  removeCarMarker() {
    if (this.carNavMarker) {
      this.map.removeLayer(this.carNavMarker);
      this.carNavMarker = null;
    }
  }

  /**
   * Draw Polyline for Route
   * @param {Array<Array<number>>} coordinates Array of [lat, lng]
   */
  drawRoutePolyline(coordinates) {
    this.clearRoutePolyline();

    // Shadow outline polyline
    this.routeBackgroundPolyline = L.polyline(coordinates, {
      color: '#1557b0',
      weight: 9,
      opacity: 0.7,
      lineCap: 'round',
      lineJoin: 'round'
    }).addTo(this.map);

    // Main Google Maps style blue route line
    this.routePolyline = L.polyline(coordinates, {
      color: '#1a73e8',
      weight: 6,
      opacity: 1.0,
      lineCap: 'round',
      lineJoin: 'round'
    }).addTo(this.map);

    // Fit map bounds to show complete route
    this.map.fitBounds(this.routePolyline.getBounds(), { padding: [60, 60] });
  }

  clearRoutePolyline() {
    if (this.routePolyline) {
      this.map.removeLayer(this.routePolyline);
      this.routePolyline = null;
    }
    if (this.routeBackgroundPolyline) {
      this.map.removeLayer(this.routeBackgroundPolyline);
      this.routeBackgroundPolyline = null;
    }
  }

  /**
   * Pan camera to coordinates
   */
  panTo(lat, lng, zoom = null) {
    if (zoom) {
      this.map.setView([lat, lng], zoom, { animate: true, duration: 1.0 });
    } else {
      this.map.panTo([lat, lng], { animate: true, duration: 1.0 });
    }
  }

  zoomIn() {
    this.map.zoomIn();
  }

  zoomOut() {
    this.map.zoomOut();
  }
}

export const mapEngine = new MapEngine();
