import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.REACT_APP_SUPABASE_URL;
const supabaseKey = process.env.REACT_APP_SUPABASE_ANON_KEY;
const supabase = createClient(supabaseUrl, supabaseKey);
const TBL_VITALS = process.env.REACT_APP_TBL_VITALS || 'vitals';
// Column mapping (allows adapting to different Supabase schemas without DB migrations)
const COL_TIME = process.env.REACT_APP_COL_TIME || 'time';
const COL_TEMPERATURE = process.env.REACT_APP_COL_TEMPERATURE || 'temperature';
const COL_HEART_RATE = process.env.REACT_APP_COL_HEART_RATE || 'heart_rate';
const COL_SPO2 = process.env.REACT_APP_COL_SPO2 || 'spo2';
// To omit a source column entirely, set the env var to 'omit' or '-' or empty
const COL_SOURCE_TEMPERATURE = process.env.REACT_APP_COL_SOURCE_TEMPERATURE || 'source_temperature';
const COL_SOURCE_HEART_RATE = process.env.REACT_APP_COL_SOURCE_HEART_RATE || 'source_heart_rate';
const COL_SOURCE_SPO2 = process.env.REACT_APP_COL_SOURCE_SPO2 || 'source_spo2';
// Fields that should be coerced to integers if needed (comma-separated list of std keys)
// Defaults to heart_rate and spo2 (temperature typically remains decimal)
const INT_FIELDS = (process.env.REACT_APP_VITALS_INT_FIELDS || 'heart_rate,spo2')
  .split(',')
  .map(s => s.trim())
  .filter(Boolean);

