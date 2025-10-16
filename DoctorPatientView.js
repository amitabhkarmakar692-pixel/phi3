import React, { useEffect, useMemo, useState, useCallback } from 'react';
import { useParams, useNavigate, useLocation } from 'react-router-dom';
import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.REACT_APP_SUPABASE_URL;
const supabaseKey = process.env.REACT_APP_SUPABASE_ANON_KEY;
const supabase = createClient(supabaseUrl, supabaseKey);

const TBL_VITALS = process.env.REACT_APP_TBL_VITALS || 'vitals';
const TBL_DOCS = process.env.REACT_APP_TBL_DOCS || 'documents';
const TBL_QR = process.env.REACT_APP_TBL_QR || 'questionnaire_responses';
const TBL_REPORT = process.env.REACT_APP_TBL_REPORT || 'diagnoses';
const BUCKET = process.env.REACT_APP_SUPABASE_BUCKET || 'uploads';

// Optional column mappings for vitals
const COL_TIME = process.env.REACT_APP_COL_TIME || 'time';
const COL_TEMPERATURE = process.env.REACT_APP_COL_TEMPERATURE || 'temperature';
const COL_HEART_RATE = process.env.REACT_APP_COL_HEART_RATE || 'heart_rate';
const COL_SPO2 = process.env.REACT_APP_COL_SPO2 || 'spo2';

