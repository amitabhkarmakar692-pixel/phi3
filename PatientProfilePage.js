import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = process.env.REACT_APP_SUPABASE_URL;
const SUPABASE_ANON_KEY = process.env.REACT_APP_SUPABASE_ANON_KEY;
const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

function PatientProfilePage() {
  const navigate = useNavigate();
  const [patientData, setPatientData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState(false);
  const [formData, setFormData] = useState({});
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    fetchPatientData();
  }, []);

  const fetchPatientData = async () => {
    try {
      const { data: { user } } = await supabase.auth.getUser();
      
      const { data, error } = await supabase
        .from('patient_profiles')
        .select('*')
        .eq('user_id', user?.id)
        .single();

      if (error && error.code !== 'PGRST116') { // PGRST116 = no rows returned
        throw error;
      }

      setPatientData(data);
      setFormData(data || {});
    } catch (err) {
      console.error('Error fetching patient data:', err);
    } finally {
      setLoading(false);
    }
  };

  const handleInputChange = (e) => {
    const { name, value } = e.target;
    setFormData(prev => ({
      ...prev,
      [name]: value
    }));
  };

  const handleSave = async () => {
    setSaving(true);
    
    try {
      const { data: { user } } = await supabase.auth.getUser();
      
      const profileData = {
        ...formData,
        user_id: user?.id,
        updated_at: new Date().toISOString()
      };

      let error;
      if (patientData) {
        // Update existing profile
        ({ error } = await supabase
          .from('patient_profiles')
          .update(profileData)
          .eq('id', patientData.id));
      } else {
        // Insert new profile
        ({ error } = await supabase
          .from('patient_profiles')
          .insert([profileData]));
      }

      if (error) throw error;

      setPatientData(profileData);
      setEditing(false);
      alert('Profile updated successfully!');
    } catch (err) {
      console.error('Error saving profile:', err);
      alert('Failed to save profile. Please try again.');
    } finally {
      setSaving(false);
    }
  };

  const handleCancel = () => {
    setFormData(patientData || {});
    setEditing(false);
  };

  const formatDate = (dateString) => {
    return new Date(dateString).toLocaleDateString();
  };

  const calculateBMI = (weight, height) => {
    if (!weight || !height) return null;
    const heightInMeters = height / 100;
    return (weight / (heightInMeters * heightInMeters)).toFixed(1);
  };

  const getBMICategory = (bmi) => {
    if (!bmi) return '';
    if (bmi < 18.5) return 'Underweight';
    if (bmi < 25) return 'Normal weight';
    if (bmi < 30) return 'Overweight';
    return 'Obese';
  };

  if (loading) {
    return (
      <div className="profile-container">
        <div className="loading">Loading profile...</div>
      </div>
    );
  }

  return (
    <div className="profile-container">
      <div className="profile-content">
        <div className="profile-header">
          <h1>Patient Profile</h1>
          {!editing ? (
            <button className="btn-primary" onClick={() => setEditing(true)}>
              Edit Profile
            </button>
          ) : (
            <div className="edit-actions">
              <button 
                className="btn-secondary" 
                onClick={handleCancel}
                disabled={saving}
              >
                Cancel
              </button>
              <button 
                className="btn-primary" 
                onClick={handleSave}
                disabled={saving}
              >
                {saving ? 'Saving...' : 'Save Changes'}
              </button>
            </div>
          )}
        </div>

        <div className="profile-sections">
          {/* Personal Information */}
          <div className="profile-section">
            <h2>Personal Information</h2>
            <div className="profile-grid">
              <div className="form-group">
                <label>First Name</label>
                {editing ? (
                  <input
                    type="text"
                    name="first_name"
                    value={formData.first_name || ''}
                    onChange={handleInputChange}
                  />
                ) : (
                  <div className="profile-value">{patientData?.first_name || 'Not provided'}</div>
                )}
              </div>

              <div className="form-group">
                <label>Last Name</label>
                {editing ? (
                  <input
                    type="text"
                    name="last_name"
                    value={formData.last_name || ''}
                    onChange={handleInputChange}
                  />
                ) : (
                  <div className="profile-value">{patientData?.last_name || 'Not provided'}</div>
                )}
              </div>

              <div className="form-group">
                <label>Date of Birth</label>
                {editing ? (
                  <input
                    type="date"
                    name="date_of_birth"
                    value={formData.date_of_birth || ''}
                    onChange={handleInputChange}
                  />
                ) : (
                  <div className="profile-value">
                    {patientData?.date_of_birth ? formatDate(patientData.date_of_birth) : 'Not provided'}
                  </div>
                )}
              </div>

              <div className="form-group">
                <label>Gender</label>
                {editing ? (
                  <select
                    name="gender"
                    value={formData.gender || ''}
                    onChange={handleInputChange}
                  >
                    <option value="">Select gender</option>
                    <option value="male">Male</option>
                    <option value="female">Female</option>
                    <option value="other">Other</option>
                  </select>
                ) : (
                  <div className="profile-value">
                    {patientData?.gender ? patientData.gender.charAt(0).toUpperCase() + patientData.gender.slice(1) : 'Not provided'}
                  </div>
                )}
              </div>

              <div className="form-group">
                <label>Phone Number</label>
                {editing ? (
                  <input
                    type="tel"
                    name="phone"
                    value={formData.phone || ''}
                    onChange={handleInputChange}
                  />
                ) : (
                  <div className="profile-value">{patientData?.phone || 'Not provided'}</div>
                )}
              </div>

              <div className="form-group">
                <label>Email</label>
                <div className="profile-value">{patientData?.email || 'Not provided'}</div>
              </div>
            </div>

            <div className="form-group full-width">
              <label>Address</label>
              {editing ? (
                <textarea
                  name="address"
                  value={formData.address || ''}
                  onChange={handleInputChange}
                  rows={3}
                />
              ) : (
                <div className="profile-value">{patientData?.address || 'Not provided'}</div>
              )}
            </div>

            <div className="form-group full-width">
              <label>Emergency Contact</label>
              {editing ? (
                <input
                  type="text"
                  name="emergency_contact"
                  value={formData.emergency_contact || ''}
                  onChange={handleInputChange}
                  placeholder="Name and phone number"
                />
              ) : (
                <div className="profile-value">{patientData?.emergency_contact || 'Not provided'}</div>
              )}
            </div>
          </div>

          {/* Medical Information */}
          <div className="profile-section">
            <h2>Medical Information</h2>
            <div className="profile-grid">
              <div className="form-group">
                <label>Blood Type</label>
                {editing ? (
                  <select
                    name="blood_type"
                    value={formData.blood_type || ''}
                    onChange={handleInputChange}
                  >
                    <option value="">Select blood type</option>
                    <option value="A+">A+</option>
                    <option value="A-">A-</option>
                    <option value="B+">B+</option>
                    <option value="B-">B-</option>
                    <option value="AB+">AB+</option>
                    <option value="AB-">AB-</option>
                    <option value="O+">O+</option>
                    <option value="O-">O-</option>
                  </select>
                ) : (
                  <div className="profile-value">{patientData?.blood_type || 'Not provided'}</div>
                )}
              </div>

              <div className="form-group">
                <label>Height (cm)</label>
                {editing ? (
                  <input
                    type="number"
                    name="height"
                    value={formData.height || ''}
                    onChange={handleInputChange}
                    min="50"
                    max="250"
                  />
                ) : (
                  <div className="profile-value">{patientData?.height || 'Not provided'}</div>
                )}
              </div>

              <div className="form-group">
                <label>Weight (kg)</label>
                {editing ? (
                  <input
                    type="number"
                    name="weight"
                    value={formData.weight || ''}
                    onChange={handleInputChange}
                    min="20"
                    max="300"
                    step="0.1"
                  />
                ) : (
                  <div className="profile-value">{patientData?.weight || 'Not provided'}</div>
                )}
              </div>

              {patientData?.height && patientData?.weight && !editing && (
                <div className="form-group">
                  <label>BMI</label>
                  <div className="profile-value">
                    {calculateBMI(patientData.weight, patientData.height)} 
                    <span className="bmi-category">
                      ({getBMICategory(calculateBMI(patientData.weight, patientData.height))})
                    </span>
                  </div>
                </div>
              )}
            </div>

            <div className="form-group full-width">
              <label>Allergies</label>
              {editing ? (
                <textarea
                  name="allergies"
                  value={formData.allergies || ''}
                  onChange={handleInputChange}
                  rows={3}
                  placeholder="List any known allergies..."
                />
              ) : (
                <div className="profile-value">{patientData?.allergies || 'No known allergies'}</div>
              )}
            </div>

            <div className="form-group full-width">
              <label>Chronic Conditions</label>
              {editing ? (
                <textarea
                  name="chronic_conditions"
                  value={formData.chronic_conditions || ''}
                  onChange={handleInputChange}
                  rows={3}
                  placeholder="List any chronic medical conditions..."
                />
              ) : (
                <div className="profile-value">{patientData?.chronic_conditions || 'No chronic conditions reported'}</div>
              )}
            </div>

            <div className="form-group full-width">
              <label>Current Medications</label>
              {editing ? (
                <textarea
                  name="medications"
                  value={formData.medications || ''}
                  onChange={handleInputChange}
                  rows={3}
                  placeholder="List current medications and dosages..."
                />
              ) : (
                <div className="profile-value">{patientData?.medications || 'No medications reported'}</div>
              )}
            </div>

            <div className="form-group full-width">
              <label>Family Medical History</label>
              {editing ? (
                <textarea
                  name="family_history"
                  value={formData.family_history || ''}
                  onChange={handleInputChange}
                  rows={3}
                  placeholder="Relevant family medical history..."
                />
              ) : (
                <div className="profile-value">{patientData?.family_history || 'No family history provided'}</div>
              )}
            </div>
          </div>

          {/* Additional Information */}
          <div className="profile-section">
            <h2>Additional Information</h2>
            
            <div className="form-group full-width">
              <label>Insurance Information</label>
              {editing ? (
                <textarea
                  name="insurance_info"
                  value={formData.insurance_info || ''}
                  onChange={handleInputChange}
                  rows={3}
                  placeholder="Insurance provider, policy number, etc..."
                />
              ) : (
                <div className="profile-value">{patientData?.insurance_info || 'No insurance information provided'}</div>
              )}
            </div>

            <div className="form-group full-width">
              <label>Primary Care Physician</label>
              {editing ? (
                <input
                  type="text"
                  name="primary_care_physician"
                  value={formData.primary_care_physician || ''}
                  onChange={handleInputChange}
                  placeholder="Doctor's name and contact information"
                />
              ) : (
                <div className="profile-value">{patientData?.primary_care_physician || 'Not provided'}</div>
              )}
            </div>

            <div className="form-group full-width">
              <label>Additional Notes</label>
              {editing ? (
                <textarea
                  name="additional_notes"
                  value={formData.additional_notes || ''}
                  onChange={handleInputChange}
                  rows={4}
                  placeholder="Any additional information you'd like to share..."
                />
              ) : (
                <div className="profile-value">{patientData?.additional_notes || 'No additional notes'}</div>
              )}
            </div>
          </div>
        </div>

        <div className="profile-actions">
          <button 
            className="btn-secondary" 
            onClick={() => navigate('/dashboard')}
          >
            Back to Dashboard
          </button>
        </div>
      </div>
    </div>
  );
}

export default PatientProfilePage;