const VitalsPage = () => {
  const navigate = useNavigate();
  const [currentStep, setCurrentStep] = useState(0);
  const [assessmentStartedAt, setAssessmentStartedAt] = useState(() => {
    try {
      return localStorage.getItem('assessmentStartedAt');
    } catch (_) { return null; }
  });
  const [vitalsData, setVitalsData] = useState({
    temperature: { value: null, status: 'pending', timestamp: null, confirmed: false, source: null },
    heartRate: { value: null, status: 'pending', timestamp: null, confirmed: false, source: null },
    spo2: { value: null, status: 'pending', timestamp: null, confirmed: false, source: null }
  });
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState('');
  const [manualValue, setManualValue] = useState('');
  const [lastSaveStatus, setLastSaveStatus] = useState('');
  const [lastSaveError, setLastSaveError] = useState('');
  const [currentUserId, setCurrentUserId] = useState('');
  const [isListing, setIsListing] = useState(false);
  const [vitalsRows, setVitalsRows] = useState([]);
  const [listError, setListError] = useState('');
  const navigateNext = () => navigate('/patient/uploads');

  useEffect(() => {
    // If navigating to the page without an active assessment, encourage start
    if (!assessmentStartedAt) {
      // No-op: UI shows Start button
    }
    (async () => {
      try {
        const { data: userRes } = await supabase.auth.getUser();
        const uid = userRes?.user?.id || '';
        setCurrentUserId(uid);
      } catch (_) {}
    })();
  }, [assessmentStartedAt]);

  // Keep vitals in localStorage for cross-step context
  useEffect(() => {
    try {
      localStorage.setItem('vitalsData', JSON.stringify(vitalsData));
      localStorage.setItem('vitals_data', JSON.stringify(vitalsData)); // legacy key used elsewhere
    } catch (_) {}
  }, [vitalsData]);

  const markSkipped = () => {
    try { localStorage.setItem('skippedVitals', 'true'); } catch (_) {}
  };

  const hasAnyInputProvided = () => {
    try {
      const vd = JSON.parse(localStorage.getItem('vitalsData') || localStorage.getItem('vitals_data') || 'null');
      const anyVital = vd && (
        (vd.temperature && vd.temperature.value != null) ||
        (vd.heartRate && vd.heartRate.value != null) ||
        (vd.spo2 && vd.spo2.value != null)
      );
      const uploads = JSON.parse(localStorage.getItem('uploadedDocuments') || '[]');
      const anyUpload = Array.isArray(uploads) && uploads.length > 0;
      const ans = JSON.parse(localStorage.getItem('questionnaireAnswers') || '{}');
      const anyAnswer = ans && Object.values(ans).some(v => {
        if (Array.isArray(v)) return v.length > 0;
        return v !== undefined && v !== null && String(v).trim() !== '';
      });
      return Boolean(anyVital || anyUpload || anyAnswer);
    } catch (_) { return false; }
  };

  const vitalsConfig = [
    {
      key: 'temperature',
      name: 'Temperature',
      unit: '°F',
      icon: '🌡️',
      pin: 4,
      normalRange: { min: 97, max: 99.5 },
      color: '#ff6b6b'
    },
    {
      key: 'heartRate',
      name: 'Heart Rate',
      unit: 'bpm',
      icon: '❤️',
      pin: 17,
      normalRange: { min: 60, max: 100 },
      color: '#4ecdc4'
    },
    {
      key: 'spo2',
      name: 'SpO₂',
      unit: '%',
      icon: '🫁',
      pin: 27,
      normalRange: { min: 95, max: 100 },
      color: '#45b7d1'
    }
  ];

  const currentVital = vitalsConfig[currentStep];
  const allVitalsConfirmed = Object.values(vitalsData).every(vital => vital.confirmed);

  const startAssessment = () => {
    const ts = new Date().toISOString();
    setAssessmentStartedAt(ts);
    try { localStorage.setItem('assessmentStartedAt', ts); } catch (_) {}
    // reset vitals for a fresh run
    setVitalsData({
      temperature: { value: null, status: 'pending', timestamp: null, confirmed: false, source: null },
      heartRate: { value: null, status: 'pending', timestamp: null, confirmed: false, source: null },
      spo2: { value: null, status: 'pending', timestamp: null, confirmed: false, source: null }
    });
    setCurrentStep(0);
  };

  // Raspberry Pi API integration
  const takeVitalReading = async (vitalType, pinNumber) => {
    setIsLoading(true);
    setError('');

    try {
      const base = process.env.REACT_APP_RPI_API_BASE;
      const requireStrict = (process.env.REACT_APP_RPI_REQUIRE || '').toLowerCase() === 'true';
      const serialPort = process.env.REACT_APP_RPI_SERIAL_PORT || '';
      let response;
      if (base) {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 7000);
        let endpoint = '';
        if (vitalType === 'temperature') endpoint = '/vitals/temperature';
        if (vitalType === 'heartRate') endpoint = '/vitals/heart-rate';
        if (vitalType === 'spo2') endpoint = '/vitals/spo2';
        const qs = new URLSearchParams();
        if (requireStrict) qs.set('require','true');
        if (serialPort) qs.set('port', serialPort);
        const url = `${base}${endpoint}${qs.toString() ? `?${qs.toString()}` : ''}`;

        try {
          const res = await fetch(url, { signal: controller.signal });
          clearTimeout(timeout);
          if (!res.ok) throw new Error(`HTTP ${res.status}`);
          const data = await res.json();
          response = { success: true, value: data.value, source: data.source || 'api' };
        } catch (e) {
          clearTimeout(timeout);
          // Fallback to mock if API not reachable
          response = await mockRaspberryPiAPI(vitalType, pinNumber);
        }
      } else {
        // No base URL configured → fallback mock
        response = await mockRaspberryPiAPI(vitalType, pinNumber);
      }

      if (response.success) {
        const timestamp = new Date().toISOString();
        setVitalsData(prev => ({
          ...prev,
          [vitalType]: {
            value: response.value,
            status: 'measured',
            timestamp,
            confirmed: false,
            source: response.source || 'mock'
          }
        }));
      } else {
        throw new Error(response.message || 'Failed to read vital');
      }
    } catch (err) {
      setError(err.message);
      setVitalsData(prev => ({
        ...prev,
        [vitalType]: {
          ...prev[vitalType],
          status: 'error'
        }
      }));
    } finally {
      setIsLoading(false);
    }
  };

  // Mock Raspberry Pi API (replace with actual implementation)
  const mockRaspberryPiAPI = (vitalType, pinNumber) => {
    return new Promise((resolve) => {
      setTimeout(() => {
        // Simulate realistic vital readings
        const readings = {
          temperature: 98.6 + (Math.random() - 0.5) * 2,
          heartRate: 72 + (Math.random() - 0.5) * 20,
          spo2: 98 + (Math.random() - 0.5) * 3
        };

        resolve({
          success: true,
          value: Math.round(readings[vitalType] * 10) / 10,
          message: `Mock value for ${vitalType} (pin ${pinNumber})`,
          source: 'mock'
        });
      }, 2000 + Math.random() * 1000); // 2-3 second delay
    });
  };

  const confirmVital = () => {
    setVitalsData(prev => ({
      ...prev,
      [currentVital.key]: {
        ...prev[currentVital.key],
        confirmed: true,
        status: 'confirmed'
      }
    }));

    // Best-effort: persist this single vital immediately
    (async () => {
      try {
        const { data: userRes } = await supabase.auth.getUser();
        const uid = userRes?.user?.id;
        if (!uid) return;
        const toNum = (v) => (v === null || v === undefined || v === '' ? null : Number(v));
        const ts = new Date().toISOString();
        const payload = {
          user_id: uid,
          time: ts,
          temperature: currentVital.key === 'temperature' ? toNum(vitalsData.temperature?.value) : null,
          heart_rate: currentVital.key === 'heartRate' ? toNum(vitalsData.heartRate?.value) : null,
          spo2: currentVital.key === 'spo2' ? toNum(vitalsData.spo2?.value) : null,
          source_temperature: currentVital.key === 'temperature' ? (vitalsData.temperature?.source || null) : null,
          source_heart_rate: currentVital.key === 'heartRate' ? (vitalsData.heartRate?.source || null) : null,
          source_spo2: currentVital.key === 'spo2' ? (vitalsData.spo2?.source || null) : null
        };
        try {
          await saveVitalsToSupabase(payload);
          setLastSaveStatus('Saved current vital to Supabase');
          setLastSaveError('');
          try { await refreshVitalsList(); } catch (_) {}
        } catch (e2) {
          setLastSaveStatus('Failed to save current vital');
          setLastSaveError(e2?.message || String(e2));
        }
      } catch (e) {
        console.warn('Failed to save single vital:', e?.message || e);
      }
    })();

    if (currentStep < vitalsConfig.length - 1) {
      setCurrentStep(currentStep + 1);
    }
  };

  const retakeVital = () => {
    setVitalsData(prev => ({
      ...prev,
      [currentVital.key]: {
        value: null,
        status: 'pending',
        timestamp: null,
        confirmed: false
      }
    }));
    setManualValue('');
  };

  const getStatusColor = (status) => {
    switch (status) {
      case 'confirmed': return 'var(--success)';
      case 'measured': return 'var(--warning)';
      case 'error': return 'var(--danger)';
      default: return 'var(--gray-400)';
    }
  };

  const getStatusText = (status) => {
    switch (status) {
      case 'confirmed': return 'Confirmed';
      case 'measured': return 'Ready to Confirm';
      case 'error': return 'Error';
      default: return 'Not Measured';
    }
  };

  const isValueNormal = (value, range) => {
    return value >= range.min && value <= range.max;
  };

  // Diagnostics: list recent vitals rows for current user
  const refreshVitalsList = async () => {
    setIsListing(true);
    setListError('');
    try {
      const { data: userRes } = await supabase.auth.getUser();
      const uid = userRes?.user?.id;
      if (!uid) {
        setVitalsRows([]);
        return;
      }

      // Try configured table first
      let table = TBL_VITALS;
      let { data: rows, error } = await supabase
        .from(table)
        .select('*')
        .eq('user_id', uid)
        .order(COL_TIME, { ascending: false })
        .limit(10);

      // If time column missing, try ordering by created_at
      if (error && /column\s+"?\w+"?\s+does not exist|Could not find/i.test(String(error.message))) {
        const alt = await supabase
          .from(table)
          .select('*')
          .eq('user_id', uid)
          .order('created_at', { ascending: false })
          .limit(10);
        rows = alt.data;
        error = alt.error;
      }

      // If relation missing and using default, try 'vitales'
      if (error && /relation\s+"?vitals"?\s+does not exist/i.test(String(error.message)) && TBL_VITALS === 'vitals') {
        table = 'vitales';
        const res2 = await supabase
          .from(table)
          .select('*')
          .eq('user_id', uid)
          .order(COL_TIME, { ascending: false })
          .limit(10);
        rows = res2.data;
        error = res2.error;
        if (error && /column\s+"?\w+"?\s+does not exist|Could not find/i.test(String(error.message))) {
          const res3 = await supabase
            .from(table)
            .select('*')
            .eq('user_id', uid)
            .order('created_at', { ascending: false })
            .limit(10);
          rows = res3.data;
          error = res3.error;
        }
      }

      if (error) throw error;
      setVitalsRows(rows || []);
    } catch (e) {
      setVitalsRows([]);
      setListError(e?.message || String(e));
    } finally {
      setIsListing(false);
    }
  };

  const saveVitalsToSupabase = async (stdPayload) => {
    // Optional: use backend writer with Service Role (if configured)
    const writerBase = process.env.REACT_APP_VITALS_WRITER_URL || '';
    if (writerBase) {
      try {
        const resp = await fetch(`${writerBase.replace(/\/$/, '')}/api/v1/vitals`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(stdPayload)
        });
        if (resp.ok) return true;
        const txt = await resp.text().catch(() => '');
        throw new Error(txt || `Writer HTTP ${resp.status}`);
      } catch (e) {
        // Fall back to client-side insert below
        console.warn('Writer failed, falling back to direct Supabase insert:', e?.message || e);
      }
    }
    // Helper: build payload with mapped column names
    const buildMappedPayload = (includeSources = true, coerceInts = false) => {
      const asNum = (val) => (val === null || val === undefined || val === '' ? null : Number(val));
      const coerce = (key, val) => {
        const num = asNum(val);
        if (num === null) return null;
        if (coerceInts && INT_FIELDS.includes(key)) return Math.round(num);
        return num;
      };
      const out = {
        user_id: stdPayload.user_id,
        [COL_TIME]: stdPayload.time,
        [COL_TEMPERATURE]: coerce('temperature', stdPayload.temperature),
        [COL_HEART_RATE]: coerce('heart_rate', stdPayload.heart_rate),
        [COL_SPO2]: coerce('spo2', stdPayload.spo2),
      };
      const shouldOmit = (col) => !col || col.toLowerCase() === 'omit' || col === '-';
      if (includeSources) {
        if (!shouldOmit(COL_SOURCE_TEMPERATURE)) out[COL_SOURCE_TEMPERATURE] = stdPayload.source_temperature;
        if (!shouldOmit(COL_SOURCE_HEART_RATE)) out[COL_SOURCE_HEART_RATE] = stdPayload.source_heart_rate;
        if (!shouldOmit(COL_SOURCE_SPO2)) out[COL_SOURCE_SPO2] = stdPayload.source_spo2;
      }
      return out;
    };

    // Helper: insert with optional time fallback (created_at)
    const attemptInsert = async (tableName, mapped) => {
      let lastErr = null;
      try {
        const { error } = await supabase.from(tableName).insert([mapped]);
        if (!error) return null;
        lastErr = error;
        const msg = String(error?.message || '');
  const timeMissing = new RegExp(`(column\\s+"?${COL_TIME}"?\\s+does not exist|Could not find\\s+'?${COL_TIME}'?\\s+column)`, 'i').test(msg);
        // If configured time column missing, try created_at fallback
        if (timeMissing) {
          const { [COL_TIME]: _removed, ...rest } = mapped;
          const alt = { ...rest, created_at: stdPayload.time };
          const { error: err2 } = await supabase.from(tableName).insert([alt]);
          if (!err2) return null;
          lastErr = err2;
        }
      } catch (e) {
        lastErr = e;
      }
      return lastErr;
    };

    // Try primary table with sources included
    let tableName = TBL_VITALS;
    let mapped = buildMappedPayload(true, false);
    let err = await attemptInsert(tableName, mapped);

    // If failure, try without any source_* columns (handles missing source_* schema)
    if (err) {
      const msg = String(err?.message || '');
      const hintMissingSource = /source_/i.test(msg) || /Could not find\s+'.*source.*'/i.test(msg);
      if (hintMissingSource || true) { // Always try stripping sources as a safe fallback
        mapped = buildMappedPayload(false, false);
        err = await attemptInsert(tableName, mapped);
      }
    }

    // If still failing, try coercing configured fields to integers and retry (first without sources, then with)
    if (err) {
      mapped = buildMappedPayload(false, true);
      err = await attemptInsert(tableName, mapped);
      if (err) {
        mapped = buildMappedPayload(true, true);
        err = await attemptInsert(tableName, mapped);
      }
    }

    // If table missing and default was 'vitals', try 'vitales'
    if (err && /relation\s+"?vitals"?\s+does not exist/i.test(String(err?.message || '')) && TBL_VITALS === 'vitals') {
      tableName = 'vitales';
      // first try with sources stripped (most compatible)
      mapped = buildMappedPayload(false, false);
      let err2 = await attemptInsert(tableName, mapped);
      if (err2) {
        // try with sources included in case vitales has them
        mapped = buildMappedPayload(true, false);
        err2 = await attemptInsert(tableName, mapped);
      }
      // If still failing, try integer coercion variants
      if (err2) {
        mapped = buildMappedPayload(false, true);
        err2 = await attemptInsert(tableName, mapped);
        if (err2) {
          mapped = buildMappedPayload(true, true);
          err2 = await attemptInsert(tableName, mapped);
        }
      }
      if (!err2) return true;
      err = err2;
    }

    if (err) throw err;
    return true;
  };

  const handleNext = () => {
    // Store vitals data and navigate to next step
    localStorage.setItem('vitalsData', JSON.stringify(vitalsData));
    // Persist vitals to Supabase (best-effort)
    (async () => {
      try {
        const { data: userRes } = await supabase.auth.getUser();
        const uid = userRes?.user?.id;
        if (!uid) return;
        const toNum = (v) => (v === null || v === undefined || v === '' ? null : Number(v));
        const payload = {
          user_id: uid,
          time: new Date().toISOString(),
          temperature: toNum(vitalsData.temperature?.value),
          heart_rate: toNum(vitalsData.heartRate?.value),
          spo2: toNum(vitalsData.spo2?.value),
          source_temperature: vitalsData.temperature?.source || null,
          source_heart_rate: vitalsData.heartRate?.source || null,
          source_spo2: vitalsData.spo2?.source || null
        };
        await saveVitalsToSupabase(payload);
        setLastSaveStatus('Saved vitals to Supabase');
        setLastSaveError('');
        try { await refreshVitalsList(); } catch (_) {}
      } catch (e) {
        const msg = e?.message || String(e);
        console.warn('Failed to save vitals:', msg);
        setLastSaveStatus('Failed to save vitals');
        setLastSaveError(msg);
        try {
          alert(`Could not save vitals to Supabase.\n${msg}\n\nCheck: REACT_APP_TBL_VITALS, table exists, column names (mapped via REACT_APP_COL_*), and RLS insert policy.\nIf your table doesn't have source_* columns, they will be omitted automatically or set REACT_APP_COL_SOURCE_* to 'omit'.`);
        } catch (_) {}
      }
    })();
    navigate('/patient/uploads');
  };

  const handleSkip = () => {
    markSkipped();
    navigateNext();
  };

  const handleBack = () => {
    if (currentStep > 0) {
      setCurrentStep(currentStep - 1);
    } else {
      navigate('/patient');
    }
  };

  return (
    <main>
      <div className="card">
        <div className="assessment-header">
          <h1 className="card-title">Vital Signs Assessment</h1>
          <div style={{ marginTop: 6, fontSize: 13, opacity: 0.9 }}>
            Supabase status: {currentUserId ? (
              <span>Signed in · user_id: <code>{currentUserId}</code></span>
            ) : (
              <span>Not signed in · vitals won’t be saved</span>
            )}
            {lastSaveStatus && (
              <>
                <span> · {lastSaveStatus}</span>
                {lastSaveError ? <span style={{ color: 'var(--danger)' }}> · {lastSaveError}</span> : null}
              </>
            )}
          </div>
          <div style={{ display: 'flex', justifyContent: 'center', gap: 12, alignItems: 'center', marginTop: 8, flexWrap: 'wrap' }}>
            {assessmentStartedAt ? (
              <>
                <span className="step-counter">Started: {new Date(assessmentStartedAt).toLocaleString()}</span>
                <button className="btn btn-secondary" onClick={startAssessment}>Restart Assessment</button>
              </>
            ) : (
              <button className="btn btn-primary" onClick={startAssessment}>▶ Start Assessment</button>
            )}
          </div>
          <div className="progress-indicator">
            <div className="progress-steps">
              {vitalsConfig.map((vital, index) => (
                <div
                  key={vital.key}
                  className={`progress-step ${index <= currentStep ? 'active' : ''} ${
                    vitalsData[vital.key]?.confirmed ? 'completed' : ''
                  }`}
                >
                  <div className="step-number">{index + 1}</div>
                  <div className="step-label">{vital.name}</div>
                </div>
              ))}
            </div>
            <div className="progress-bar">
              <div
                className="progress-fill"
                style={{
                  width: `${((currentStep + (vitalsData[currentVital.key]?.confirmed ? 1 : 0)) / vitalsConfig.length) * 100}%`
                }}
              />
            </div>
          </div>
        </div>

        <div className="vitals-container">
          {/* Current Vital Display */}
          <div className="current-vital-card">
            <div className="vital-header">
              <div className="vital-icon">{currentVital.icon}</div>
              <div className="vital-info">
                <h2>{currentVital.name}</h2>
                <p>Pin {currentVital.pin} • {currentVital.unit}</p>
              </div>
              <div
                className="vital-status"
                style={{ backgroundColor: getStatusColor(vitalsData[currentVital.key]?.status) }}
              >
                {getStatusText(vitalsData[currentVital.key]?.status)}
              </div>
            </div>

            {vitalsData[currentVital.key]?.value && (
              <div className="vital-reading">
                <div className="reading-value">
                  <span className="value">{vitalsData[currentVital.key].value}</span>
                  <span className="unit">{currentVital.unit}</span>
                </div>
                <div className={`reading-status ${isValueNormal(vitalsData[currentVital.key].value, currentVital.normalRange) ? 'normal' : 'abnormal'}`}>
                  {isValueNormal(vitalsData[currentVital.key].value, currentVital.normalRange) ? 'Normal Range' : 'Outside Normal Range'}
                </div>
                {vitalsData[currentVital.key].timestamp && (
                  <div className="reading-timestamp">
                    Measured: {new Date(vitalsData[currentVital.key].timestamp).toLocaleString()} • Source: {(
                      vitalsData[currentVital.key].source === 'usb' ? 'Raspberry Pi' :
                      vitalsData[currentVital.key].source === 'fallback' ? 'API Fallback' :
                      'Mock'
                    )}
                  </div>
                )}
              </div>
            )}

            <div className="vital-actions">
              <button
                className="btn btn-primary"
                onClick={() => takeVitalReading(currentVital.key, currentVital.pin)}
                disabled={isLoading}
              >
                {isLoading ? (
                  <>
                    <div className="spinner" />
                    Capturing from Raspberry Pi...
                  </>
                ) : (
                  <>
                    📡 Capture Now from Raspberry Pi (Pin {currentVital.pin})
                  </>
                )}
              </button>

              {vitalsData[currentVital.key]?.status === 'measured' && (
                <div className="confirmation-buttons">
                  <button className="btn btn-success" onClick={confirmVital}>
                    ✅ Confirm
                  </button>
                  <button className="btn btn-secondary" onClick={retakeVital}>
                    🔄 Retake
                  </button>
                </div>
              )}

              {/* Manual entry fallback */}
              <div style={{ marginTop: 12 }}>
                <div className="form-group">
                  <label className="form-label">Enter {currentVital.name} Manually</label>
                  <input
                    className="form-input"
                    type="number"
                    step="0.1"
                    placeholder={`e.g., ${currentVital.key === 'temperature' ? '98.6' : currentVital.key === 'heartRate' ? '72' : '98'}`}
                    value={manualValue}
                    onChange={(e) => setManualValue(e.target.value)}
                  />
                </div>
                <button
                  className="btn btn-secondary"
                  onClick={() => {
                    if (!manualValue) return;
                    const parsed = Number(manualValue);
                    if (!Number.isFinite(parsed)) return;
                    const timestamp = new Date().toISOString();
                    setVitalsData(prev => ({
                      ...prev,
                      [currentVital.key]: {
                        value: parsed,
                        status: 'measured',
                        timestamp,
                        confirmed: false
                      }
                    }));
                  }}
                >
                  💾 Save Manual Value
                </button>
              </div>
            </div>
          </div>

          {/* All Vitals Summary */}
          <div className="vitals-summary">
            <h3>All Vital Signs</h3>
            <div className="vitals-grid">
              {vitalsConfig.map((vital) => (
                <div
                  key={vital.key}
                  className={`vital-summary-item ${vitalsData[vital.key]?.confirmed ? 'confirmed' : ''} ${
                    vital.key === currentVital.key ? 'current' : ''
                  }`}
                >
                  <div className="vital-summary-icon">{vital.icon}</div>
                  <div className="vital-summary-info">
                    <div className="vital-summary-name">{vital.name}</div>
                    <div className="vital-summary-value">
                      {vitalsData[vital.key]?.value ? `${vitalsData[vital.key].value} ${vital.unit}` : '--'}
                    </div>
                    {vitalsData[vital.key]?.timestamp && (
                      <div className="vital-summary-status" style={{ opacity: 0.85 }}>
                        Source: {(
                          vitalsData[vital.key].source === 'usb' ? 'Raspberry Pi' :
                          vitalsData[vital.key].source === 'fallback' ? 'API Fallback' :
                          'Mock'
                        )}
                      </div>
                    )}
                    <div className="vital-summary-status" style={{ color: getStatusColor(vitalsData[vital.key]?.status) }}>
                      {getStatusText(vitalsData[vital.key]?.status)}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
          {/* Diagnostics: Recent Supabase rows */}
          <div className="vitals-summary" style={{ marginTop: 24 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
              <h3 style={{ margin: 0 }}>Supabase Vitals Rows (latest)</h3>
              <button className="btn btn-secondary btn-sm" onClick={() => refreshVitalsList()} disabled={isListing}>
                {isListing ? 'Refreshing…' : 'Refresh'}
              </button>
            </div>
            {!currentUserId && (
              <div style={{ marginTop: 8, opacity: 0.8 }}>Sign in to save and list vitals.</div>
            )}
            {listError && (
              <div className="alert alert-danger" style={{ marginTop: 8 }}>{listError}</div>
            )}
            {currentUserId && (
              <div className="vitals-grid" style={{ marginTop: 12 }}>
                {Array.isArray(vitalsRows) && vitalsRows.length > 0 ? (
                  vitalsRows.map((row, idx) => (
                    <div key={row.id || idx} className="vital-summary-item">
                      <div className="vital-summary-info">
                        <div className="vital-summary-name">Row {idx + 1}</div>
                        <div className="vital-summary-status" style={{ opacity: 0.9 }}>
                          {COL_TIME in row ? `time: ${row[COL_TIME]}` : row.created_at ? `created_at: ${row.created_at}` : 'time: -'}
                        </div>
                        <div className="vital-summary-status">
                          temp: {row[COL_TEMPERATURE] ?? row.temperature ?? '-'} · HR: {row[COL_HEART_RATE] ?? row.heart_rate ?? '-'} · SpO₂: {row[COL_SPO2] ?? row.spo2 ?? '-'}
                        </div>
                        <div className="vital-summary-status" style={{ opacity: 0.85 }}>
                          src: {row.source_temperature || row.source_heart_rate || row.source_spo2 ? 'present' : 'n/a'}
                        </div>
                      </div>
                    </div>
                  ))
                ) : (
                  <div style={{ opacity: 0.8 }}>No rows found for this user.</div>
                )}
              </div>
            )}
          </div>
        </div>

        {error && (
          <div className="alert alert-danger">
            {error}
          </div>
        )}

        <div className="navigation-buttons">
          <button className="btn btn-secondary" onClick={handleBack}>
            ← Back
          </button>

          <button
            className="btn btn-primary"
            onClick={handleNext}
            disabled={!allVitalsConfirmed}
          >
            {allVitalsConfirmed ? 'Next: Upload Documents →' : 'Complete All Vitals First'}
          </button>

          {/* Skip option */}
          <button
            className="btn btn-outline"
            onClick={handleSkip}
            title="Skip vitals and continue"
            style={{ marginLeft: 8 }}
          >
            Skip Vitals →
          </button>
        </div>
      </div>
    </main>
  );
};

export default VitalsPage;