export default function DoctorPatientView() {
  const { id } = useParams(); // patient user_id expected
  const location = useLocation();
  const navigate = useNavigate();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const [profile, setProfile] = useState(null);
  const [nameSource, setNameSource] = useState(null);
  const [vitals, setVitals] = useState([]);
  const [docs, setDocs] = useState([]);
  const [qr, setQr] = useState(null);
  const [report, setReport] = useState(null);

  const titleId = useMemo(() => (id || '').trim(), [id]);
  const hintedName = useMemo(() => {
    // Prefer name passed via Link state
    const st = location?.state;
    const nameFromState = st && typeof st.name === 'string' ? st.name : null;
    if (nameFromState && nameFromState.trim()) return nameFromState.trim();
    // Fallback to cached map from localStorage
    try {
      const raw = window.localStorage.getItem('patientNamesMap');
      if (raw) {
        const map = JSON.parse(raw);
        const nm = map && map[String(titleId)];
        if (nm && String(nm).trim()) return String(nm).trim();
      }
    } catch (_) {}
    return null;
  }, [location?.state, titleId]);

  const fetchAll = useCallback(async () => {
    if (!titleId) return;
    setLoading(true);
    setError('');
    try {
      // 1) profiles.first
      let profRow = null;
      try {
        const { data: pr } = await supabase
          .from('profiles')
          .select('full_name, email')
          .eq('id', titleId)
          .maybeSingle();
        profRow = pr || null;
      } catch (_) {}

      // 2) patient_profiles metadata
      let pf = null;
      try {
        const { data } = await supabase
          .from('patient_profiles')
          .select('*')
          .eq('user_id', titleId)
          .maybeSingle();
        pf = data || null;
      } catch (_) {}

      // 3) service fallback for name
      let svcName = null;
      try {
        const BASE = (process.env.REACT_APP_VITALS_WRITER_URL || process.env.REACT_APP_SERVER_BASE || 'http://localhost:5001').replace(/\/$/, '');
        const resp = await fetch(`${BASE}/api/v1/patients`);
        if (resp.ok) {
          const json = await resp.json();
          if (json?.ok && Array.isArray(json.patients)) {
            const found = json.patients.find(p => String(p.user_id) === String(titleId));
            if (found) svcName = found.full_name || found.name || found.email || null;
          }
        }
      } catch (_) {}

      // Resolve name preference
      let resolvedName = null;
      let resolvedSource = null;
      if (profRow?.full_name && String(profRow.full_name).trim()) {
        resolvedName = String(profRow.full_name).trim();
        resolvedSource = 'profiles';
      } else if (pf?.full_name && String(pf.full_name).trim()) {
        resolvedName = String(pf.full_name).trim();
        resolvedSource = 'patient_profiles';
      } else if (svcName && String(svcName).trim()) {
        resolvedName = String(svcName).trim();
        resolvedSource = 'service';
      } else if (hintedName && String(hintedName).trim()) {
        resolvedName = String(hintedName).trim();
        resolvedSource = 'nav';
      }

      setNameSource(resolvedSource);
      const resolvedProfile = pf || {};
      setProfile({ ...resolvedProfile, full_name: resolvedName || resolvedProfile.full_name || null });

      // vitals (try configured table; fallback to vitales; order by time or created_at)
      let vt = [];
      try {
        let query = supabase.from(TBL_VITALS).select('*').eq('user_id', titleId).order(COL_TIME, { ascending: false }).limit(20);
        let { data, error: err } = await query;
        if (err && /column|Could not find/i.test(err.message)) {
          const r = await supabase.from(TBL_VITALS).select('*').eq('user_id', titleId).order('created_at', { ascending: false }).limit(20);
          data = r.data; err = r.error;
        }
        if (err && /relation\s+"?vitals"?\s+does not exist/i.test(err.message) && TBL_VITALS === 'vitals') {
          let r2 = await supabase.from('vitales').select('*').eq('user_id', titleId).order(COL_TIME, { ascending: false }).limit(20);
          if (r2.error && /column|Could not find/i.test(r2.error.message)) {
            r2 = await supabase.from('vitales').select('*').eq('user_id', titleId).order('created_at', { ascending: false }).limit(20);
          }
          vt = r2.data || [];
        } else {
          vt = data || [];
        }
      } catch (_) { vt = []; }
      setVitals(vt);

      // documents metadata + public URLs
      let md = [];
      try {
        const { data } = await supabase.from(TBL_DOCS).select('*').eq('user_id', titleId).order('uploaded_at', { ascending: false }).limit(50);
        md = (data || []).map(row => {
          const pub = row.path ? supabase.storage.from(BUCKET).getPublicUrl(row.path) : { data: { publicUrl: '' } };
          return { ...row, publicUrl: pub?.data?.publicUrl || '' };
        });
      } catch (_) { md = []; }
      setDocs(md);

      // last questionnaire responses
      let qrRow = null;
      try {
        const { data } = await supabase.from(TBL_QR).select('*').eq('patient_id', titleId).order('submitted_at', { ascending: false }).maybeSingle();
        qrRow = data || null;
      } catch (_) {}
      setQr(qrRow);

      // last AI report
      let rpt = null;
      try {
        const { data } = await supabase.from(TBL_REPORT).select('*').eq('patient_id', titleId).order('created_at', { ascending: false }).maybeSingle();
        rpt = data || null;
      } catch (_) {}
      setReport(rpt);
    } catch (e) {
      setError(e?.message || String(e));
    } finally {
      setLoading(false);
    }
  }, [titleId, hintedName]);

  useEffect(() => { fetchAll(); }, [fetchAll]);

  const formatDt = (s) => {
    try { return s ? new Date(s).toLocaleString() : '-'; } catch { return String(s || '-'); }
  };

  return (
    <main>
      <div className="card">
        <div className="profile-header" style={{ alignItems: 'center' }}>
          <h1 className="card-title">Patient Overview</h1>
          <div style={{ display: 'flex', gap: 8 }}>
            <button className="btn btn-secondary" onClick={() => navigate('/doctor')}>← Back to Doctor Dashboard</button>
            <button className="btn btn-secondary" onClick={fetchAll} disabled={loading}>{loading ? 'Refreshing…' : 'Refresh'}</button>
          </div>
        </div>

        <div className="profile-grid" style={{ marginTop: 8 }}>
          <div className="profile-section">
            <h3>Patient</h3>
            <div className="form-display" style={{ display: 'grid', gridTemplateColumns: '160px 1fr', gap: 8 }}>
              <div>User ID</div>
              <div style={{ fontFamily: 'monospace' }}>{titleId}</div>
              <div>PID</div>
              <div style={{ fontFamily: 'monospace' }}>{profile?.id ? `PID-${profile.id}` : '-'}</div>
              <div>Name</div>
              <div>
                {profile?.full_name || hintedName || '-'}
                {nameSource && (
                  <span className="muted" style={{ marginLeft: 8, fontSize: 12 }}>(source: {nameSource})</span>
                )}
              </div>
              <div>Phone</div>
              <div>{profile?.phone || '-'}</div>
              <div>DOB</div>
              <div>{profile?.date_of_birth || '-'}</div>
            </div>
          </div>
        </div>

        {error && <div className="alert alert-danger" style={{ marginTop: 12 }}>{error}</div>}

        {/* Vitals */}
        <div className="card" style={{ marginTop: 16 }}>
          <h3 className="card-title">Recent Vitals</h3>
          {vitals.length === 0 ? (
            <div className="muted">No vitals found.</div>
          ) : (
            <div className="table-container">
              <table>
                <thead>
                  <tr>
                    <th>Time</th>
                    <th>Temperature</th>
                    <th>Heart Rate</th>
                    <th>SpO₂</th>
                    <th>Sources</th>
                  </tr>
                </thead>
                <tbody>
                  {vitals.map((r, i) => (
                    <tr key={r.id || i}>
                      <td>{r[COL_TIME] ? formatDt(r[COL_TIME]) : formatDt(r.created_at)}</td>
                      <td>{r[COL_TEMPERATURE] ?? r.temperature ?? '-'}</td>
                      <td>{r[COL_HEART_RATE] ?? r.heart_rate ?? '-'}</td>
                      <td>{r[COL_SPO2] ?? r.spo2 ?? '-'}</td>
                      <td style={{ opacity: 0.85 }}>
                        {r.source_temperature || r.source_heart_rate || r.source_spo2 ? 'present' : 'n/a'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        {/* Documents */}
        <div className="card" style={{ marginTop: 16 }}>
          <h3 className="card-title">Documents</h3>
          {docs.length === 0 ? (
            <div className="muted">No documents found.</div>
          ) : (
            <div className="files-grid">
              {docs.map(d => (
                <div key={d.id} className="file-card">
                  <div className="file-header">
                    <div className="file-icon">📄</div>
                    <div className="file-info">
                      <div className="file-name" title={d.name}>{d.name}</div>
                      <div className="file-meta">{d.type || 'file'} • {(d.size || 0)} bytes</div>
                      <div className="file-meta" style={{ opacity: 0.8 }}>Uploaded: {formatDt(d.uploaded_at)}</div>
                      {d.publicUrl && (
                        <a href={d.publicUrl} target="_blank" rel="noreferrer" className="btn btn-outline btn-sm" style={{ marginTop: 6 }}>Open</a>
                      )}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Questionnaire responses */}
        <div className="card" style={{ marginTop: 16 }}>
          <h3 className="card-title">Questionnaire Responses</h3>
          {!qr ? (
            <div className="muted">No questionnaire responses found.</div>
          ) : (
            <div>
              <div className="muted">Submitted: {formatDt(qr.submitted_at)}</div>
              {qr.responses && typeof qr.responses === 'object' ? (
                <div style={{ marginTop: 8 }}>
                  {Object.entries(qr.responses).map(([qid, val]) => (
                    <div key={qid} style={{ marginBottom: 6 }}>
                      <strong>Q{qid}:</strong> {Array.isArray(val) ? val.join(', ') : String(val)}
                    </div>
                  ))}
                </div>
              ) : (
                <div className="muted">No responses JSON.</div>
              )}
            </div>
          )}
        </div>

        {/* AI Report */}
        <div className="card" style={{ marginTop: 16 }}>
          <h3 className="card-title">Latest AI Report</h3>
          {!report ? (
            <div className="muted">No report found.</div>
          ) : (
            <div>
              <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                <span className={`badge ${report.severity === 'high' ? 'danger' : report.severity === 'medium' ? 'warning' : 'success'}`}>{report.severity || 'low'}</span>
                <span className="muted">Created: {formatDt(report.created_at)}</span>
              </div>
              <pre className="report-content" style={{ whiteSpace: 'pre-wrap', marginTop: 8 }}>{report.content}</pre>
            </div>
          )}
        </div>
      </div>
    </main>
  );
}
