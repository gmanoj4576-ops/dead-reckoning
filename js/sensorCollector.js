/**
 * SMARTPHONE IMU SENSOR COLLECTOR (MULTI-LAYER ACQUISITION ENGINE)
 * Fuses W3C Generic Sensor API (Gyroscope, Accelerometer, AbsoluteOrientationSensor)
 * with HTML5 DeviceMotion & DeviceOrientation APIs for maximum mobile compatibility.
 */

class SensorCollector {
  constructor() {
    this.isListening = false;
    this.permissionGranted = false;
    this.listeners = [];

    // Hardware Status
    this.activeHardwareSensors = {
      gyroscope: false,
      accelerometer: false,
      orientation: false
    };
    
    // Raw Sensor Readings
    this.accel = { x: 0, y: 0, z: 9.81, timestamp: 0 };
    this.gyro = { x: 0, y: 0, z: 0, timestamp: 0 };
    this.mag = { x: 21.5, y: -42.1, z: -12.3, timestamp: 0 };
    this.orientation = { alpha: 0, beta: 0, gamma: 0, heading: 0 };

    // Derived Telemetry
    this.initialHeading = null;
    this.turnAngleDelta = 0;
    this.estimatedAccelSpeedMs = 0;

    // Preprocessed Data
    this.filteredLinearAccel = { x: 0, y: 0, z: 0, magnitude: 0 };
    this.gravity = { x: 0, y: 9.81, z: 0 };
    this.alphaFilter = 0.8;

    // Simulation Mode
    this.isSimulating = false;
    this.simInterval = null;
    this.simStepPhase = 0;

    this.init();
  }

  init() {
    if (typeof window === 'undefined') return;

    // 1. Try W3C Generic Sensor API (Chrome Android Modern Spec)
    this.initGenericSensors();

    // 2. Attach Standard HTML5 Device Events
    this.attachDeviceEvents();

    // 3. User Gesture Unlock (iOS / Android Chrome)
    const unlockSensors = () => {
      this.requestPermissions();
      this.initGenericSensors();
      this.attachDeviceEvents();
    };

    window.addEventListener('touchstart', unlockSensors, { passive: true });
    window.addEventListener('click', unlockSensors, { passive: true });
  }

  /**
   * Layer 1: W3C Generic Sensor API
   */
  initGenericSensors() {
    if (typeof window === 'undefined') return;

    // A. W3C Gyroscope API
    if ('Gyroscope' in window) {
      try {
        const gyroSensor = new window.Gyroscope({ frequency: 60 });
        gyroSensor.addEventListener('reading', () => {
          this.activeHardwareSensors.gyroscope = true;
          this.gyro = {
            x: (gyroSensor.x * (180 / Math.PI)).toFixed(1),
            y: (gyroSensor.y * (180 / Math.PI)).toFixed(1),
            z: (gyroSensor.z * (180 / Math.PI)).toFixed(1),
            timestamp: Date.now()
          };
          this.emitData();
        });
        gyroSensor.start();
      } catch (e) {
        console.warn("W3C Gyroscope API error:", e);
      }
    }

    // B. W3C Accelerometer / Linear Acceleration API
    if ('LinearAccelerationSensor' in window) {
      try {
        const linAccel = new window.LinearAccelerationSensor({ frequency: 60 });
        linAccel.addEventListener('reading', () => {
          this.activeHardwareSensors.accelerometer = true;
          const mag = Math.sqrt(linAccel.x*linAccel.x + linAccel.y*linAccel.y + linAccel.z*linAccel.z);
          this.filteredLinearAccel = { x: linAccel.x, y: linAccel.y, z: linAccel.z, magnitude: mag };
          this.accel = { x: linAccel.x, y: linAccel.y, z: linAccel.z + 9.81, timestamp: Date.now() };

          if (mag > 0.35) {
            this.estimatedAccelSpeedMs += mag * 0.016 * 0.4;
          } else {
            this.estimatedAccelSpeedMs *= 0.92;
          }
          this.emitData();
        });
        linAccel.start();
      } catch (e) {
        console.warn("W3C LinearAccelerationSensor API error:", e);
      }
    }

    // C. W3C Absolute / Relative Orientation Sensor API
    if ('AbsoluteOrientationSensor' in window || 'RelativeOrientationSensor' in window) {
      try {
        const OrientSensor = window.AbsoluteOrientationSensor || window.RelativeOrientationSensor;
        const orient = new OrientSensor({ frequency: 60 });
        orient.addEventListener('reading', () => {
          this.activeHardwareSensors.orientation = true;
          const q = orient.quaternion; // [x, y, z, w]
          if (q) {
            const euler = this.quaternionToEuler(q);
            this.updateOrientationValues(euler.heading, euler.pitch, euler.roll);
          }
        });
        orient.start();
      } catch (e) {
        console.warn("W3C OrientationSensor API error:", e);
      }
    }
  }

