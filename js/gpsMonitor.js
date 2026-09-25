/**
 * GPS MONITOR & CONFIDENCE SYSTEM
 * Continuously tracks GPS availability, accuracy, update frequency, and signal timeouts.
 * Manages transitions between GPS_AVAILABLE, GPS_WEAK, GPS_UNAVAILABLE, and SENSOR_NAVIGATION.
 */

export const GPSState = {
  GPS_AVAILABLE: 'GPS_AVAILABLE',
  GPS_WEAK: 'GPS_WEAK',
  GPS_UNAVAILABLE: 'GPS_UNAVAILABLE',
  SENSOR_NAVIGATION: 'SENSOR_NAVIGATION'
};

class GPSMonitor {
  constructor() {
    this.currentState = GPSState.GPS_AVAILABLE;
    this.lastGpsTimestamp = 0;
    this.lastGpsAccuracy = 0;
    this.gpsTimeoutMs = 6000; // 6 seconds without update = lost GPS
    this.weakAccuracyThreshold = 25; // >25 meters = weak
    this.lostAccuracyThreshold = 60; // >60 meters = lost
    this.listeners = [];
    this.manualOverrideState = null; // Used for simulation/demo mode

    this.checkInterval = setInterval(() => this.evaluateState(), 1000);
  }

  updateGPSFix(position) {
    this.lastGpsTimestamp = Date.now();
    this.lastGpsAccuracy = position.accuracy || 10;
    this.evaluateState();
  }

  evaluateState() {
    if (this.manualOverrideState !== null) {
      this.setState(this.manualOverrideState);
      return;
    }

    const timeSinceLastFix = Date.now() - this.lastGpsTimestamp;

    if (this.lastGpsTimestamp === 0 || timeSinceLastFix > this.gpsTimeoutMs || this.lastGpsAccuracy > this.lostAccuracyThreshold) {
      this.setState(GPSState.SENSOR_NAVIGATION);
    } else if (this.lastGpsAccuracy > this.weakAccuracyThreshold) {
      this.setState(GPSState.GPS_WEAK);
    } else {
      this.setState(GPSState.GPS_AVAILABLE);
    }
  }

  setState(newState) {
    if (this.currentState !== newState) {
      this.currentState = newState;
      this.notifyListeners(newState);
    }
  }

  setManualOverride(state) {
    this.manualOverrideState = state;
    this.evaluateState();
  }

  onStateChange(callback) {
    this.listeners.push(callback);
  }

  notifyListeners(state) {
    this.listeners.forEach(cb => cb(state));
  }
}

export const gpsMonitor = new GPSMonitor();
