import React, { useEffect, useState, useCallback } from 'react';
import { Link } from 'react-router-dom';
import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.REACT_APP_SUPABASE_URL;
const supabaseKey = process.env.REACT_APP_SUPABASE_ANON_KEY;
const supabase = createClient(supabaseUrl, supabaseKey);

function isUUID(v) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(String(v || ''));
}

export default function DoctorDirectoryPage() {
  const [q, setQ] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [rows, setRows] = useState([]);

  const fetchList = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const term = q.trim();
      // First try doctor_profiles
      let query = supabase.from('doctor_profiles').select('*').order('full_name', { ascending: true }).limit(200);
      if (term) {
        if (isUUID(term)) {
          query = query.or(`user_id.eq.${term},full_name.ilike.%${term}%`);
        } else {
          query = query.ilike('full_name', `%${term}%`);
        }
      }
      const { data: dpData, error: dpErr } = await query;
      let list = Array.isArray(dpData) ? dpData : [];

      // If empty or blocked, fall back to profiles (role=doctor)
      if ((dpErr || list.length === 0)) {
        let q2 = supabase.from('profiles').select('id, full_name, role').ilike('role', 'doctor').order('full_name', { ascending: true }).limit(200);
        if (term) {
          if (isUUID(term)) {
            q2 = q2.or(`id.eq.${term},full_name.ilike.%${term}%`);
          } else {
            q2 = q2.ilike('full_name', `%${term}%`);
          }
        }
        const { data: prData } = await q2;
        const profRows = (prData || []).map(p => ({
          user_id: p.id,
          full_name: p.full_name,
          designation: null,
          license_number: null,
          specialty: null,
          phone: null,
          email: null,
          hospital: null,
          address: null,
          bio: null
        }));

        // If we did get some doctor_profiles rows, attempt to merge/enhance with profiles
        if (list.length > 0 && profRows.length > 0) {
          const byId = new Map(list.map(r => [String(r.user_id), r]));
          for (const pr of profRows) {
            if (!byId.has(String(pr.user_id))) byId.set(String(pr.user_id), pr);
          }
          list = Array.from(byId.values());
        } else if (list.length === 0) {
          list = profRows;
        }
      }

      setRows(list);
    } catch (e) {
      setError(e?.message || String(e));
      setRows([]);
    } finally {
      setLoading(false);
    }
  }, [q]);

  useEffect(() => { fetchList(); }, [fetchList]);

  return (
    <main>
      <div className="card">
        <div className="profile-header" style={{ alignItems: 'center' }}>
          <h1 className="card-title">Doctors Directory</h1>
        </div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginTop: 8, flexWrap: 'wrap' }}>
          <input
            className="form-input"
            placeholder="Search by name or paste Doctor ID"
            value={q}
            onChange={e => setQ(e.target.value)}
            style={{ minWidth: 260 }}
          />
          <button className="btn btn-primary" onClick={fetchList} disabled={loading}>{loading ? 'Searching…' : 'Search'}</button>
          <span className="muted" style={{ marginLeft: 8 }}>{rows.length} result(s)</span>
        </div>

        {error && <div className="alert alert-danger" style={{ marginTop: 12 }}>{error}</div>}

        <div className="card" style={{ marginTop: 12 }}>
          <h3 className="card-title">Doctors</h3>
          {rows.length === 0 ? (
            <div className="muted">No doctors found.</div>
          ) : (
            <div className="table-container">
              <table>
                <thead>
                  <tr>
                    <th>Name</th>
                    <th>Designation</th>
                    <th>Specialty</th>
                    <th>Hospital</th>
                    <th>Doctor ID</th>
                    <th>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map(r => (
                    <tr key={r.user_id}>
                      <td>{r.full_name || '-'}</td>
                      <td>{r.designation || '-'}</td>
                      <td>{r.specialty || '-'}</td>
                      <td>{r.hospital || '-'}</td>
                      <td style={{ fontFamily: 'monospace' }}>{String(r.user_id).slice(0, 8)}…</td>
                      <td>
                        <Link className="btn btn-primary" to={`/patient/doctors/${r.user_id}`}>View Profile</Link>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    </main>
  );
}
