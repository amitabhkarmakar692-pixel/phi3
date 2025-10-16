import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = process.env.REACT_APP_SUPABASE_URL;
const SUPABASE_ANON_KEY = process.env.REACT_APP_SUPABASE_ANON_KEY;
const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

function VitalsPage() {
  const navigate = useNavigate();
  const [vitals, setVitals] = useState({
    temperature: '',
    heart_rate: '',
    blood_pressure_systolic: '',
    blood_pressure_diastolic: '',
    oxygen_saturation: '',
    respiratory_rate: '',
    weight: '',
    height: ''
  });
  const [loading, setLoading] = useState(false);
  const [recentVitals, setRecentVitals] = useState([]);

  useEffect(() => {
    fetchRecentVitals();
  }, []);

  const fetchRecentVitals = async () => {
    try {
      const { data, error } = await supabase
        .from('patient_vitals')
        .select('*')
        .order('created_at', { ascending: false })
        .limit(5);

      if (error) throw error;
      setRecentVitals(data || []);
    } catch (err) {
      console.error('Error fetching vitals:', err);
    }
  };

  const handleInputChange = (e) => {
    const { name, value } = e.target;
    setVitals(prev => ({
      ...prev,
      [name]: value
    }));
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setLoading(true);

    try {
      const { data: { user } } = await supabase.auth.getUser();
      
      const { error } = await supabase
        .from('patient_vitals')
        .insert([{
          user_id: user?.id,
          ...vitals,
          recorded_at: new Date().toISOString()
        }]);

      if (error) throw error;

      // Reset form
      setVitals({
        temperature: '',
        heart_rate: '',
        blood_pressure_systolic: '',
        blood_pressure_diastolic: '',
        oxygen_saturation: '',
        respiratory_rate: '',
        weight: '',
        height: ''
      });

      // Refresh recent vitals
      await fetchRecentVitals();

      alert('Vitals recorded successfully!');
    } catch (err) {
      console.error('Error saving vitals:', err);
      alert('Failed to save vitals. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="vitals-container">
      <div className="vitals-content">
        <h1>Patient Vitals</h1>
        
        <div className="vitals-form-section">
          <h2>Record New Vitals</h2>
          <form onSubmit={handleSubmit} className="vitals-form">
            <div className="vitals-form-grid">
              <div className="form-group">
                <label>Temperature (°F)</label>
                <input
                  type="number"
                  name="temperature"
                  value={vitals.temperature}
                  onChange={handleInputChange}
                  step="0.1"
                  placeholder="98.6"
                />
              </div>
              
              <div className="form-group">
                <label>Heart Rate (bpm)</label>
                <input
                  type="number"
                  name="heart_rate"
                  value={vitals.heart_rate}
                  onChange={handleInputChange}
                  placeholder="72"
                />
              </div>
              
              <div className="form-group">
                <label>Blood Pressure (Systolic)</label>
                <input
                  type="number"
                  name="blood_pressure_systolic"
                  value={vitals.blood_pressure_systolic}
                  onChange={handleInputChange}
                  placeholder="120"
                />
              </div>
              
              <div className="form-group">
                <label>Blood Pressure (Diastolic)</label>
                <input
                  type="number"
                  name="blood_pressure_diastolic"
                  value={vitals.blood_pressure_diastolic}
                  onChange={handleInputChange}
                  placeholder="80"
                />
              </div>
              
              <div className="form-group">
                <label>Oxygen Saturation (%)</label>
                <input
                  type="number"
                  name="oxygen_saturation"
                  value={vitals.oxygen_saturation}
                  onChange={handleInputChange}
                  placeholder="98"
                />
              </div>
              
              <div className="form-group">
                <label>Respiratory Rate</label>
                <input
                  type="number"
                  name="respiratory_rate"
                  value={vitals.respiratory_rate}
                  onChange={handleInputChange}
                  placeholder="16"
                />
              </div>
              
              <div className="form-group">
                <label>Weight (lbs)</label>
                <input
                  type="number"
                  name="weight"
                  value={vitals.weight}
                  onChange={handleInputChange}
                  step="0.1"
                  placeholder="150"
                />
              </div>
              
              <div className="form-group">
                <label>Height (inches)</label>
                <input
                  type="number"
                  name="height"
                  value={vitals.height}
                  onChange={handleInputChange}
                  placeholder="70"
                />
              </div>
            </div>
            
            <div className="form-actions">
              <button type="submit" className="btn-primary" disabled={loading}>
                {loading ? 'Saving...' : 'Save Vitals'}
              </button>
              <button type="button" className="btn-secondary" onClick={() => navigate('/dashboard')}>
                Finish
              </button>
            </div>
          </form>
        </div>

        <div className="recent-vitals-section">
          <h2>Recent Vitals</h2>
          {recentVitals.length > 0 ? (
            <div className="vitals-table">
              <table>
                <thead>
                  <tr>
                    <th>Date</th>
                    <th>Temp</th>
                    <th>Heart Rate</th>
                    <th>Blood Pressure</th>
                    <th>O2 Sat</th>
                    <th>Weight</th>
                  </tr>
                </thead>
                <tbody>
                  {recentVitals.map((vital, index) => (
                    <tr key={index}>
                      <td>{new Date(vital.recorded_at).toLocaleDateString()}</td>
                      <td>{vital.temperature}°F</td>
                      <td>{vital.heart_rate} bpm</td>
                      <td>{vital.blood_pressure_systolic}/{vital.blood_pressure_diastolic}</td>
                      <td>{vital.oxygen_saturation}%</td>
                      <td>{vital.weight} lbs</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <p className="no-data">No vitals recorded yet.</p>
          )}
        </div>
      </div>
    </div>
  );
}

export default VitalsPage;
