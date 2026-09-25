/**
 * APEX MAPS - NAVIGATION ENGINE MODULE
 * Manages active turn-by-turn navigation HUD, speech synthesis, and route simulation driver.
 */

import { mapEngine } from './mapEngine.js';

class NavigationEngine {
  constructor() {
    this.isActive = false;
    this.isSimulating = false;
    this.isPaused = false;
    this.voiceMuted = false;

    this.routeData = null;
    this.polyline = [];
    this.steps = [];
    
    this.currentStepIdx = 0;
    this.simPointIdx = 0;
    this.simSpeedMultiplier = 1; // 1x, 2x, 4x
    this.simInterval = null;

    this.speechSynth = window.speechSynthesis || null;
    this.lastSpokenStepIdx = -1;

    // UI elements
    this.hudOverlay = null;
    this.turnIconEl = null;
    this.turnDistEl = null;
    this.turnInstructionEl = null;
    this.timeRemainEl = null;
    this.distRemainEl = null;
    this.speedValEl = null;
    this.etaTimeEl = null;
    this.simControlBar = null;
    this.speedSimBtn = null;
  }

  initUIElements() {
    this.hudOverlay = document.getElementById('navHudOverlay');
    this.turnIconEl = document.getElementById('navTurnIcon');
    this.turnDistEl = document.getElementById('navTurnDist');
    this.turnInstructionEl = document.getElementById('navTurnInstruction');
    this.timeRemainEl = document.getElementById('navTimeRemain');
    this.distRemainEl = document.getElementById('navDistRemain');
    this.speedValEl = document.getElementById('navSpeedVal');
    this.etaTimeEl = document.getElementById('navEtaTime');
    this.simControlBar = document.getElementById('simControlBar');
    this.speedSimBtn = document.getElementById('btnSpeedSim');
  }

  /**
   * Start Active Navigation
   * @param {Object} routeData 
   * @param {boolean} simulate If true, run smooth simulated driving animation
   */
  startNavigation(routeData, simulate = false) {
    this.initUIElements();
    this.routeData = routeData;
    this.polyline = routeData.polyline; // Array of [lat, lng]
    this.steps = routeData.steps;

    this.isActive = true;
    this.isSimulating = simulate;
    this.isPaused = false;
    this.currentStepIdx = 0;
    this.simPointIdx = 0;
    this.lastSpokenStepIdx = -1;

    // Show HUD Overlay
    this.hudOverlay.classList.remove('hidden');
    
    if (simulate) {
      this.simControlBar.classList.remove('hidden');
      this.startSimulationDriver();
    } else {
      this.simControlBar.classList.add('hidden');
    }

    // Initial Voice Welcome
    this.speak("Starting navigation. Follow the highlighted route.");

    this.updateHUD(this.polyline[0], 0);
  }

  /**
   * Run Simulated Driving Animation along the polyline
   */
  startSimulationDriver() {
    this.stopSimulationDriver();

    const updateIntervalMs = 250;

    this.simInterval = setInterval(() => {
      if (this.isPaused || !this.isActive) return;

      if (this.simPointIdx >= this.polyline.length - 1) {
        // Arrived at destination!
        this.arriveAtDestination();
        return;
      }

      const currentPos = this.polyline[this.simPointIdx];
      const nextPos = this.polyline[this.simPointIdx + 1];

      // Calculate bearing / heading angle
      const heading = this.calculateHeading(currentPos, nextPos);

      // Move car marker on map
      mapEngine.updateCarMarker(currentPos[0], currentPos[1], heading);
      mapEngine.panTo(currentPos[0], currentPos[1]);

      // Calculate simulated speed
      const baseSpeed = 45; // 45 km/h base driving speed
      const actualSpeed = Math.round(baseSpeed * this.simSpeedMultiplier);
      this.speedValEl.textContent = actualSpeed;

      // Update HUD stats & current step
      this.updateHUD(currentPos, this.simPointIdx);

      // Advance point index according to speed multiplier
      this.simPointIdx += 1 * this.simSpeedMultiplier;
      if (this.simPointIdx >= this.polyline.length) {
        this.simPointIdx = this.polyline.length - 1;
      }
    }, updateIntervalMs);
  }

  stopSimulationDriver() {
    if (this.simInterval) {
      clearInterval(this.simInterval);
      this.simInterval = null;
    }
  }

  togglePauseSim() {
    this.isPaused = !this.isPaused;
    const btn = document.getElementById('btnPauseSim');
    if (btn) {
      btn.innerHTML = this.isPaused ? '<i class="fa-solid fa-play"></i>' : '<i class="fa-solid fa-pause"></i>';
    }
  }

  cycleSpeedSim() {
    if (this.simSpeedMultiplier === 1) this.simSpeedMultiplier = 2;
    else if (this.simSpeedMultiplier === 2) this.simSpeedMultiplier = 4;
    else this.simSpeedMultiplier = 1;

    if (this.speedSimBtn) {
      this.speedSimBtn.textContent = `${this.simSpeedMultiplier}x`;
    }
  }

