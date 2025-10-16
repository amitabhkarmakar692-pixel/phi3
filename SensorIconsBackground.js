import React, { useState, useEffect } from 'react';

// Utility functions for sensor management
const SensorUtils = {
  // Initialize Supabase client
  getSupabaseClient() {
    try {
      const { createClient } = require('@supabase/supabase-js');
      const supabaseUrl = process.env.REACT_APP_SUPABASE_URL;
      const supabaseKey = process.env.REACT_APP_SUPABASE_ANON_KEY;
      
      if (supabaseUrl && supabaseKey) {
        return createClient(supabaseUrl, supabaseKey);
      }
    } catch (e) {
      console.warn('Supabase not available for sensor data');
    }
    return null;
  },

  // Generate sensor positions with better distribution
  generatePositions(count) {
    const positions = [];
    const margin = 5; // 5% margin from edges
    
    for (let i = 0; i < count; i++) {
      positions.push({
        left: `${margin + Math.random() * (100 - 2 * margin)}%`,
        top: `${margin + Math.random() * (100 - 2 * margin)}%`,
        delay: `${Math.random() * 4}s`,
        duration: `${3 + Math.random() * 4}s`
      });
    }
    
    return positions;
  },

  // Fetch sensor data from Supabase
  async fetchSensorData() {
    const supabase = this.getSupabaseClient();
    if (!supabase) return this.getFallbackSensorData();

    try {
      // Try to fetch from sensor_readings table
      const { data, error } = await supabase
        .from('sensor_readings')
        .select('sensor_type, reading_value, unit, timestamp')
        .order('timestamp', { ascending: false })
        .limit(50);

      if (error) {
        console.warn('Sensor data fetch error:', error);
        return this.getFallbackSensorData();
      }

      return this.transformSensorData(data || []);
    } catch (e) {
      console.warn('Failed to fetch sensor data:', e);
      return this.getFallbackSensorData();
    }
  },

  // Transform raw sensor data to display format
  transformSensorData(rawData) {
    return rawData.map(reading => ({
      type: reading.sensor_type,
      value: reading.reading_value,
      unit: reading.unit,
      timestamp: reading.timestamp,
      icon: this.getIconForSensorType(reading.sensor_type)
    }));
  },

  // Get appropriate icon for sensor type
  getIconForSensorType(sensorType) {
    const iconMap = {
      'heart_rate': '❤️',
      'temperature': '🌡️',
      'oxygen': '🫁',
      'glucose': '💉',
      'ecg': '📊',
      'respiratory': '🫁',
      'weight': '⚖️',
      'height': '📏',
      'bmi': '📊',
      'cholesterol': '🧪',
      'triglycerides': '🔬',
      'hba1c': '🩺',
      'creatinine': '💊',
      'sodium': '🧂',
      'potassium': '🥬',
      'calcium': '🥛',
      'magnesium': '💎',
      'phosphorus': '⚡',
      'uric_acid': '🧪',
      'vitamin_d': '☀️',
      'vitamin_b12': '🌾',
      'iron': '⚙️',
      'ferritin': '🔩',
      'hemoglobin': '🩸',
      'white_blood_cells': '🦠',
      'red_blood_cells': '🔴',
      'platelets': '🟫',
      'neutrophils': '🛡️',
      'lymphocytes': '🛡️',
      'monocytes': '🛡️',
      'eosinophils': '🛡️',
      'basophils': '🛡️',
      'crp': '🔥',
      'esr': '⏱️',
      'alt': '🔬',
      'ast': '🔬',
      'bilirubin': '🟡',
      'albumin': '🥚',
      'globulin': '🧬',
      'protein': '🥩',
      'ph': '🧪',
      'cortisol': '🧠',
      'testosterone': '💪',
      'estrogen': '♀️',
      'progesterone': '🤰',
      'tsh': '🦋',
      't3': '🔥',
      't4': '❄️',
      'insulin': '💉',
      'c_peptide': '🔗',
      'glucagon': '🍬',
      'amylase': '🌾',
      'lipase': '🧈',
      'ck': '💪',
      'ck_mb': '❤️',
      'troponin': '❤️',
      'bnp': '🫀',
      'nt_pro_bnp': '🫀',
      'd_dimer': '🩸',
      'fibrinogen': '🕸️',
      'inr': '⚖️',
      'pt': '⏱️',
      'ptt': '⏱️',
      'wbc': '🦠',
      'rbc': '🔴',
      'hgb': '🩸',
      'hct': '🩸',
      'mcv': '🔴',
      'mch': '🩸',
      'mchc': '🩸',
      'rdw': '📏',
      'plt': '🟫',
      'mpv': '🟫',
      'neut': '🛡️',
      'lymph': '🛡️',
      'mono': '🛡️',
      'eos': '🛡️',
      'baso': '🛡️'
    };
    
    return iconMap[sensorType] || '🩺';
  },

  // Get fallback sensor data when Supabase is not available
  getFallbackSensorData() {
    const sensorTypes = [
      'heart_rate', 'temperature', 'oxygen', 'glucose',
      'ecg', 'respiratory', 'weight', 'height', 'bmi', 'cholesterol',
      'triglycerides', 'hba1c', 'creatinine', 'sodium', 'potassium',
      'calcium', 'magnesium', 'phosphorus', 'uric_acid', 'vitamin_d',
      'vitamin_b12', 'iron', 'ferritin', 'hemoglobin', 'white_blood_cells',
      'red_blood_cells', 'platelets', 'crp', 'esr'
    ];

    return sensorTypes.map((type, index) => ({
      type,
      value: Math.random() * 100 + 50,
      unit: this.getUnitForSensorType(type),
      timestamp: new Date(Date.now() - index * 60000).toISOString(),
      icon: this.getIconForSensorType(type)
    }));
  },

  // Get unit for sensor type
  getUnitForSensorType(sensorType) {
    const unitMap = {
      'heart_rate': 'bpm',
      'temperature': '°F',
      'oxygen': '%',
      'glucose': 'mg/dL',
      'ecg': 'mV',
      'respiratory': 'bpm',
      'weight': 'kg',
      'height': 'cm',
      'bmi': 'kg/m²',
      'cholesterol': 'mg/dL',
      'triglycerides': 'mg/dL',
      'hba1c': '%',
      'creatinine': 'mg/dL',
      'sodium': 'mEq/L',
      'potassium': 'mEq/L',
      'calcium': 'mg/dL',
      'magnesium': 'mg/dL',
      'phosphorus': 'mg/dL',
      'uric_acid': 'mg/dL',
      'vitamin_d': 'ng/mL',
      'vitamin_b12': 'pg/mL',
      'iron': 'mcg/dL',
      'ferritin': 'ng/mL',
      'hemoglobin': 'g/dL',
      'white_blood_cells': 'K/µL',
      'red_blood_cells': 'M/µL',
      'platelets': 'K/µL',
      'crp': 'mg/L',
      'esr': 'mm/hr'
    };
    
    return unitMap[sensorType] || 'units';
  }
};

