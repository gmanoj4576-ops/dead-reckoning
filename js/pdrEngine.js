/**
 * PEDESTRIAN DEAD RECKONING (PDR) ENGINE
 * Performs step detection, adaptive step length estimation, heading tracking, and displacement updates.
 */

import { sensorCollector } from './sensorCollector.js';

class PDREngine {
  constructor() {
    this.currentPosition = null; // { lat, lng }
    this.currentHeading = 0;     // Degrees (0-360)
    
    // Step Detection States
    this.stepCount = 0;
    this.lastStepTimestamp = 0;
    this.minStepIntervalMs = 280; // Max ~3.5 steps/sec
    this.stepThreshold = 1.45;    // Acceleration peak threshold (m/s^2)
    this.recentAccelWindow = [];
    this.windowSize = 10;
    this.calibrationK = 0.42;     // Weinberg step length parameter

    this.stepListeners = [];
  }

  setInitialPosition(lat, lng, heading = 0) {
    this.currentPosition = { lat, lng };
    this.currentHeading = heading;
  }

  init() {
    sensorCollector.onSensorData((data) => this.processSensorFrame(data));
  }

  processSensorFrame(data) {
    if (!this.currentPosition) return;

    const mag = data.filteredAccel.magnitude;
    const now = Date.now();

    // Maintain sliding window of acceleration for peak-to-peak step estimation
    this.recentAccelWindow.push(mag);
    if (this.recentAccelWindow.length > this.windowSize) {
      this.recentAccelWindow.shift();
    }

    // Update Heading from orientation sensor
    if (data.orientation.heading) {
      this.currentHeading = data.orientation.heading;
    }

    // Step Peak Detection Logic
    if (mag > this.stepThreshold && (now - this.lastStepTimestamp) > this.minStepIntervalMs) {
      // Confirm peak is local maximum
      const isPeak = this.recentAccelWindow.length >= 3 && 
                     mag >= this.recentAccelWindow[this.recentAccelWindow.length - 2];

      if (isPeak) {
        this.lastStepTimestamp = now;
        this.stepCount++;

        // Calculate Adaptive Step Length (Weinberg Model: K * (a_max - a_min)^(1/4))
        const aMax = Math.max(...this.recentAccelWindow);
        const aMin = Math.min(...this.recentAccelWindow);
        const deltaA = Math.max(0.1, aMax - aMin);
        const stepLength = this.calibrationK * Math.pow(deltaA, 0.25);

        // Dead Reckoning Position Update
        this.updatePositionFromStep(stepLength, this.currentHeading);

        this.notifyStep(stepLength, this.currentHeading);
      }
    }
  }

  /**
   * Update lat/lng based on step displacement
   * @param {number} stepLength Meters
   * @param {number} headingDeg Degrees
   */
  updatePositionFromStep(stepLength, headingDeg) {
    const headingRad = (headingDeg * Math.PI) / 180;
    const deltaNorth = stepLength * Math.cos(headingRad);
    const deltaEast = stepLength * Math.sin(headingRad);

    const R_earth = 6378137; // Earth radius in meters
    const deltaLat = (deltaNorth / R_earth) * (180 / Math.PI);
    const deltaLng = (deltaEast / (R_earth * Math.cos(this.currentPosition.lat * Math.PI / 180))) * (180 / Math.PI);

    this.currentPosition = {
      lat: this.currentPosition.lat + deltaLat,
      lng: this.currentPosition.lng + deltaLng
    };
  }

  onStep(callback) {
    this.stepListeners.push(callback);
  }

  notifyStep(stepLength, heading) {
    this.stepListeners.forEach(cb => cb({
      stepCount: this.stepCount,
      stepLength: stepLength,
      heading: heading,
      position: { ...this.currentPosition }
    }));
  }
}

export const pdrEngine = new PDREngine();