  /**
   * Update HUD Banner and Speech Voice according to progress
   */
  updateHUD(currentLatCol, pointIdx) {
    if (!this.steps || this.steps.length === 0) return;

    // Estimate remaining steps
    const totalPoints = this.polyline.length;
    const fractionRemaining = 1 - (pointIdx / Math.max(1, totalPoints));

    const totalDistMeters = this.routeData.distance;
    const remainingMeters = Math.round(totalDistMeters * fractionRemaining);

    const totalSecs = this.routeData.duration;
    const remainingSecs = Math.round(totalSecs * fractionRemaining / Math.max(1, this.simSpeedMultiplier));

    // Format Remaining Distance & Duration
    this.distRemainEl.textContent = remainingMeters < 1000 ? `${remainingMeters} m` : `${(remainingMeters/1000).toFixed(1)} km`;
    
    const mins = Math.round(remainingSecs / 60);
    this.timeRemainEl.textContent = mins < 60 ? `${mins} min` : `${Math.floor(mins/60)}h ${mins%60}m`;

    // Compute ETA time
    const etaDate = new Date(Date.now() + remainingSecs * 1000);
    const etaStr = etaDate.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    this.etaTimeEl.textContent = `ETA ${etaStr}`;

    // Find current maneuver step
    let targetStep = this.steps[this.currentStepIdx];
    for (let i = this.currentStepIdx; i < this.steps.length; i++) {
      const stepPos = this.steps[i].location;
      const distToStep = this.distanceBetween(currentLatCol, stepPos);
      if (distToStep < 80 && i > this.currentStepIdx) {
        this.currentStepIdx = i;
        targetStep = this.steps[i];
        break;
      }
    }

    if (targetStep) {
      this.turnInstructionEl.textContent = targetStep.instruction;
      this.turnIconEl.className = targetStep.icon + " turn-icon";

      const distToNextStep = this.distanceBetween(currentLatCol, targetStep.location);
      this.turnDistEl.textContent = distToNextStep < 1000 ? `In ${Math.round(distToNextStep)} m` : `In ${(distToNextStep/1000).toFixed(1)} km`;

      // Voice prompt trigger
      if (distToNextStep < 150 && this.lastSpokenStepIdx !== this.currentStepIdx) {
        this.lastSpokenStepIdx = this.currentStepIdx;
        this.speak(targetStep.instruction);
      }
    }
  }

  arriveAtDestination() {
    this.stopSimulationDriver();
    this.speak("You have arrived at your destination!");
    this.turnInstructionEl.textContent = "You have arrived at your destination!";
    this.turnDistEl.textContent = "Arrived";
    this.turnIconEl.className = "fa-solid fa-flag-checkered turn-icon";
    this.speedValEl.textContent = 0;
    this.timeRemainEl.textContent = "0 min";
    this.distRemainEl.textContent = "0 m";
  }

  stopNavigation() {
    this.isActive = false;
    this.stopSimulationDriver();
    mapEngine.removeCarMarker();
    if (this.hudOverlay) this.hudOverlay.classList.add('hidden');
    if (this.speechSynth) this.speechSynth.cancel();
  }

  speak(text) {
    if (this.voiceMuted || !this.speechSynth) return;
    try {
      this.speechSynth.cancel(); // Cancel previous speech
      const utterance = new SpeechSynthesisUtterance(text);
      utterance.rate = 1.0;
      utterance.pitch = 1.0;
      this.speechSynth.speak(utterance);
    } catch (e) {
      console.warn("Speech synthesis error:", e);
    }
  }

  toggleVoice() {
    this.voiceMuted = !this.voiceMuted;
    const icon = document.getElementById('voiceIcon');
    if (icon) {
      icon.className = this.voiceMuted ? 'fa-solid fa-volume-xmark' : 'fa-solid fa-volume-high';
    }
  }

  /**
   * Distance formula between two [lat, lng] points in meters (Haversine)
   */
  distanceBetween(p1, p2) {
    const R = 6371000;
    const dLat = (p2[0] - p1[0]) * Math.PI / 180;
    const dLng = (p2[1] - p1[1]) * Math.PI / 180;
    const a = Math.sin(dLat/2) * Math.sin(dLat/2) +
              Math.cos(p1[0] * Math.PI / 180) * Math.cos(p2[0] * Math.PI / 180) *
              Math.sin(dLng/2) * Math.sin(dLng/2);
    return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
  }

  calculateHeading(p1, p2) {
    const dLng = (p2[1] - p1[1]) * Math.PI / 180;
    const lat1 = p1[0] * Math.PI / 180;
    const lat2 = p2[0] * Math.PI / 180;
    const y = Math.sin(dLng) * Math.cos(lat2);
    const x = Math.cos(lat1) * Math.sin(lat2) - Math.sin(lat1) * Math.cos(lat2) * Math.cos(dLng);
    return (Math.atan2(y, x) * 180 / Math.PI + 360) % 360;
  }
}

export const navigationEngine = new NavigationEngine();
