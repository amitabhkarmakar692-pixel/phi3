import React, { useEffect, useState } from 'react';
import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.REACT_APP_SUPABASE_URL;
const supabaseKey = process.env.REACT_APP_SUPABASE_ANON_KEY;
const supabase = createClient(supabaseUrl, supabaseKey);

export default function DoctorProfilePage() {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [user, setUser] = useState(null);

  const [form, setForm] = useState({
    full_name: '',
    designation: '',
    license_number: '',
    specialty: '',
    phone: '',
    email: '',
    hospital: '',
    address: '',
    bio: ''
  });

  useEffect(() => {
    (async () => {
      setLoading(true);
      setError('');
      try {
        const { data: { user } } = await supabase.auth.getUser();
        if (!user) { setError('Not signed in'); setLoading(false); return; }
        setUser(user);

        // Load profiles to prefill name/email
        let profile = null;
        try {
          const { data } = await supabase
            .from('profiles')
            .select('full_name, email')
            .eq('id', user.id)
            .maybeSingle();
          profile = data || null;
        } catch (_) {}

        // Load doctor profile
        let dp = null;
        try {
          const { data } = await supabase
            .from('doctor_profiles')
            .select('*')
            .eq('user_id', user.id)
            .maybeSingle();
          dp = data || null;
        } catch (_) {}

        setForm(prev => ({
          ...prev,
          full_name: dp?.full_name || profile?.full_name || '',
          designation: dp?.designation || '',
          license_number: dp?.license_number || '',
          specialty: dp?.specialty || '',
          phone: dp?.phone || '',
          email: dp?.email || profile?.email || user.email || '',
          hospital: dp?.hospital || '',
          address: dp?.address || '',
          bio: dp?.bio || ''
        }));
      } catch (e) {
        setError(e?.message || String(e));
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  async function handleSave() {
    if (!user) return;
    setSaving(true);
    setError('');
    try {
      const row = {
        user_id: user.id,
        full_name: form.full_name || null,
        designation: form.designation || null,
        license_number: form.license_number || null,
        specialty: form.specialty || null,
        phone: form.phone || null,
        email: form.email || null,
        hospital: form.hospital || null,
        address: form.address || null,
        bio: form.bio || null,
        updated_at: new Date().toISOString()
      };

      const { error: upErr } = await supabase
        .from('doctor_profiles')
        .upsert(row, { onConflict: 'user_id' });
      if (upErr) throw upErr;

      // Keep profiles.full_name in sync
      if (form.full_name) {
        await supabase.from('profiles').upsert({ id: user.id, full_name: form.full_name });
      }

      alert('Doctor profile saved');
    } catch (e) {
      setError(e?.message || String(e));
    } finally {
      setSaving(false);
    }
  }

  const onChange = (k) => (e) => setForm(prev => ({ ...prev, [k]: e.target.value }));

  return (
    <main>
      <div className="card">
        <div className="profile-header">
          <h1 className="card-title">My Doctor Profile</h1>
          <button className="btn btn-success" onClick={handleSave} disabled={saving || loading}>
            {saving ? 'Saving…' : 'Save Profile'}
          </button>
        </div>

        {error && <div className="alert alert-danger" style={{ marginTop: 12 }}>{error}</div>}

        <div className="profile-grid">
          <div className="profile-section">
            <h3>Identity</h3>
            <div className="form-group">
              <label className="form-label">Doctor ID</label>
              <div className="form-display" style={{ fontFamily: 'monospace' }}>{user ? user.id : '-'}</div>
            </div>
            <div className="form-group">
              <label className="form-label">Full Name</label>
              <input className="form-input" value={form.full_name} onChange={onChange('full_name')} />
            </div>
            <div className="form-group">
              <label className="form-label">Designation</label>
              <input className="form-input" value={form.designation} onChange={onChange('designation')} placeholder="e.g., Consultant, Attending" />
            </div>
            <div className="form-group">
              <label className="form-label">License Number</label>
              <input className="form-input" value={form.license_number} onChange={onChange('license_number')} />
            </div>
            <div className="form-group">
              <label className="form-label">Specialty</label>
              <input className="form-input" value={form.specialty} onChange={onChange('specialty')} placeholder="e.g., Cardiology" />
            </div>
          </div>

          <div className="profile-section">
            <h3>Contact</h3>
            <div className="form-group">
              <label className="form-label">Email</label>
              <input className="form-input" value={form.email} onChange={onChange('email')} />
            </div>
            <div className="form-group">
              <label className="form-label">Phone</label>
              <input className="form-input" value={form.phone} onChange={onChange('phone')} />
            </div>
            <div className="form-group">
              <label className="form-label">Hospital/Clinic</label>
              <input className="form-input" value={form.hospital} onChange={onChange('hospital')} />
            </div>
            <div className="form-group">
              <label className="form-label">Address</label>
              <input className="form-input" value={form.address} onChange={onChange('address')} />
            </div>
            <div className="form-group">
              <label className="form-label">Bio</label>
              <textarea className="form-input" value={form.bio} onChange={onChange('bio')} placeholder="Short professional bio…" />
            </div>
          </div>
        </div>

        <div className="muted" style={{ marginTop: 8 }}>
          Changes are saved to the doctor_profiles table. License number should be unique (if enforced).
        </div>
      </div>
    </main>
  );
}
