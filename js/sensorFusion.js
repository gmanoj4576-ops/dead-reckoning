/**
 * KALMAN FILTER SENSOR FUSION & CONFIDENCE ENGINE
 * Fuses GPS observations with PDR dead reckoning, IMU orientation, and ML corrections.
 * Computes state covariance to generate realistic Navigation Confidence Score (%).
 */

import { gpsMonitor, GPSState } from './gpsMonitor.js';

class SensorFusion {
  constructor() {
    this.fusedState = {
      lat: 0,
      lng: 0,
      heading: 0,
      speed: 0
    };
    
    // Covariance / Uncertainty Estimate (Meters variance)
    this.positionVariance = 2.0; 
    this.maxAllowedVariance = 45.0;
    this.lastUpdateTimestamp = Date.now();
    this.listeners = [];
  }

  setInitialFix(lat, lng, heading = 0) {
    this.fusedState.lat = lat;
    this.fusedState.lng = lng;
    this.fusedState.heading = heading;
    this.positionVariance = 2.0;
    this.emitState();
  }

  /**
   * Process GPS update (Kalman Observation Update)
   */
  processGPSFix(gpsPos) {
    const accuracy = gpsPos.accuracy || 8;
    const currentState = gpsMonitor.currentState;

    if (currentState === GPSState.GPS_AVAILABLE) {
      // Direct high-confidence GPS update to prevent map location lag or wrong location freeze
      this.fusedState.lat = gpsPos.lat;
      this.fusedState.lng = gpsPos.lng;
      this.positionVariance = Math.max(1.0, accuracy);
    } else if (currentState === GPSState.GPS_WEAK) {
      const R = accuracy * accuracy;
      const K = Math.max(0.4, this.positionVariance / (this.positionVariance + R));
      this.fusedState.lat += K * (gpsPos.lat - this.fusedState.lat);
      this.fusedState.lng += K * (gpsPos.lng - this.fusedState.lng);
      this.positionVariance = (1 - K) * this.positionVariance;
    }

    this.lastUpdateTimestamp = Date.now();
    this.emitState();
  }

  /**
   * Process PDR + ML Step update (Prediction Update when GPS is lost)
   * @param {{stepLength: number, heading: number, mlConfidence: number}} pdrPrediction 
   */
  processPDRStep(pdrPrediction) {
    const { stepLength, heading, mlConfidence } = pdrPrediction;

    const headingRad = (heading * Math.PI) / 180;
    const deltaNorth = stepLength * Math.cos(headingRad);
    const deltaEast = stepLength * Math.sin(headingRad);

    const R_earth = 6378137;
    const deltaLat = (deltaNorth / R_earth) * (180 / Math.PI);
    const deltaLng = (deltaEast / (R_earth * Math.cos(this.fusedState.lat * Math.PI / 180))) * (180 / Math.PI);

    // Predict state
    this.fusedState.lat += deltaLat;
    this.fusedState.lng += deltaLng;
    this.fusedState.heading = heading;

    // Process noise accumulation Q during dead reckoning
    const processNoiseQ = (0.15 * stepLength) / (mlConfidence || 0.8);
    this.positionVariance += processNoiseQ;

    this.lastUpdateTimestamp = Date.now();
    this.emitState();
  }

  /**
   * Calculate Navigation Confidence Percentage (0% - 100%)
   */
  getConfidenceScore() {
    const currentState = gpsMonitor.currentState;

    if (currentState === GPSState.GPS_AVAILABLE) {
      return 98;
    }

    // Exponential decay of confidence based on covariance variance
    const confidence = Math.max(15, Math.round(100 * Math.exp(-this.positionVariance / 20.0)));

    if (currentState === GPSState.GPS_WEAK) {
      return Math.min(75, confidence);
    }

    return confidence; // SENSOR_NAVIGATION mode
  }

  onFusedUpdate(callback) {
    this.listeners.push(callback);
  }

  emitState() {
    const payload = {
      position: { lat: this.fusedState.lat, lng: this.fusedState.lng },
      heading: this.fusedState.heading,
      confidence: this.getConfidenceScore(),
      variance: this.positionVariance
    };
    this.listeners.forEach(cb => cb(payload));
  }
}

export const sensorFusion = new SensorFusion();