const SensorIconsBackground = ({ count = 48, opacity = 0.2 }) => {
  const [sensorData, setSensorData] = useState([]);
  const [positions, setPositions] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const initializeSensorData = async () => {
      try {
        // Fetch sensor data from Supabase
        const data = await SensorUtils.fetchSensorData();
        setSensorData(data);
        
        // Generate positions for sensors
        const generatedPositions = SensorUtils.generatePositions(count);
        setPositions(generatedPositions);
      } catch (error) {
        console.error('Failed to initialize sensor data:', error);
      } finally {
        setLoading(false);
      }
    };

    initializeSensorData();
  }, [count]);

  if (loading) {
    return (
      <div style={{
        position: 'fixed',
        top: 0,
        left: 0,
        width: '100%',
        height: '100%',
        pointerEvents: 'none',
        zIndex: -1
      }}></div>
    );
  }

  const containerStyle = {
    position: 'fixed',
    top: 0,
    left: 0,
    width: '100%',
    height: '100%',
    pointerEvents: 'none',
    zIndex: -1
  };

  const sensorIconStyle = {
    transition: 'transform 0.3s ease',
    position: 'absolute',
    zIndex: -1,
    filter: 'drop-shadow(0 2px 4px rgba(0,0,0,0.1))',
    cursor: 'default',
    userSelect: 'none'
  };

  const sensorIconHoverStyle = {
    transform: 'scale(1.2)',
    filter: 'drop-shadow(0 4px 8px rgba(0,0,0,0.2))'
  };

  return (
    <div style={containerStyle}>
      {Array.from({ length: Math.min(count, Math.max(sensorData.length, positions.length)) }).map((_, index) => {
        const sensor = sensorData[index % sensorData.length];
        const pos = positions[index % positions.length];
        
        if (!sensor || !pos) return null;
        
        // Alternate between float and float-alt animations for more variety
        const animationType = index % 2 === 0 ? 'float' : 'float-alt';
        const fontSizeVariation = 0.8 + (index % 6) * 0.1; // Font size between 0.8rem and 1.4rem
        
        return (
          <div
            key={`${sensor.type}-${index}`}
            style={{
              ...sensorIconStyle,
              left: pos.left,
              top: pos.top,
              opacity,
              fontSize: `${fontSizeVariation}rem`,
              animation: `${animationType} ${pos.duration} ease-in-out infinite`,
              animationDelay: pos.delay,
            }}
            title={`${sensor.type}: ${sensor.value.toFixed(1)} ${sensor.unit}`}
            onMouseEnter={(e) => {
              Object.assign(e.target.style, sensorIconHoverStyle);
            }}
            onMouseLeave={(e) => {
              Object.assign(e.target.style, sensorIconStyle);
            }}
          >
            {sensor.icon}
          </div>
        );
      })}
    </div>
  );
};

export default SensorIconsBackground;
