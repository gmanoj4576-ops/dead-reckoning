/**
 * AI/ML PREDICTOR MODULE FOR PDR CORRECTION
 * Evaluates real-time IMU feature windows to predict step length corrections,
 * heading drift compensation, and motion uncertainty.
 */

class MLPredictor {
  constructor() {
    this.weights = null;
    this.isLoaded = false;
    this.featureWindow = [];
    this.windowCapacity = 20; // 20 frames (~1 sec window)
  }

  async loadModel() {
    try {
      const resp = await fetch('js/model_weights.json');
      if (resp.ok) {
        this.weights = await resp.json();
        this.isLoaded = true;
      }
    } catch (e) {
      console.warn("Could not load model_weights.json, using fallback heuristics:", e);
    }
  }

  addFrame(sensorFrame) {
    this.featureWindow.push(sensorFrame);
    if (this.featureWindow.length > this.windowCapacity) {
      this.featureWindow.shift();
    }
  }

  /**
   * Predict movement corrections from windowed sensor features
   * @param {number} rawStepLength 
   * @param {number} rawHeading 
   * @returns {{correctedStepLength: number, correctedHeading: number, mlConfidence: number}}
   */
  predictCorrection(rawStepLength, rawHeading) {
    if (this.featureWindow.length === 0) {
      return { correctedStepLength: rawStepLength, correctedHeading: rawHeading, mlConfidence: 0.85 };
    }

    // Feature Extraction
    const magValues = this.featureWindow.map(f => f.filteredAccel.magnitude);
    const meanMag = magValues.reduce((a, b) => a + b, 0) / magValues.length;
    const varianceMag = magValues.reduce((a, b) => a + Math.pow(b - meanMag, 2), 0) / magValues.length;

    // Apply Learned Regression Multipliers
    const factor = this.weights?.weights?.step_length_factor || 0.98;
    const headingBias = this.weights?.weights?.heading_bias_correction || 0.0;

    // Adaptive step correction based on motion variance
    let stepMultiplier = factor;
    if (varianceMag > 1.5) stepMultiplier *= 1.05; // Running / fast walking adjustment
    if (varianceMag < 0.3) stepMultiplier *= 0.90; // Slow shuffle adjustment

    const correctedStepLength = rawStepLength * stepMultiplier;
    const correctedHeading = (rawHeading + headingBias + 360) % 360;

    // Calculate Feature-based Confidence
    let confidence = 0.88;
    if (varianceMag > 4.0) confidence -= 0.15; // High noise penalty
    if (this.featureWindow.length < 5) confidence -= 0.10;

    return {
      correctedStepLength,
      correctedHeading,
      mlConfidence: Math.max(0.40, Math.min(0.98, confidence))
    };
  }
}

export const mlPredictor = new MLPredictor();
