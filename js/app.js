/**
 * APEX MAPS - MAIN APPLICATION COORDINATOR (WITH REAL GPS SYNC & AUTO SENSOR TRACKING)
 * Integrates Leaflet Map, Geolocation, IMU Sensors, PDR Engine, ML Predictor,
 * Kalman Sensor Fusion, Route Map Matching, and Touch Auto-Activation.
 */

import { mapEngine } from './mapEngine.js';
import { locationService } from './locationService.js';
import { searchService } from './searchService.js';
import { routingService } from './routingService.js';
import { navigationEngine } from './navigationEngine.js';

// GPS-Denied AI Navigation Modules
import { gpsMonitor, GPSState } from './gpsMonitor.js';
import { sensorCollector } from './sensorCollector.js';
import { pdrEngine } from './pdrEngine.js';
import { mlPredictor } from './mlPredictor.js';
import { sensorFusion } from './sensorFusion.js';
import { mapMatching } from './mapMatching.js';

class ApexMapsApp {
  constructor() {
    this.userCoords = null;
    this.originCoords = null;
    this.destCoords = null;
    this.selectedTravelMode = 'driving';
    this.currentActiveRoute = null;
    this.selectedPlaceInfo = null;
    this.savedPlaces = JSON.parse(localStorage.getItem('apex_saved_places') || '[]');

    this.isLoggingTrajectory = false;
    this.trajectoryLogs = [];
  }

  async init() {
    // 1. Map Engine
    const map = mapEngine.init('map');

    // 2. ML Predictor Model
    await mlPredictor.loadModel();

    // 3. Sensor Collector & PDR
    sensorCollector.init();
    pdrEngine.init();

    // 4. Request Initial Real Location with Progressive Retries
    this.syncRealLocation();

    // 5. Connect Pipelines & Sensor Panels
    this.setupNavigationPipeline();

    // 6. Bind Events
    this.bindEvents();
    this.renderSavedPlaces();
  }

  async syncRealLocation() {
    this.showToast("Acquiring real location...");

    try {
      const pos = await locationService.getCurrentLocation();
      this.userCoords = pos;
      
      // Sync all engines to user's REAL physical location
      gpsMonitor.updateGPSFix(pos);
      sensorFusion.setInitialFix(pos.lat, pos.lng);
      pdrEngine.setInitialPosition(pos.lat, pos.lng);

      mapEngine.updateUserLocation(pos.lat, pos.lng, pos.accuracy);
      mapEngine.panTo(pos.lat, pos.lng, 16);

      if (pos.name && pos.name !== 'Default City') {
        this.showToast(`Location Synced: ${pos.name}`);
      } else {
        this.showToast("GPS Location Synced!");
      }

      // Start continuous real-time GPS tracking
      locationService.startTracking((updatedPos) => {
        const wasIpFallback = this.userCoords && this.userCoords.accuracy > 1000;
        this.userCoords = updatedPos;
        gpsMonitor.updateGPSFix(updatedPos);

        if (wasIpFallback && updatedPos.accuracy && updatedPos.accuracy < 1000) {
          mapEngine.panTo(updatedPos.lat, updatedPos.lng, 16);
          this.showToast("High Accuracy GPS Lock Acquired!");
        }

        if (gpsMonitor.currentState === GPSState.GPS_AVAILABLE || gpsMonitor.currentState === GPSState.GPS_WEAK) {
          sensorFusion.processGPSFix(updatedPos);
        }
      });
    } catch (e) {
      console.warn("Location initial fix error:", e);
    }
  }

