import React, { useEffect, useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.REACT_APP_SUPABASE_URL;
const supabaseKey = process.env.REACT_APP_SUPABASE_ANON_KEY;
const supabase = createClient(supabaseUrl, supabaseKey);

export default function DoctorPublicProfilePage() {
  const { id } = useParams(); // doctor user_id
  const [row, setRow] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    let ignore = false;
    async function run() {
      setLoading(true);
      setError('');
      try {
        const { data, error } = await supabase
          .from('doctor_profiles')
          .select('*')
          .eq('user_id', id)
          .maybeSingle();
        if (error) throw error;
        if (!ignore) setRow(data);
      } catch (e) {
        if (!ignore) setError(e?.message || String(e));
      } finally {
        if (!ignore) setLoading(false);
      }
    }
    run();
    return () => { ignore = true; };
  }, [id]);

  return (
    <main>
      <div className="card">
        <div className="profile-header" style={{ alignItems: 'center' }}>
          <h1 className="card-title">Doctor Profile</h1>
          <Link to="/patient/doctors" className="btn btn-secondary">Back to Directory</Link>
        </div>
        {loading && <div className="muted">Loading…</div>}
        {error && <div className="alert alert-danger">{error}</div>}
        {!loading && !error && !row && (
          <div className="muted">Doctor not found.</div>
        )}
        {row && (
          <div className="card" style={{ marginTop: 12 }}>
            <h3 className="card-title">{row.full_name || 'Unknown Doctor'}</h3>
            <div className="muted" style={{ marginBottom: 8 }}>Doctor ID: <span style={{ fontFamily: 'monospace' }}>{row.user_id}</span></div>
            <div style={{ display: 'grid', gap: 8 }}>
              <div><strong>Designation:</strong> {row.designation || '-'}</div>
              <div><strong>Specialty:</strong> {row.specialty || '-'}</div>
              <div><strong>License Number:</strong> {row.license_number || '-'}</div>
              <div><strong>Hospital/Clinic:</strong> {row.hospital || '-'}</div>
              <div><strong>Phone:</strong> {row.phone || '-'}</div>
              <div><strong>Email:</strong> {row.email || '-'}</div>
              <div><strong>Address:</strong> {row.address || '-'}</div>
              <div><strong>Bio:</strong> {row.bio || '-'}</div>
            </div>
          </div>
        )}
      </div>
    </main>
  );
}