  /**
   * Layer 2 & 3: HTML5 DeviceOrientation & DeviceMotion
   */
  attachDeviceEvents(force = false) {
    if (this.isListening && !force) return;

    if (typeof window === 'undefined') return;

    if (!this.boundMotionHandler) {
      this.boundMotionHandler = (e) => this.handleDeviceMotion(e);
    }
    if (!this.boundOrientHandler) {
      this.boundOrientHandler = (e) => this.handleDeviceOrientation(e);
    }

    if ('DeviceMotionEvent' in window) {
      window.removeEventListener('devicemotion', this.boundMotionHandler, true);
      window.addEventListener('devicemotion', this.boundMotionHandler, true);
    }

    if ('DeviceOrientationEvent' in window) {
      window.removeEventListener('deviceorientation', this.boundOrientHandler, true);
      window.removeEventListener('deviceorientationabsolute', this.boundOrientHandler, true);
      window.addEventListener('deviceorientation', this.boundOrientHandler, true);
      window.addEventListener('deviceorientationabsolute', this.boundOrientHandler, true);
    }

    this.isListening = true;
  }

  async requestPermissions() {
    if (typeof window === 'undefined') return false;

    try {
      if (typeof DeviceMotionEvent !== 'undefined' && typeof DeviceMotionEvent.requestPermission === 'function') {
        const motionRes = await DeviceMotionEvent.requestPermission();
        const orientRes = typeof DeviceOrientationEvent.requestPermission === 'function' 
          ? await DeviceOrientationEvent.requestPermission()
          : 'granted';

        if (motionRes === 'granted' && orientRes === 'granted') {
          this.permissionGranted = true;
          this.attachDeviceEvents(true);
          return true;
        }
      } else {
        this.attachDeviceEvents(true);
        return true;
      }
    } catch (e) {
      console.warn("Sensor permission request error:", e);
    }
    return false;
  }

  handleDeviceMotion(event) {
    const now = Date.now();
    const dt = Math.max(0.001, (now - (this.accel.timestamp || now)) / 1000);
    
    const accelData = event.accelerationIncludingGravity || event.acceleration;

    if (accelData && (accelData.x !== null || accelData.y !== null || accelData.z !== null)) {
      this.activeHardwareSensors.accelerometer = true;
      const rawX = Number(accelData.x) || 0;
      const rawY = Number(accelData.y) || 0;
      const rawZ = Number(accelData.z) || 9.81;

      this.accel = { x: rawX, y: rawY, z: rawZ, timestamp: now };

      this.gravity.x = this.alphaFilter * this.gravity.x + (1 - this.alphaFilter) * rawX;
      this.gravity.y = this.alphaFilter * this.gravity.y + (1 - this.alphaFilter) * rawY;
      this.gravity.z = this.alphaFilter * this.gravity.z + (1 - this.alphaFilter) * rawZ;

      const linX = rawX - this.gravity.x;
      const linY = rawY - this.gravity.y;
      const linZ = rawZ - this.gravity.z;
      const magnitude = Math.sqrt(linX * linX + linY * linY + linZ * linZ);

      this.filteredLinearAccel = { x: linX, y: linY, z: linZ, magnitude };

      if (magnitude > 0.25) {
        this.estimatedAccelSpeedMs += magnitude * dt * 0.4;
      } else {
        this.estimatedAccelSpeedMs *= 0.92;
      }
      this.estimatedAccelSpeedMs = Math.min(30.0, Math.max(0.0, this.estimatedAccelSpeedMs));
    }

    if (event.rotationRate && (event.rotationRate.alpha !== null || event.rotationRate.beta !== null || event.rotationRate.gamma !== null)) {
      this.activeHardwareSensors.gyroscope = true;
      this.gyro = {
        x: Number(event.rotationRate.alpha) || 0,
        y: Number(event.rotationRate.beta) || 0,
        z: Number(event.rotationRate.gamma) || 0,
        timestamp: now
      };
    }

    this.emitData();
  }

