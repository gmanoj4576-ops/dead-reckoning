/**
 * MAP MATCHING ENGINE
 * Projects raw estimated sensor/PDR coordinates onto the nearest polyline segment of the active route.
 * Preserves route constraints inside tunnels and underground corridors.
 */

class MapMatching {
  constructor() {
    this.activePolyline = null; // Array of [lat, lng]
    this.snapThresholdMeters = 35; // Max distance to snap to polyline
  }

  setRoutePolyline(polyline) {
    this.activePolyline = polyline;
  }

  /**
   * Snap candidate coordinate to active route polyline
   * @param {{lat: number, lng: number}} candidate 
   * @returns {{lat: number, lng: number, isSnapped: boolean, segmentIndex: number}}
   */
  snapToRoute(candidate) {
    if (!this.activePolyline || this.activePolyline.length < 2) {
      return { ...candidate, isSnapped: false, segmentIndex: -1 };
    }

    let minDistance = Infinity;
    let closestPoint = { lat: candidate.lat, lng: candidate.lng };
    let bestSegmentIdx = -1;

    for (let i = 0; i < this.activePolyline.length - 1; i++) {
      const p1 = { lat: this.activePolyline[i][0], lng: this.activePolyline[i][1] };
      const p2 = { lat: this.activePolyline[i+1][0], lng: this.activePolyline[i+1][1] };

      const projected = this.getClosestPointOnSegment(candidate, p1, p2);
      const dist = this.distanceMeters(candidate, projected);

      if (dist < minDistance) {
        minDistance = dist;
        closestPoint = projected;
        bestSegmentIdx = i;
      }
    }

    // Only snap if within acceptable threshold
    if (minDistance <= this.snapThresholdMeters) {
      return {
        lat: closestPoint.lat,
        lng: closestPoint.lng,
        isSnapped: true,
        segmentIndex: bestSegmentIdx,
        offsetDistance: minDistance
      };
    }

    return { ...candidate, isSnapped: false, segmentIndex: -1, offsetDistance: minDistance };
  }

  getClosestPointOnSegment(p, a, b) {
    const l2 = Math.pow(a.lat - b.lat, 2) + Math.pow(a.lng - b.lng, 2);
    if (l2 === 0) return a;

    let t = ((p.lat - a.lat) * (b.lat - a.lat) + (p.lng - a.lng) * (b.lng - a.lng)) / l2;
    t = Math.max(0, Math.min(1, t));

    return {
      lat: a.lat + t * (b.lat - a.lat),
      lng: a.lng + t * (b.lng - a.lng)
    };
  }

  distanceMeters(p1, p2) {
    const R = 6371000;
    const dLat = (p2.lat - p1.lat) * Math.PI / 180;
    const dLng = (p2.lng - p1.lng) * Math.PI / 180;
    const a = Math.sin(dLat/2) * Math.sin(dLat/2) +
              Math.cos(p1.lat * Math.PI / 180) * Math.cos(p2.lat * Math.PI / 180) *
              Math.sin(dLng/2) * Math.sin(dLng/2);
    return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
  }
}

export const mapMatching = new MapMatching();