  setupNavigationPipeline() {
    // A. GPS Monitor
    gpsMonitor.onStateChange((newState) => {
      this.updateGPSBadge(newState);
      this.showToast(`Navigation mode: ${newState.replace('_', ' ')}`);
    });

    // B. IMU Sensor Frame -> Telemetry Panel
    sensorCollector.onSensorData((frame) => {
      mlPredictor.addFrame(frame);
      this.updateRightSensorPanel(frame);
      this.updateDebugTelemetry(frame);

      if (this.isLoggingTrajectory) {
        this.logTrajectoryFrame(frame);
      }
    });

    // C. PDR Step Event
    pdrEngine.onStep((stepEvent) => {
      const correction = mlPredictor.predictCorrection(stepEvent.stepLength, stepEvent.heading);

      sensorFusion.processPDRStep({
        stepLength: correction.correctedStepLength,
        heading: correction.correctedHeading,
        mlConfidence: correction.mlConfidence
      });

      document.getElementById('pdrStepCount').textContent = stepEvent.stepCount;
      document.getElementById('pdrStepLen').textContent = `${correction.correctedStepLength.toFixed(2)} m`;
    });

    // D. Sensor Fusion Update -> Map & Navigation UI
    sensorFusion.onFusedUpdate((fusedState) => {
      let finalPos = fusedState.position;
      let isMapMatched = false;

      if (this.currentActiveRoute && this.currentActiveRoute.polyline) {
        const snap = mapMatching.snapToRoute(finalPos);
        if (snap.isSnapped) {
          finalPos = { lat: snap.lat, lng: snap.lng };
          isMapMatched = true;
        }
      }

      mapEngine.updateUserLocation(finalPos.lat, finalPos.lng, fusedState.variance);

      if (navigationEngine.isActive && gpsMonitor.currentState === GPSState.SENSOR_NAVIGATION) {
        navigationEngine.updateHUD([finalPos.lat, finalPos.lng], 0);
      }

      document.getElementById('teleFusedPos').textContent = `${finalPos.lat.toFixed(5)}, ${finalPos.lng.toFixed(5)}`;
      document.getElementById('teleConfidence').textContent = `${fusedState.confidence}%`;
      document.getElementById('teleMapMatched').textContent = isMapMatched ? "YES (Snapped)" : "No";
    });
  }

  updateRightSensorPanel(frame) {
    const heading = frame.orientation.heading || 0;
    const turnDelta = frame.turnAngleDelta || 0;
    const accelMs = frame.accelSpeedMs || 0;
    const accelKmh = (accelMs * 3.6).toFixed(1);

    // Hardware Badges
    const hw = frame.activeHardware || {};
    const hwGyroEl = document.getElementById('hwGyro');
    const hwAccelEl = document.getElementById('hwAccel');
    const hwOrientEl = document.getElementById('hwOrient');

    if (hwGyroEl) {
      hwGyroEl.textContent = hw.gyroscope ? 'ACTIVE' : 'SEEKING';
      hwGyroEl.className = `badge-status ${hw.gyroscope ? 'active' : 'seeking'}`;
    }
    if (hwAccelEl) {
      hwAccelEl.textContent = hw.accelerometer ? 'ACTIVE' : 'SEEKING';
      hwAccelEl.className = `badge-status ${hw.accelerometer ? 'active' : 'seeking'}`;
    }
    if (hwOrientEl) {
      hwOrientEl.textContent = hw.orientation ? 'ACTIVE' : 'SEEKING';
      hwOrientEl.className = `badge-status ${hw.orientation ? 'active' : 'seeking'}`;
    }

    const arrow = document.getElementById('compassArrow');
    if (arrow) arrow.style.transform = `rotate(${heading}deg)`;

    const turnText = document.getElementById('turnAngleText');
    if (turnText) {
      const dir = turnDelta >= 0 ? 'Right' : 'Left';
      turnText.textContent = `Turned: ${Math.abs(Math.round(turnDelta))}° ${dir}`;
    }

    const headingText = document.getElementById('headingText');
    if (headingText) {
      headingText.textContent = `Heading: ${Math.round(heading)}° (${this.getCardinalDirection(heading)})`;
    }

    document.getElementById('pitchVal').textContent = `${Math.round(frame.orientation.beta || 0)}°`;
    document.getElementById('rollVal').textContent = `${Math.round(frame.orientation.gamma || 0)}°`;

    document.getElementById('accelSpeedVal').textContent = accelKmh;
    document.getElementById('accelSpeedMs').textContent = accelMs.toFixed(1);
    document.getElementById('accelX').textContent = (Number(frame.accel.x) || 0).toFixed(2);
    document.getElementById('accelY').textContent = (Number(frame.accel.y) || 0).toFixed(2);
    document.getElementById('accelZ').textContent = (Number(frame.accel.z) || 9.81).toFixed(2);
    document.getElementById('accelMag').textContent = (Number(frame.filteredAccel.magnitude) || 0).toFixed(2);

    document.getElementById('gyroX').textContent = (Number(frame.gyro.x) || 0).toFixed(1);
    document.getElementById('gyroY').textContent = (Number(frame.gyro.y) || 0).toFixed(1);
    document.getElementById('gyroZ').textContent = (Number(frame.gyro.z) || 0).toFixed(1);

    document.getElementById('magX').textContent = frame.mag.x || '21.5';
    document.getElementById('magY').textContent = frame.mag.y || '-42.1';
    document.getElementById('magZ').textContent = frame.mag.z || '-12.3';
  }