  handleDeviceOrientation(event) {
    if (event.alpha === null && event.beta === null && !event.webkitCompassHeading) return;

    this.activeHardwareSensors.orientation = true;

    let heading = Number(event.alpha) || 0;
    if (typeof event.webkitCompassHeading === 'number' && !isNaN(event.webkitCompassHeading)) {
      heading = event.webkitCompassHeading;
    } else if (event.absolute && event.alpha !== null) {
      heading = (360 - Number(event.alpha)) % 360;
    } else if (event.alpha !== null) {
      heading = (360 - Number(event.alpha)) % 360;
    }

    this.updateOrientationValues(heading, Number(event.beta) || 0, Number(event.gamma) || 0);
    this.emitData();
  }

  updateOrientationValues(heading, pitch, roll) {
    if (this.initialHeading === null && heading !== 0) {
      this.initialHeading = heading;
    }

    let delta = heading - (this.initialHeading !== null ? this.initialHeading : heading);
    if (delta > 180) delta -= 360;
    if (delta < -180) delta += 360;
    this.turnAngleDelta = delta;

    this.orientation = {
      alpha: heading,
      beta: pitch,
      gamma: roll,
      heading: heading
    };
  }

  quaternionToEuler(q) {
    const [x, y, z, w] = q;
    const roll = Math.atan2(2 * (w * x + y * z), 1 - 2 * (x * x + y * y)) * (180 / Math.PI);
    const pitch = Math.asin(2 * (w * y - z * x)) * (180 / Math.PI);
    const heading = (Math.atan2(2 * (w * z + x * y), 1 - 2 * (y * y + z * z)) * (180 / Math.PI) + 360) % 360;
    return { roll, pitch, heading };
  }

  startSimulation(cadenceHz = 20) {
    this.stopSimulation();
    this.isSimulating = true;
    const intervalMs = 1000 / cadenceHz;

    this.simInterval = setInterval(() => {
      const now = Date.now();
      this.simStepPhase += 0.35;

      const vertAccel = 9.81 + Math.sin(this.simStepPhase) * 2.8 + (Math.random() - 0.5) * 0.4;
      const horizAccel = Math.cos(this.simStepPhase) * 1.2 + (Math.random() - 0.5) * 0.2;

      this.accel = { x: horizAccel, y: horizAccel, z: vertAccel, timestamp: now };
      
      const linZ = vertAccel - 9.81;
      const magnitude = Math.sqrt(horizAccel * horizAccel + linZ * linZ);
      this.filteredLinearAccel = { x: horizAccel, y: horizAccel, z: linZ, magnitude };

      this.estimatedAccelSpeedMs = 1.4 + Math.sin(this.simStepPhase * 0.5) * 0.4;

      this.gyro = {
        x: (Math.sin(this.simStepPhase) * 15).toFixed(1),
        y: (Math.cos(this.simStepPhase) * 12).toFixed(1),
        z: (Math.sin(this.simStepPhase * 0.5) * 25).toFixed(1),
        timestamp: now
      };

      const currentH = (this.orientation.heading + 0.8) % 360;
      if (this.initialHeading === null) this.initialHeading = currentH;
      let delta = currentH - this.initialHeading;
      if (delta > 180) delta -= 360;
      if (delta < -180) delta += 360;
      this.turnAngleDelta = delta;

      this.orientation = {
        alpha: currentH,
        beta: Math.sin(this.simStepPhase) * 10,
        gamma: Math.cos(this.simStepPhase) * 8,
        heading: currentH
      };

      this.mag = {
        x: (21.5 + Math.sin(this.simStepPhase) * 3).toFixed(1),
        y: (-42.1 + Math.cos(this.simStepPhase) * 3).toFixed(1),
        z: (-12.3).toFixed(1)
      };

      this.emitData();
    }, intervalMs);
  }

  stopSimulation() {
    if (this.simInterval) {
      clearInterval(this.simInterval);
      this.simInterval = null;
    }
    this.isSimulating = false;
  }

  onSensorData(callback) {
    this.listeners.push(callback);
  }

  emitData() {
    const payload = {
      accel: this.accel,
      gyro: this.gyro,
      mag: this.mag,
      orientation: this.orientation,
      filteredAccel: this.filteredLinearAccel,
      accelSpeedMs: this.estimatedAccelSpeedMs,
      turnAngleDelta: this.turnAngleDelta,
      activeHardware: this.activeHardwareSensors
    };
    this.listeners.forEach(cb => cb(payload));
  }
}

export const sensorCollector = new SensorCollector();