  getCardinalDirection(deg) {
    const dirs = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];
    return dirs[Math.round(deg / 45) % 8];
  }

  updateGPSBadge(state) {
    const badge = document.getElementById('gpsStatusBadge');
    const title = document.getElementById('gpsStatusText');
    const conf = document.getElementById('gpsConfidenceText');

    badge.className = 'gps-status-badge';

    if (state === GPSState.GPS_AVAILABLE) {
      badge.classList.add('gps-available');
      title.textContent = '🟢 GPS Navigation';
      conf.textContent = 'Confidence 98%';
    } else if (state === GPSState.GPS_WEAK) {
      badge.classList.add('gps-weak');
      title.textContent = '🟡 GPS Weak';
      conf.textContent = 'Confidence 65%';
    } else {
      badge.classList.add('sensor-nav');
      title.textContent = '🔵 AI Sensor Nav';
      conf.textContent = `Confidence ${sensorFusion.getConfidenceScore()}%`;
    }

    document.getElementById('teleGpsState').textContent = state;
    document.getElementById('teleNavMode').textContent = state === GPSState.GPS_AVAILABLE ? "GPS" : "AI SENSOR (PDR+EKF)";
  }

  updateDebugTelemetry(frame) {
    document.getElementById('teleSteps').textContent = pdrEngine.stepCount;
    document.getElementById('teleHeading').textContent = `${Math.round(pdrEngine.currentHeading)}°`;
    document.getElementById('teleAccel').textContent = `${frame.filteredAccel.magnitude.toFixed(2)} m/s²`;
    document.getElementById('teleGyro').textContent = `${(frame.gyro.x || 0).toFixed(2)} rad/s`;
  }

  bindEvents() {
    // Permission Buttons
    const btnGrantGps = document.getElementById('btnGrantGps');
    const btnGrantSensors = document.getElementById('btnGrantSensors');
    const mobilePermBanner = document.getElementById('mobilePermBanner');

    if (btnGrantGps) {
      btnGrantGps.addEventListener('click', () => {
        this.syncRealLocation();
      });
    }

    if (btnGrantSensors) {
      btnGrantSensors.addEventListener('click', async () => {
        const granted = await sensorCollector.requestPermissions();
        if (granted) {
          this.showToast("Motion Sensors Enabled!");
          if (mobilePermBanner) mobilePermBanner.style.display = 'none';
        } else {
          this.showToast("Motion sensor permission denied.");
        }
      });
    }

    // Right Sensor Panel Toggle
    const sensorPanel = document.getElementById('sensorRightPanel');
    const btnToggleSensorPanel = document.getElementById('btnToggleSensorPanel');
    const sensorPanelIcon = document.getElementById('sensorPanelIcon');

    btnToggleSensorPanel.addEventListener('click', () => {
      sensorPanel.classList.toggle('collapsed');
      sensorPanelIcon.className = sensorPanel.classList.contains('collapsed')
        ? 'fa-solid fa-chevron-left'
        : 'fa-solid fa-chevron-right';
    });

    // Search & Autocomplete
    const searchInput = document.getElementById('searchInput');
    const searchSuggestions = document.getElementById('searchSuggestions');
    const btnClearSearch = document.getElementById('btnClearSearch');

    const debouncedSearch = searchService.debounce(async (query) => {
      if (!query.trim()) {
        searchSuggestions.classList.add('hidden');
        btnClearSearch.classList.add('hidden');
        return;
      }
      btnClearSearch.classList.remove('hidden');

      const results = await searchService.searchPlaces(query);
      this.renderSuggestions(results, searchSuggestions, (item) => {
        this.selectSearchResult(item);
      });
    }, 300);

    searchInput.addEventListener('input', (e) => debouncedSearch(e.target.value));

    btnClearSearch.addEventListener('click', () => {
      searchInput.value = '';
      searchSuggestions.classList.add('hidden');
      btnClearSearch.classList.add('hidden');
    });

    // Sidebar Directions Drawer
    const sidebarPanel = document.getElementById('sidebarPanel');
    document.getElementById('btnToggleSidebar').addEventListener('click', () => sidebarPanel.classList.toggle('hidden'));
    document.getElementById('btnCloseSidebar').addEventListener('click', () => sidebarPanel.classList.add('hidden'));
    document.getElementById('btnOpenDirections').addEventListener('click', () => {
      sidebarPanel.classList.remove('hidden');
      if (this.userCoords && !this.originCoords) {
        document.getElementById('originInput').value = "My Location";
        this.originCoords = { lat: this.userCoords.lat, lng: this.userCoords.lng, name: "My Location" };
      }
    });

    // Category Chips
    document.querySelectorAll('.chip-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        searchInput.value = btn.getAttribute('data-category');
        searchInput.dispatchEvent(new Event('input'));
      });
    });

    // Travel Modes
    document.querySelectorAll('.mode-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        document.querySelectorAll('.mode-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        this.selectedTravelMode = btn.getAttribute('data-mode');
        if (this.originCoords && this.destCoords) this.calculateAndDisplayRoute();
      });
    });

    // Origin / Destination Inputs
    const originInput = document.getElementById('originInput');
    const destInput = document.getElementById('destInput');
    const originSuggestions = document.getElementById('originSuggestions');
    const destSuggestions = document.getElementById('destSuggestions');

    const debouncedOrigin = searchService.debounce(async (q) => {
      if (!q.trim()) return originSuggestions.classList.add('hidden');
      const results = await searchService.searchPlaces(q);
      this.renderSuggestions(results, originSuggestions, (item) => {
        originInput.value = item.name;
        this.originCoords = item;
        originSuggestions.classList.add('hidden');
        mapEngine.setOriginMarker(item.lat, item.lng, item.name);
        if (this.destCoords) this.calculateAndDisplayRoute();
      });
    }, 300);

    const debouncedDest = searchService.debounce(async (q) => {
      if (!q.trim()) return destSuggestions.classList.add('hidden');
      const results = await searchService.searchPlaces(q);
      this.renderSuggestions(results, destSuggestions, (item) => {
        destInput.value = item.name;
        this.destCoords = item;
        destSuggestions.classList.add('hidden');
        mapEngine.setDestinationMarker(item.lat, item.lng, item.name);
        if (this.originCoords) this.calculateAndDisplayRoute();
      });
    }, 300);

    originInput.addEventListener('input', (e) => debouncedOrigin(e.target.value));
    destInput.addEventListener('input', (e) => debouncedDest(e.target.value));

    document.getElementById('btnUseMyLocation').addEventListener('click', () => {
      this.syncRealLocation();
      if (this.userCoords) {
        originInput.value = "My Location";
        this.originCoords = { lat: this.userCoords.lat, lng: this.userCoords.lng, name: "My Location" };
        mapEngine.setOriginMarker(this.userCoords.lat, this.userCoords.lng, "My Location");
        if (this.destCoords) this.calculateAndDisplayRoute();
      }
    });

    document.getElementById('btnSwapLocations').addEventListener('click', () => {
      const tempVal = originInput.value;
      originInput.value = destInput.value;
      destInput.value = tempVal;

      const tempCoords = this.originCoords;
      this.originCoords = this.destCoords;
      this.destCoords = tempCoords;

      if (this.originCoords) mapEngine.setOriginMarker(this.originCoords.lat, this.originCoords.lng, this.originCoords.name);
      if (this.destCoords) mapEngine.setDestinationMarker(this.destCoords.lat, this.destCoords.lng, this.destCoords.name);

      if (this.originCoords && this.destCoords) this.calculateAndDisplayRoute();
    });

    // Start Navigation / Demo
    document.getElementById('btnStartNav').addEventListener('click', () => {
      if (this.currentActiveRoute) {
        sidebarPanel.classList.add('hidden');
        navigationEngine.startNavigation(this.currentActiveRoute, false);
      }
    });

    document.getElementById('btnSimulateNav').addEventListener('click', () => {
      if (this.currentActiveRoute) {
        sidebarPanel.classList.add('hidden');
        navigationEngine.startNavigation(this.currentActiveRoute, true);
      }
    });

    document.getElementById('btnExitNav').addEventListener('click', () => {
      navigationEngine.stopNavigation();
      sidebarPanel.classList.remove('hidden');
    });

    document.getElementById('btnToggleVoice').addEventListener('click', () => navigationEngine.toggleVoice());
    document.getElementById('btnPauseSim').addEventListener('click', () => navigationEngine.togglePauseSim());
    document.getElementById('btnSpeedSim').addEventListener('click', () => navigationEngine.cycleSpeedSim());

    // Map Controls
    const debugPanel = document.getElementById('debugPanel');
    document.getElementById('btnToggleDebug').addEventListener('click', () => debugPanel.classList.toggle('hidden'));
    document.getElementById('btnCloseDebug').addEventListener('click', () => debugPanel.classList.add('hidden'));

    document.getElementById('btnRecenter').addEventListener('click', () => {
      this.syncRealLocation();
    });

    document.getElementById('btnZoomIn').addEventListener('click', () => mapEngine.zoomIn());
    document.getElementById('btnZoomOut').addEventListener('click', () => mapEngine.zoomOut());

    // Style Switcher
    const styleMenu = document.getElementById('styleMenu');
    document.getElementById('btnStyleToggle').addEventListener('click', () => styleMenu.classList.toggle('hidden'));

    document.querySelectorAll('.style-option').forEach(opt => {
      opt.addEventListener('click', () => {
        document.querySelectorAll('.style-option').forEach(o => o.classList.remove('active'));
        opt.classList.add('active');
        mapEngine.setMapStyle(opt.getAttribute('data-style'));
        styleMenu.classList.add('hidden');
      });
    });

    // Map Click Event
    mapEngine.map.on('click', async (e) => {
      const { lat, lng } = e.latlng;
      const placeDetails = await searchService.reverseGeocode(lat, lng);
      this.showPlaceCard(lat, lng, placeDetails.name, placeDetails.address);
    });

    document.getElementById('btnClosePlaceCard').addEventListener('click', () => {
      document.getElementById('placeCard').classList.add('hidden');
    });

    document.getElementById('btnCardDirectionsTo').addEventListener('click', () => {
      if (!this.selectedPlaceInfo) return;
      document.getElementById('placeCard').classList.add('hidden');
      sidebarPanel.classList.remove('hidden');

      if (this.userCoords && !this.originCoords) {
        document.getElementById('originInput').value = "My Location";
        this.originCoords = { lat: this.userCoords.lat, lng: this.userCoords.lng, name: "My Location" };
      }

      document.getElementById('destInput').value = this.selectedPlaceInfo.name;
      this.destCoords = this.selectedPlaceInfo;
      mapEngine.setDestinationMarker(this.selectedPlaceInfo.lat, this.selectedPlaceInfo.lng, this.selectedPlaceInfo.name);

      if (this.originCoords && this.destCoords) this.calculateAndDisplayRoute();
    });

    document.getElementById('btnCardSave').addEventListener('click', () => {
      if (this.selectedPlaceInfo) this.savePlace(this.selectedPlaceInfo);
    });

    // Simulation Controls
    document.getElementById('btnSimGpsLoss').addEventListener('click', () => {
      gpsMonitor.setManualOverride(GPSState.SENSOR_NAVIGATION);
      sensorCollector.startSimulation();
      this.showToast("Entered Tunnel! GPS lost -> Switched to AI Sensor Nav.");
    });

    document.getElementById('btnSimGpsRestore').addEventListener('click', () => {
      gpsMonitor.setManualOverride(null);
      sensorCollector.stopSimulation();
      if (this.userCoords) gpsMonitor.updateGPSFix(this.userCoords);
      this.showToast("Exited Tunnel! GPS restored -> Reconciled position.");
    });

    document.getElementById('btnSimSensorWalking').addEventListener('click', () => {
      if (sensorCollector.isSimulating) {
        sensorCollector.stopSimulation();
        this.showToast("Walking IMU simulation stopped.");
      } else {
        sensorCollector.startSimulation();
        this.showToast("Walking IMU simulation started!");
      }
    });

    document.getElementById('btnExportTrajectory').addEventListener('click', () => {
      this.exportTrajectoryCSV();
    });
  }

  logTrajectoryFrame(frame) {
    const log = {
      timestamp: Date.now(),
      session_id: "recorded_session_01",
      accel_x: frame.accel.x.toFixed(4),
      accel_y: frame.accel.y.toFixed(4),
      accel_z: frame.accel.z.toFixed(4),
      gyro_x: frame.gyro.x.toFixed(4),
      gyro_y: frame.gyro.y.toFixed(4),
      gyro_z: frame.gyro.z.toFixed(4),
      mag_x: 0, mag_y: 0, mag_z: 0,
      orientation_heading: frame.orientation.heading.toFixed(2),
      gps_lat: this.userCoords ? this.userCoords.lat : 0,
      gps_lng: this.userCoords ? this.userCoords.lng : 0,
      step_detected: 0,
      ground_truth_step_len: 0.73
    };
    this.trajectoryLogs.push(log);
  }

  exportTrajectoryCSV() {
    if (this.trajectoryLogs.length === 0) {
      for (let i = 0; i < 20; i++) {
        this.trajectoryLogs.push({
          timestamp: Date.now() + i*200,
          session_id: "demo_trajectory_log",
          accel_x: (Math.random()*0.5).toFixed(4),
          accel_y: (Math.random()*0.5).toFixed(4),
          accel_z: (9.81 + Math.random()*2).toFixed(4),
          gyro_x: 0.01, gyro_y: 0.02, gyro_z: 0.01,
          mag_x: 21.5, mag_y: -42.1, mag_z: -12.3,
          orientation_heading: 45.0,
          gps_lat: 40.7128, gps_lng: -74.0060,
          step_detected: i % 4 === 0 ? 1 : 0,
          ground_truth_step_len: 0.73
        });
      }
    }

    const headers = "timestamp,session_id,accel_x,accel_y,accel_z,gyro_x,gyro_y,gyro_z,mag_x,mag_y,mag_z,orientation_heading,gps_lat,gps_lng,step_detected,ground_truth_step_len\n";
    const body = this.trajectoryLogs.map(r => Object.values(r).join(',')).join('\n');
    const blob = new Blob([headers + body], { type: 'text/csv' });

    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `trajectory_${Date.now()}.csv`;
    a.click();

    this.showToast("Trajectory CSV dataset downloaded!");
  }

  renderSuggestions(items, dropdownEl, onSelect) {
    if (!items || items.length === 0) {
      dropdownEl.classList.add('hidden');
      return;
    }

    dropdownEl.innerHTML = '';
    items.forEach(item => {
      const div = document.createElement('div');
      div.className = 'suggestion-item';
      div.innerHTML = `
        <i class="fa-solid fa-location-dot suggestion-icon"></i>
        <div class="suggestion-details">
          <span class="suggestion-name">${this.escapeHtml(item.name)}</span>
          <span class="suggestion-address">${this.escapeHtml(item.address)}</span>
        </div>
      `;
      div.addEventListener('click', () => onSelect(item));
      dropdownEl.appendChild(div);
    });

    dropdownEl.classList.remove('hidden');
  }

  selectSearchResult(item) {
    document.getElementById('searchSuggestions').classList.add('hidden');
    document.getElementById('searchInput').value = item.name;
    mapEngine.setPoiMarker(item.lat, item.lng, item.name, item.address);
    mapEngine.panTo(item.lat, item.lng, 15);
    this.showPlaceCard(item.lat, item.lng, item.name, item.address);
  }

  showPlaceCard(lat, lng, name, address) {
    this.selectedPlaceInfo = { lat, lng, name, address };
    document.getElementById('cardTitle').textContent = name;
    document.getElementById('cardSubtitle').textContent = address;
    document.getElementById('placeCard').classList.remove('hidden');
    mapEngine.setPoiMarker(lat, lng, name, address);
  }

  async calculateAndDisplayRoute() {
    if (!this.originCoords || !this.destCoords) return;

    this.showToast("Calculating route...");

    try {
      const routeData = await routingService.getRoute(this.originCoords, this.destCoords, this.selectedTravelMode);
      this.currentActiveRoute = routeData;

      mapMatching.setRoutePolyline(routeData.polyline);
      mapEngine.drawRoutePolyline(routeData.polyline);

      document.getElementById('routeDuration').textContent = routingService.formatDuration(routeData.duration);
      document.getElementById('routeDistance').textContent = routingService.formatDistance(routeData.distance);
      document.getElementById('routeVia').textContent = `via ${routeData.summary}`;

      const maneuverList = document.getElementById('maneuverList');
      maneuverList.innerHTML = '';

      routeData.steps.forEach(step => {
        const li = document.createElement('li');
        li.className = 'maneuver-item';
        li.innerHTML = `
          <i class="${step.icon} maneuver-icon"></i>
          <span class="maneuver-text">${this.escapeHtml(step.instruction)}</span>
          <span class="maneuver-dist">${routingService.formatDistance(step.distance)}</span>
        `;
        maneuverList.appendChild(li);
      });

      document.getElementById('routeResultsCard').classList.remove('hidden');
    } catch (err) {
      console.error(err);
      this.showToast("Could not calculate route between selected places.");
    }
  }

  savePlace(place) {
    if (this.savedPlaces.some(p => p.name === place.name)) {
      this.showToast("Place already saved!");
      return;
    }
    this.savedPlaces.push(place);
    localStorage.setItem('apex_saved_places', JSON.stringify(this.savedPlaces));
    this.renderSavedPlaces();
    this.showToast("Saved to your places!");
  }

  renderSavedPlaces() {
    const listEl = document.getElementById('savedPlacesList');
    if (this.savedPlaces.length === 0) {
      listEl.innerHTML = `<p class="empty-state">No saved places yet. Click any place on the map to save it!</p>`;
      return;
    }

    listEl.innerHTML = '';
    this.savedPlaces.forEach(p => {
      const div = document.createElement('div');
      div.className = 'saved-place-item';
      div.innerHTML = `
        <div>
          <strong style="font-size: 0.88rem; color: var(--text-dark);">${this.escapeHtml(p.name)}</strong>
          <p style="font-size: 0.76rem; color: var(--text-muted);">${this.escapeHtml(p.address.substring(0, 35))}...</p>
        </div>
        <i class="fa-solid fa-chevron-right" style="color: var(--text-muted); font-size: 0.8rem;"></i>
      `;
      div.addEventListener('click', () => this.selectSearchResult(p));
      listEl.appendChild(div);
    });
  }

  showToast(msg) {
    const container = document.getElementById('toastContainer');
    const toast = document.createElement('div');
    toast.className = 'toast';
    toast.innerHTML = `<i class="fa-solid fa-circle-info" style="color: var(--primary);"></i> ${this.escapeHtml(msg)}`;
    container.appendChild(toast);
    setTimeout(() => toast.remove(), 3500);
  }

  escapeHtml(str) {
    if (!str) return '';
    return str.replace(/[&<>"']/g, function(m) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;' }[m];
    });
  }
}

document.addEventListener('DOMContentLoaded', () => {
  const app = new ApexMapsApp();
  app.init();
});
