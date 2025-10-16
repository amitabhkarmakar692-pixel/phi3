import React, { createContext, useContext, useEffect, useState } from 'react';
import { createClient } from '@supabase/supabase-js';
import {
  BrowserRouter as Router,
  Routes,
  Route,
  Link,
  Navigate,
  useNavigate,
} from 'react-router-dom';
import './App.css';
import HealthBackground from './components/HealthBackground';
import SensorIconsBackground from './components/SensorIconsBackground';
import VitalsPage from './components/VitalsPage';
import UploadDocumentsPage from './components/UploadDocumentsPage';
import DoctorPatientView from './components/DoctorPatientView';
import DoctorProfilePage from './components/DoctorProfilePage';
import DoctorDirectoryPage from './components/DoctorDirectoryPage';
import DoctorPublicProfilePage from './components/DoctorPublicProfilePage';
import AIQuestionnairesPage from './components/AIQuestionnairesPage';

// Config
const SUPABASE_URL = process.env.REACT_APP_SUPABASE_URL;
const SUPABASE_ANON_KEY = process.env.REACT_APP_SUPABASE_ANON_KEY;
const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

// AI provider config
const AI_PROVIDER = (process.env.REACT_APP_AI_PROVIDER || 'openai').toLowerCase();
const OPENAI_API_KEY = process.env.REACT_APP_OPENAI_API_KEY;
const HF_API_TOKEN = process.env.REACT_APP_HF_API_TOKEN;
const HF_CHAT_MODEL = process.env.REACT_APP_HF_CHAT_MODEL || 'HuggingFaceH4/zephyr-7b-beta';

// Supabase table config (allow overriding via .env)
const TBL_REPORT = process.env.REACT_APP_TBL_REPORT || 'diagnoses';
const TBL_QR = process.env.REACT_APP_TBL_QR || 'questionnaire_responses';

async function openaiChat(messages) {
  let key = OPENAI_API_KEY;
  try {
    if (!key && typeof window !== 'undefined') {
      const stored = window.localStorage.getItem('OPENAI_API_KEY');
      if (stored) key = stored;
    }
  } catch (_) {}

  // If configured to use Hugging Face, route there
  if (AI_PROVIDER === 'huggingface') {
    return huggingfaceChat(messages);
  }

  if (!key) {
    throw new Error('Missing OpenAI API key');
  }

  // Try a sequence of models to handle accounts without gpt-4 access
  const models = ['gpt-4', 'gpt-4-0613', 'gpt-3.5-turbo'];
  let lastErr = null;

  for (const model of models) {
    try {
      const res = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${key}`,
        },
        body: JSON.stringify({
          model,
          temperature: 0.2,
          messages,
        }),
      });

      if (!res.ok) {
        const text = await res.text().catch(() => '');
        // If quota exceeded, throw immediately and let caller handle fallback
        if (res.status === 429 || /quota|insufficient_quota/i.test(text)) {
          throw new Error(`OpenAI quota exceeded: ${res.status} ${text}`);
        }
        // If model not found, try next model
        lastErr = new Error(`OpenAI error: ${res.status} ${text}`);
        if (res.status === 404 || /model.*not.*found|model_not_found/i.test(text)) {
          continue;
        }
        throw lastErr;
      }

      const data = await res.json();
      return data?.choices?.[0]?.message?.content?.trim() || '';
    } catch (e) {
      lastErr = e;
      // if error indicates model not available, try next; otherwise rethrow
      if (/model.*not.*found|model_not_found/i.test(e?.message || '')) {
        continue;
      }
      throw e;
    }
  }

  throw lastErr || new Error('OpenAI request failed');
}

async function huggingfaceChat(messages) {
  // Build a simple instruction-style prompt from messages
  const sys = (messages || []).filter(m => m.role === 'system').map(m => m.content).join('\n');
  const user = (messages || []).filter(m => m.role !== 'system').map(m => `${m.role.toUpperCase()}: ${m.content}`).join('\n');
  const prompt = `${sys ? `System: ${sys}\n\n` : ''}${user}\n\nAssistant:`;

  // Optional: Client-direct mode (browser -> HF endpoint); requires endpoint CORS
  try {
    if (typeof window !== 'undefined') {
      const directOn = window.localStorage.getItem('DIRECT_AI_ENABLED') === 'true';
      const directUrl = (window.localStorage.getItem('HF_DIRECT_ENDPOINT_URL') || '').trim();
      const directTok = (window.localStorage.getItem('HF_DIRECT_TOKEN') || '').trim();
      if (directOn && directUrl && directTok) {
        const res = await fetch(directUrl.replace(/\/$/, ''), {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${directTok}` },
          body: JSON.stringify({
            inputs: prompt,
            parameters: { max_new_tokens: 512, temperature: 0.3, return_full_text: false },
            options: { wait_for_model: true }
          })
        });
        const text = await res.text().catch(() => '');
        if (!res.ok) throw new Error(`Direct HF error: ${res.status} ${text}`);
        try {
          const data = JSON.parse(text);
          if (Array.isArray(data) && data[0]?.generated_text) return String(data[0].generated_text).trim();
          if (data && typeof data === 'object' && (data.generated_text || data.output_text)) return String(data.generated_text || data.output_text).trim();
          return (typeof data === 'string' ? data : text).trim();
        } catch {
          return text.trim();
        }
      }
    }
  } catch (_) {
    // Ignore and fall through to proxy/direct server-side
  }

  // Prefer backend proxy to avoid browser CORS and avoid exposing tokens
  const SERVER_BASE = (process.env.REACT_APP_SERVER_BASE || '').replace(/\/$/, '');
  if (SERVER_BASE) {
    try {
      const proxyRes = await fetch(`${SERVER_BASE}/api/v1/ai/hf`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prompt, parameters: { max_new_tokens: 512, temperature: 0.3, return_full_text: false } })
      });
      if (proxyRes.ok) {
        const j = await proxyRes.json().catch(() => ({}));
        if (j && j.ok && typeof j.text === 'string' && j.text.trim()) {
          return String(j.text).trim();
        }
      }
      // If proxy returns an error, fall through to direct call below
    } catch (_) {
      // Fall back to direct HF call
    }
  }

  // Direct HF call (requires token available client-side)
  let token = undefined;
  try {
    if (typeof window !== 'undefined') {
      const stored = window.localStorage.getItem('HF_API_TOKEN');
      if (stored) token = stored;
    }
  } catch (_) {}
  if (!token) token = HF_API_TOKEN;
  if (!token) throw new Error('Missing Hugging Face API token');

  // Prefer a dedicated Inference Endpoint if provided; otherwise use public Inference API
  const HF_ENDPOINT = (process.env.REACT_APP_HF_ENDPOINT_URL || '').trim();
  const HF_ENDPOINT_MODE = (process.env.REACT_APP_HF_ENDPOINT_MODE || '').toLowerCase();
  const baseUrl = HF_ENDPOINT
    ? HF_ENDPOINT.replace(/\/$/, '')
    : `https://api-inference.huggingface.co/models/${encodeURIComponent(HF_CHAT_MODEL)}`;
  // Retry a few times to handle model cold starts (503) or transient errors
  const maxRetries = 3;
  let lastErr = null;
  for (let attempt = 0; attempt < maxRetries; attempt++) {
    // Decide path/body based on mode
    let path = '';
    let body = null;
    if (HF_ENDPOINT_MODE === 'openai-chat') {
      path = '/v1/chat/completions';
      body = JSON.stringify({
        model: HF_CHAT_MODEL,
        messages: [{ role: 'user', content: prompt }],
        max_tokens: 512,
        temperature: 0.3,
        stream: false
      });
    } else if (HF_ENDPOINT_MODE === 'openai-completions') {
      path = '/v1/completions';
      body = JSON.stringify({
        model: HF_CHAT_MODEL,
        prompt,
        max_tokens: 512,
        temperature: 0.3,
        stream: false
      });
    } else {
      // HF default
      path = '';
      body = JSON.stringify({
        inputs: prompt,
        parameters: {
          max_new_tokens: 512,
          temperature: 0.3,
          return_full_text: false
        },
        options: { wait_for_model: true }
      });
    }

    const res = await fetch(baseUrl + path, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`
      },
      body
    });

    if (!res.ok) {
      const text = await res.text().catch(() => '');
      // If 404/405 and we used HF default, try OpenAI chat path as a fallback
      if (!HF_ENDPOINT_MODE && (res.status === 404 || res.status === 405) && HF_ENDPOINT) {
        await new Promise(r => setTimeout(r, 500));
        const res2 = await fetch(baseUrl + '/v1/chat/completions', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${token}`
          },
          body: JSON.stringify({
            model: HF_CHAT_MODEL,
            messages: [{ role: 'user', content: prompt }],
            max_tokens: 512,
            temperature: 0.3,
            stream: false
          })
        });
        if (res2.ok) {
          const j2 = await res2.json();
          const out2 = j2?.choices?.[0]?.message?.content || j2?.choices?.[0]?.text || '';
          if (out2) return String(out2).trim();
        }
      }
      // If the model is loading or a transient error occurred, retry with backoff
      if (res.status === 503 || /loading/i.test(text)) {
        lastErr = new Error(`Hugging Face loading: ${res.status} ${text}`);
        await new Promise(r => setTimeout(r, 1500 * (attempt + 1)));
        continue;
      }
      throw new Error(`Hugging Face error: ${res.status} ${text}`);
    }
    const data = await res.json();
    // Parse and return on success
    if (Array.isArray(data) && data[0]?.generated_text) {
      return String(data[0].generated_text).trim();
    }
    if (data?.generated_text) return String(data.generated_text).trim();
    const first = (data?.[0]?.output_text || data?.[0]?.summary_text || data?.[0]?.answer || '').trim();
    if (first) return first;
    return String(data).slice(0, 2000);
  }
  throw lastErr || new Error('Hugging Face request failed');
}

// Medical AI helper class
class MedicalAI {
  static async analyzePatientData(patientData, context = {}) {
    const systemPrompt = `You are a medical diagnosis assistant analyzing:
- Patient: ${patientData.age || 'unknown'}yo ${patientData.gender || ''}
- Symptoms: ${JSON.stringify(patientData.symptoms || {})}
- Vitals: ${JSON.stringify(patientData.vitals || {})}
- History: ${patientData.history || 'none'}
- Medications: ${patientData.medications || 'none'}
- Context: ${JSON.stringify(context || {})}

Provide structured analysis with:
1. Differential Diagnosis (ranked)
2. Recommended Tests
3. Treatment Options
4. Risk Assessment
5. Follow-up Plan

Use medical terminology but explain complex terms. Format as markdown.`;

    try {
      const response = await this._callAI([
        { role: 'system', content: systemPrompt },
        { role: 'user', content: 'Please analyze this case comprehensively.' }
      ]);

      try {
        await supabase.from(TBL_REPORT).insert([{
          patient_id: patientData.patientId || null,
          doctor_id: patientData.doctorId || null,
          content: response,
          ai_generated: true,
          severity: this._determineSeverity(response),
          metadata: {
            vitals: patientData.vitals || {},
            symptoms: patientData.symptoms || {},
            context
          }
        }]);
      } catch (e) {
        console.warn('Failed to save diagnosis:', e.message);
      }

      return response;
    } catch (error) {
      console.error('AI Analysis Error:', error);
      return this._getFallbackAnalysis(patientData);
    }
  }

  static _getFallbackAnalysis(patientData) {
    return `Demo Analysis (AI Unavailable)
    
**Differential Diagnosis**:
1. Viral Upper Respiratory Infection (40%)
2. Dehydration (30%)
3. Anxiety Disorder (20%)
4. Other (10%)

**Recommended Tests**:
- Complete Blood Count (CBC)
- Comprehensive Metabolic Panel (CMP)
- COVID-19 test if febrile

**Treatment Options**:
- Rest and hydration
- Antipyretics if fever > 101°F
- Follow-up in 3 days if symptoms persist

**Risk Assessment**: Low
**Follow-up Plan**: Telehealth visit in 3 days

Latest vitals: ${JSON.stringify(patientData.vitals || {})}`;
  }

  static async diagnose(patientData) {
    return this.analyzePatientData(patientData);
  }

  static async generateQuestionnaire(patientContext) {
    try {
      const contextSummary = JSON.stringify(patientContext || {});
      const systemPrompt = `You are a medical questionnaire generator. Using the provided patient context, generate a thorough clinical questionnaire designed to capture symptoms, vitals, relevant history, and document-relevant questions.\n\nSTRICT OUTPUT FORMAT (CRITICAL):\n- Return ONLY valid JSON.\n- Output must be ONLY a valid JSON array (no prose, no markdown, no backticks, no code fences).\n- Use double quotes for all keys and string values.\n- Include at least 15 items.\n- Each item MUST include exactly these fields: id (number), text (string), type (one of: "radio", "checkbox", "range", "text", "scale"), required (boolean).\n- Include an "options" (array of strings) ONLY when type is "radio" or "checkbox".\n- For type "range" or "scale", include numeric min and max fields.\n- Keep wording concise and clinically relevant.\n- Use the patient context to tailor a subset of questions.\n\nEXAMPLE (FORMAT ONLY, NOT CONTENT):\n[\n  {"id": 1, "text": "Chief complaint?", "type": "text", "required": true},\n  {"id": 2, "text": "Do you have a fever?", "type": "radio", "required": true, "options": ["Yes", "No"]}\n]\n\nReturn ONLY the JSON array. Do not include any text before or after.\n\nPatient context: ${contextSummary}`;

      const response = await this._callAI([
        { role: 'system', content: systemPrompt },
        { role: 'user', content: 'Return ONLY valid JSON. Output only the JSON array of questions as described. No commentary. No markdown or code fences.' }
      ]);
      try {
        return this._parseQuestionnaire(response);
      } catch (parseErr) {
        // One-shot repair: ask the AI to convert to strict JSON array
  const repairInstr = `You will receive a draft questionnaire response that may contain prose or invalid JSON. Convert it into a VALID JSON array that follows this schema EXACTLY and return ONLY valid JSON (no prose, no markdown, no code fences):\n- Each item: { id:number, text:string, type:"radio"|"checkbox"|"range"|"text"|"scale", required:boolean, options?:string[], min?:number, max?:number }\n- Use double quotes for all keys and string values.\n- Include at least 15 items.\n- Include options only for radio/checkbox.\n- Include min and max only for range/scale.`;
        const repaired = await this._callAI([
          { role: 'system', content: repairInstr },
          { role: 'user', content: String(response || '') }
        ]);
        return this._parseQuestionnaire(repaired);
      }
    } catch (e) {
      console.error('Failed to generate questionnaire:', e);
      const msg = e?.message || '';
      throw new Error(`AI questionnaire generation failed. ${msg}`.trim());
    }
  }

  static _parseQuestionnaire(response) {
    try {
      const sanitize = (s) => {
        if (!s) return '';
        let t = String(s);
        // Strip code fences and headings
        t = t.replace(/```(?:json)?[\s\S]*?```/gi, (m) => m.replace(/```(?:json)?/i, '').replace(/```$/, ''));
        t = t.replace(/^#+\s.*$/gm, ''); // remove markdown headers
        // If contains a JSON array somewhere, slice to it
        const first = t.indexOf('[');
        const last = t.lastIndexOf(']');
        if (first !== -1 && last !== -1 && last > first) t = t.slice(first, last + 1);
        // Remove trailing commas before } or ]
        t = t.replace(/,\s*([}\]])/g, '$1');
        // Normalize smart quotes
        t = t.replace(/[“”]/g, '"').replace(/[‘’]/g, "'");
        return t.trim();
      };

      let text = sanitize(response);
      let arr = [];
      try {
        arr = JSON.parse(text);
      } catch {
        // last resort: try to extract the largest JSON array again
        const m = text.match(/\[[\s\S]*\]/);
        if (m) {
          const cleaned = sanitize(m[0]);
          arr = JSON.parse(cleaned);
        } else {
          throw new Error('No JSON array found');
        }
      }

      if (!Array.isArray(arr)) throw new Error('Invalid questionnaire format');

      return arr.map((q, i) => {
        const type = ['radio','checkbox','range','text','scale'].includes(q.type) ? q.type : 'text';
        const base = {
          id: Number.isFinite(q.id) ? q.id : (parseInt(q.id, 10) || i + 1),
          text: String(q.text || `Question ${i + 1}`),
          type,
          required: typeof q.required === 'boolean' ? q.required : Boolean(q.required)
        };

        if (type === 'radio' || type === 'checkbox') {
          base.options = Array.isArray(q.options) ? q.options.map(String) : ['Yes', 'No'];
        }
        if (type === 'range' || type === 'scale') {
          base.min = Number.isFinite(q.min) ? q.min : 1;
          base.max = Number.isFinite(q.max) ? q.max : 10;
        }
        return base;
      });
    } catch (e) {
      console.warn('Questionnaire parse failed:', e);
      throw new Error('Failed to parse AI-generated questionnaire. Please try again.');
    }
  }


  static async _callAI(messages) {
    // Route to provider
    if (AI_PROVIDER === 'huggingface') {
      return huggingfaceChat(messages);
    }
    const key = OPENAI_API_KEY || (typeof window !== 'undefined' && window.localStorage.getItem('OPENAI_API_KEY'));
    if (!key) throw new Error('OpenAI API key not found');

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 30000);
    const models = ['gpt-4', 'gpt-4-0613', 'gpt-3.5-turbo'];
    let lastErr = null;

    try {
      for (const model of models) {
        try {
          const res = await fetch('https://api.openai.com/v1/chat/completions', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'Authorization': `Bearer ${key}`
            },
            body: JSON.stringify({ model, temperature: 0.3, messages, max_tokens: 2000 }),
            signal: controller.signal
          });

          if (!res.ok) {
            const errorData = await res.json().catch(() => ({}));
            const errmsg = errorData.error?.message || `HTTP ${res.status}`;
            lastErr = new Error(errmsg);
            if (res.status === 404 || /model.*not.*found|model_not_found/i.test(errmsg)) {
              continue; // try next model
            }
            throw lastErr;
          }

          const data = await res.json();
          return data?.choices?.[0]?.message?.content || '';
        } catch (e) {
          lastErr = e;
          if (/model.*not.*found|model_not_found/i.test(e?.message || '')) {
            continue; // try next model
          }
          throw e;
        }
      }
    } finally {
      clearTimeout(timeout);
    }

    throw lastErr || new Error('OpenAI request failed');
  }

  static _determineSeverity(text) {
    const lower = (text || '').toLowerCase();
    if (lower.includes('emergency') || lower.includes('immediate')) return 'high';
    if (lower.includes('urgent') || lower.includes('soon')) return 'medium';
    return 'low';
  }
}

// Auth context
const AuthContext = createContext(null);

function useAuth() {
  return useContext(AuthContext);
}

function AuthProvider({ children }) {
  const [session, setSession] = useState(null);
  const [profile, setProfile] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let mounted = true;

    async function init() {
      const { data: { session } } = await supabase.auth.getSession();
      if (!mounted) return;
      setSession(session);

      if (session?.user) {
        try {
          const p = await fetchProfile(session.user.id);
          setProfile(p);
        } finally {
          setLoading(false);
        }
      } else {
        setLoading(false);
      }

      const { data: { subscription } } = supabase.auth.onAuthStateChange(async (event, sess) => {
        setLoading(true);
        setSession(sess);
        if (sess?.user) {
          const p = await fetchProfile(sess.user.id);
          setProfile(p);
        } else {
          setProfile(null);
        }
        setLoading(false);
      });

      return () => {
        mounted = false;
        subscription?.unsubscribe();
      };
    }

    init();
  }, []);

  async function fetchProfile(userId) {
    // Try to fetch existing profile
    const { data: existing, error: selError } = await supabase
      .from('profiles')
      .select('id, full_name, role')
      .eq('id', userId)
      .single();

    if (!selError && existing) {
      // Ensure doctor has a public profile row after login
      if (existing.role === 'doctor') {
        try {
          const { data: userRes } = await supabase.auth.getUser();
          const email = userRes?.user?.email || null;
          await supabase.from('doctor_profiles').upsert({
            user_id: userId,
            full_name: existing.full_name || (email ? email.split('@')[0] : null),
            email: email || null
          });
        } catch (e) {
          console.warn('ensure doctor_profiles (existing) failed:', e?.message || e);
        }
      } else if (existing.role === 'patient') {
        // Ensure a patient profile row exists for patients
        try {
          await supabase.from('patient_profiles').upsert({
            user_id: userId,
            full_name: existing.full_name || null,
            phone: '',
            address: '',
            medical_history: '',
            current_medications: ''
          });
        } catch (e) {
          console.warn('ensure patient_profiles (existing) failed:', e?.message || e);
        }
      }
      return existing;
    }

    // Create default profile if not found (prefer user metadata from signup)
    const { data: userRes } = await supabase.auth.getUser();
    const email = userRes?.user?.email || 'user@example.com';
    const meta = userRes?.user?.user_metadata || {};
    const full_name = String(meta.full_name || email.split('@')[0]);
    const role = String(meta.role || (email.endsWith('@hospital.com') ? 'doctor' : 'patient'));

    const { data: upserted, error: upError } = await supabase
      .from('profiles')
      .upsert({ id: userId, full_name, role })
      .select()
      .single();

    if (upError) {
      console.error('Profile creation failed:', upError);
      return { id: userId, full_name, role };
    }

    // Ensure doctor has a public profile row after creating profile
    try {
      if ((upserted?.role || role) === 'doctor') {
        await supabase.from('doctor_profiles').upsert({
          user_id: userId,
          full_name: upserted?.full_name || full_name,
          email
        });
      } else if ((upserted?.role || role) === 'patient') {
        await supabase.from('patient_profiles').upsert({
          user_id: userId,
          full_name: upserted?.full_name || full_name,
          phone: '',
          address: '',
          medical_history: '',
          current_medications: ''
        });
      }
    } catch (e) {
      console.warn('ensure doctor_profiles (created) failed:', e?.message || e);
    }

    return upserted;
  }

  async function updateProfileRole(newRole) {
    if (!session?.user) return;
    
    const email = session.user.email || 'user@example.com';
    const full_name = profile?.full_name || email.split('@')[0];
    
    await supabase
      .from('profiles')
      .upsert({ id: session.user.id, full_name, role: newRole });
      
    try {
      window.localStorage.setItem('roleOverride', newRole);
    } catch (_) {}
    
    setProfile(prev => ({ 
      ...(prev || { id: session.user.id, full_name }), 
      role: newRole 
    }));
  }

  return (
    <AuthContext.Provider value={{ session, profile, loading, updateProfileRole }}>
      {children}
    </AuthContext.Provider>
  );
}

function ProtectedRoute({ children, role }) {
  const auth = useAuth();
  const navigate = useNavigate();

  if (auth.loading) return <div className="p-6">Loading...</div>;
  if (!auth.session) return <Navigate to="/login" replace />;

  const effectiveRole = auth.profile?.role;

  if (role && effectiveRole !== role) {
    return <RoleGate requiredRole={role} />;
  }
  
  return children;
}

function RoleGate({ requiredRole }) {
  const auth = useAuth();
  const navigate = useNavigate();

  return (
    <div className="card" style={{ maxWidth: 560, margin: '40px auto' }}>
      <h2 className="card-title">Access restricted</h2>
      <p style={{ marginBottom: 16 }}>
        This area requires the "{requiredRole}" role. Your current role is "{auth.profile?.role || 'unknown'}".
      </p>
      
      <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
        <button
          className="btn btn-primary"
          onClick={() => {
            const r = auth.profile?.role;
            if (r === 'patient') navigate('/patient', { replace: true });
            else if (r === 'doctor') navigate('/doctor', { replace: true });
            else if (r === 'admin') navigate('/admin', { replace: true });
            else navigate('/', { replace: true });
          }}
        >
          Go to my portal
        </button>
      </div>
    </div>
  );
}

function Header() {
  const auth = useAuth();
  const navigate = useNavigate();

  async function signOut() {
    await supabase.auth.signOut();
    navigate('/login');
  }

  return (
    <header>
      <div className="header-content">
        <Link to="/" className="logo" title="Go to Home">
          <span className="logo-icon">🏥</span>
          SmartDocAid
        </Link>
        <nav className="nav-links">
          {!auth.session && (
            <Link to="/" className="nav-link">Home</Link>
          )}
          {auth.session && auth.profile && (
            <>
              {auth.profile.role === 'patient' && <Link to="/patient" className="nav-link">Patient</Link>}
              {auth.profile.role === 'doctor' && <Link to="/doctor" className="nav-link">Doctor</Link>}
              {auth.profile.role === 'doctor' && <Link to="/doctor/profile" className="nav-link">My Profile</Link>}
              {auth.profile.role === 'admin' && <Link to="/admin" className="nav-link">Admin</Link>}
            </>
          )}
        </nav>
        <div className="auth-buttons">
          {auth.session ? (
            <div className="flex items-center space-x-4">
              <span>{auth.profile?.full_name || auth.session.user.email}</span>
              <span className="badge" style={{ marginLeft: 8 }}>{auth.profile?.role || 'unknown'}</span>
              {auth.profile?.role === 'patient' && (
                <Link to="/patient/profile" className="btn btn-secondary" style={{ marginLeft: 8 }}>Edit Profile</Link>
              )}
              <button onClick={signOut} className="btn btn-danger" style={{ marginLeft: 8 }}>
                Sign Out
              </button>
            </div>
          ) : (
            <>
              <Link to="/login" className="btn btn-primary">Login</Link>
              <Link to="/signup" className="btn btn-secondary">Sign Up</Link>
            </>
          )}
        </div>
      </div>
    </header>
  );
}

function HomePage() {
  const auth = useAuth();
  
  return (
    <main>
      <div className="card">
  <h1>Welcome to SmartDocAid</h1>
        <p>A multi-portal healthcare app. Please login or sign up to continue.</p>
        
        {auth.session && (
          <div className="card" style={{backgroundColor: '#f0f9ff', marginTop: '20px'}}>
            <p>
              Logged in as <strong>{auth.profile?.full_name}</strong> ({auth.profile?.role})
            </p>
          </div>
        )}
        
        <div className="dashboard-grid">
          <div className="dashboard-card">
            <h3>Patient Portal</h3>
            <p>Access your health records, complete questionnaires, and monitor your vitals.</p>
            <Link to="/patient" className="btn btn-primary" style={{marginTop: '15px'}}>
              Enter Portal
            </Link>
          </div>
          
          <div className="dashboard-card">
            <h3>Doctor Portal</h3>
            <p>Manage patients, review data, and provide feedback on treatment plans.</p>
            <Link to="/doctor" className="btn btn-success" style={{marginTop: '15px'}}>
              Enter Portal
            </Link>
          </div>
          
          <div className="dashboard-card">
            <h3>Admin Portal</h3>
            <p>Manage users, system settings, and overall platform configuration.</p>
            <Link to="/admin" className="btn btn-secondary" style={{marginTop: '15px'}}>
              Enter Portal
            </Link>
          </div>
        </div>
      </div>
    </main>
  );
}

function LoginPage() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const auth = useAuth();
  const navigate = useNavigate();
  const [auxLoading, setAuxLoading] = useState({ magic: false, reset: false, resend: false });

  useEffect(() => {
    if (!auth.session) return;
    (async () => {
      try {
        const { data: userRes } = await supabase.auth.getUser();
        const uid = userRes?.user?.id;
        let nextRole = 'patient';
        if (uid) {
          try {
            const { data: prof } = await supabase
              .from('profiles')
              .select('role')
              .eq('id', uid)
              .single();
            if (prof?.role) nextRole = String(prof.role);
            else if (userRes?.user?.user_metadata?.role) nextRole = String(userRes.user.user_metadata.role);
          } catch (_) {
            if (userRes?.user?.user_metadata?.role) nextRole = String(userRes.user.user_metadata.role);
          }
        }
        navigate(`/${nextRole}`, { replace: true });
      } catch (_) {
        navigate('/', { replace: true });
      }
    })();
  }, [auth.session, navigate]);

  async function handleLogin(e) {
    e.preventDefault();
    setLoading(true);
    setError('');
    
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    
    if (error) {
      setError(error.message);
      // Common hint: unconfirmed email
      if (/confirm/i.test(error.message)) {
        try { alert('Your email may be unconfirmed. Please check your inbox for the confirmation email or click "Resend confirmation" below.'); } catch (_) {}
      }
    } else {
      try {
        // After successful login, route to the correct portal based on role
        const { data: userRes } = await supabase.auth.getUser();
        const uid = userRes?.user?.id;
        let role = 'patient';
        if (uid) {
          try {
            const { data: prof } = await supabase
              .from('profiles')
              .select('role, full_name')
              .eq('id', uid)
              .single();
            if (prof?.role) role = String(prof.role);
            else if (userRes?.user?.user_metadata?.role) role = String(userRes.user.user_metadata.role);
          } catch (_) {
            if (userRes?.user?.user_metadata?.role) role = String(userRes.user.user_metadata.role);
          }
        }
        navigate(`/${role}`);
      } catch (_) {
        // Fallback to home if role-based redirect fails
        navigate('/');
      }
    }
    
    setLoading(false);
  }

  async function loginWithMagicLink() {
    setAuxLoading(prev => ({ ...prev, magic: true }));
    setError('');
    try {
      if (!email) {
        setError('Enter your email first');
        return;
      }
      const redirectTo = `${window.location.origin}/login`;
      const { error } = await supabase.auth.signInWithOtp({
        email,
        options: { emailRedirectTo: redirectTo }
      });
      if (error) throw error;
      alert('Magic link sent. Check your email to complete sign-in.');
    } catch (e) {
      setError(e?.message || String(e));
    } finally {
      setAuxLoading(prev => ({ ...prev, magic: false }));
    }
  }

  async function resendConfirmation() {
    setAuxLoading(prev => ({ ...prev, resend: true }));
    setError('');
    try {
      if (!email) {
        setError('Enter your email first');
        return;
      }
      const redirectTo = `${window.location.origin}/login`;
      const { error } = await supabase.auth.resend({ type: 'signup', email, options: { emailRedirectTo: redirectTo } });
      if (error) throw error;
      alert('Confirmation email resent. Please check your inbox.');
    } catch (e) {
      setError(e?.message || String(e));
    } finally {
      setAuxLoading(prev => ({ ...prev, resend: false }));
    }
  }

  async function requestPasswordReset() {
    setAuxLoading(prev => ({ ...prev, reset: true }));
    setError('');
    try {
      if (!email) {
        setError('Enter your email first');
        return;
      }
      const redirectTo = `${window.location.origin}/reset-password`;
      const { error } = await supabase.auth.resetPasswordForEmail(email, { redirectTo });
      if (error) throw error;
      alert('Password reset email sent. Open the link on this device to set a new password.');
    } catch (e) {
      setError(e?.message || String(e));
    } finally {
      setAuxLoading(prev => ({ ...prev, reset: false }));
    }
  }

  return (
    <main>
      <div className="card form-container">
        <h2 className="card-title">Login</h2>
        {error && <div className="alert alert-danger">{error}</div>}
        <form onSubmit={handleLogin}>
          <div className="form-group">
            <label className="form-label">Email</label>
            <input
              className="form-input"
              placeholder="Email"
              value={email}
              onChange={e => setEmail(e.target.value)}
              type="email"
              required
            />
          </div>
          <div className="form-group">
            <label className="form-label">Password</label>
            <input
              className="form-input"
              placeholder="Password"
              value={password}
              onChange={e => setPassword(e.target.value)}
              type="password"
              required
            />
          </div>
          <button 
            type="submit" 
            disabled={loading} 
            className="btn btn-primary"
            style={{width: '100%', padding: '12px'}}
          >
            {loading ? 'Logging in...' : 'Login'}
          </button>
        </form>
        <div style={{marginTop: 16, display: 'grid', gap: 8}}>
          <button
            className="btn btn-secondary"
            onClick={loginWithMagicLink}
            disabled={auxLoading.magic}
            title="Send a magic sign-in link to your email"
          >
            {auxLoading.magic ? 'Sending…' : 'Login via Magic Link'}
          </button>
          <button
            className="btn btn-outline"
            onClick={resendConfirmation}
            disabled={auxLoading.resend}
            title="Resend email confirmation"
          >
            {auxLoading.resend ? 'Resending…' : 'Resend Confirmation Email'}
          </button>
          <button
            className="btn btn-outline"
            onClick={requestPasswordReset}
            disabled={auxLoading.reset}
            title="Send a password reset link to your email"
          >
            {auxLoading.reset ? 'Sending…' : 'Forgot Password? Reset'}
          </button>
        </div>
        <p style={{textAlign: 'center', marginTop: '20px'}}>
          Don't have an account? <Link to="/signup">Sign up</Link>
        </p>
      </div>
    </main>
  );
}

function ResetPasswordPage() {
  const [pw1, setPw1] = useState('');
  const [pw2, setPw2] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const navigate = useNavigate();

  useEffect(() => {
    // Attempt to set session from URL hash if present (access_token, refresh_token)
    (async () => {
      try {
        const hash = (typeof window !== 'undefined' ? window.location.hash : '') || '';
        const qs = new URLSearchParams(hash.replace(/^#/, ''));
        const at = qs.get('access_token');
        const rt = qs.get('refresh_token');
        if (at && rt) {
          await supabase.auth.setSession({ access_token: at, refresh_token: rt });
        }
      } catch (_) {}
    })();
  }, []);

  async function handleUpdatePassword(e) {
    e.preventDefault();
    setError('');
    if (pw1.length < 6) { setError('Password must be at least 6 characters'); return; }
    if (pw1 !== pw2) { setError('Passwords do not match'); return; }
    setLoading(true);
    try {
      const { error } = await supabase.auth.updateUser({ password: pw1 });
      if (error) throw error;
      alert('Password updated. You can now log in.');
      navigate('/login');
    } catch (e) {
      setError(e?.message || String(e));
    } finally {
      setLoading(false);
    }
  }

  return (
    <main>
      <div className="card form-container">
        <h2 className="card-title">Reset Password</h2>
        {error && <div className="alert alert-danger">{error}</div>}
        <form onSubmit={handleUpdatePassword}>
          <div className="form-group">
            <label className="form-label">New Password</label>
            <input
              className="form-input"
              type="password"
              value={pw1}
              onChange={e => setPw1(e.target.value)}
              required
            />
          </div>
          <div className="form-group">
            <label className="form-label">Confirm Password</label>
            <input
              className="form-input"
              type="password"
              value={pw2}
              onChange={e => setPw2(e.target.value)}
              required
            />
          </div>
          <button 
            type="submit" 
            disabled={loading} 
            className="btn btn-primary"
            style={{width: '100%', padding: '12px'}}
          >
            {loading ? 'Updating…' : 'Update Password'}
          </button>
        </form>
      </div>
    </main>
  );
}

function SignupPage() {
  const [fullName, setFullName] = useState('');
  const [role, setRole] = useState('patient');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const navigate = useNavigate();

  async function handleSignup(e) {
    e.preventDefault();
    setLoading(true);
    setError('');
    
    try {
      const { data, error: authError } = await supabase.auth.signUp({
        email,
        password,
        options: { data: { role, full_name: fullName } }
      });
      
      if (authError) {
        throw authError;
      }
      
      const userId = data.user?.id;
      if (userId) {
        await supabase.from('profiles').upsert({ 
          id: userId, 
          full_name: fullName, 
          role 
        });
        // If signing up as a doctor, also create a public doctor profile row so patients can find them immediately
        if (role === 'doctor') {
          try {
            await supabase.from('doctor_profiles').upsert({
              user_id: userId,
              full_name: fullName,
              email
            });
          } catch (e) {
            console.warn('doctor_profiles upsert failed (signup):', e?.message || e);
          }
        }
      }
      
      // If email confirmation is disabled and a session is created, route directly now by chosen role
      if (data?.session) {
        navigate(`/${role}`);
      } else {
        alert('Signup successful! Please check your email for confirmation.');
        navigate('/login');
      }
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <main>
      <div className="card form-container">
        <h2 className="card-title">Sign Up</h2>
        {error && <div className="alert alert-danger">{error}</div>}
        <form onSubmit={handleSignup}>
          <div className="form-group">
            <label className="form-label">Full Name</label>
            <input
              className="form-input"
              placeholder="Full Name"
              value={fullName}
              onChange={e => setFullName(e.target.value)}
              required
            />
          </div>
          <div className="form-group">
            <label className="form-label">Role</label>
            <select
              className="form-select"
              value={role}
              onChange={e => setRole(e.target.value)}
            >
              <option value="patient">Patient</option>
              <option value="doctor">Doctor</option>
              <option value="admin">Admin</option>
            </select>
          </div>
          <div className="form-group">
            <label className="form-label">Email</label>
            <input
              className="form-input"
              placeholder="Email"
              value={email}
              onChange={e => setEmail(e.target.value)}
              type="email"
              required
            />
          </div>
          <div className="form-group">
            <label className="form-label">Password</label>
            <input
              className="form-input"
              placeholder="Password"
              value={password}
              onChange={e => setPassword(e.target.value)}
              type="password"
              required
            />
          </div>
          <button 
            type="submit" 
            disabled={loading} 
            className="btn btn-primary"
            style={{width: '100%', padding: '12px'}}
          >
            {loading ? 'Signing up...' : 'Sign Up'}
          </button>
        </form>
      </div>
    </main>
  );
}

function PatientPortal() {
  const auth = useAuth();
  const navigate = useNavigate();
  const user = auth.session?.user || null;
  const patientId = user?.id || null;
  const [vitalsStatus, setVitalsStatus] = useState('offline'); // offline, measuring, measured
  const [vitalsTimestamp, setVitalsTimestamp] = useState(null);
  const [deviceStatus, setDeviceStatus] = useState('checking'); // checking | connected | offline | not-configured

  // Helper function to calculate data freshness
  const calculateDataFreshness = (timestamp) => {
    if (!timestamp) return 'old';
    
    const now = Date.now();
    const diffInMinutes = (now - timestamp) / (1000 * 60);
    
    if (diffInMinutes < 5) {
      return 'fresh';  // Less than 5 minutes old
    } else if (diffInMinutes < 30) {
      return 'stale';  // Less than 30 minutes old
    } else {
      return 'old';    // 30 minutes or older
    }
  };

  // Helper function to format timestamp
  const formatTimestamp = (timestamp) => {
    if (!timestamp) return 'Never';
    
    const date = new Date(timestamp);
    return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  };

  useEffect(() => {
    // Initialize status indicators when component mounts
    setVitalsStatus('offline');
  }, []);

  // Check Raspberry Pi device connectivity via /health endpoint
  const checkDevice = async () => {
    const base = process.env.REACT_APP_RPI_API_BASE;
    if (!base) {
      setDeviceStatus('not-configured');
      return;
    }
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 4000);
      const res = await fetch(`${base.replace(/\/$/, '')}/health`, { signal: controller.signal });
      clearTimeout(timeout);
      setDeviceStatus(res.ok ? 'connected' : 'offline');
    } catch (_) {
      setDeviceStatus('offline');
    }
  };

  useEffect(() => {
    checkDevice();
  }, []);

  // Removed inline health report generation from dashboard in favor of guided flow

  return (
    <main>
      <div className="card">
        <div className="dashboard-header">
          <h1>Patient Dashboard</h1>
          <p className="dashboard-subtitle">
            Your health at a glance. Track vitals, complete questionnaires, and view AI insights.
          </p>
          {auth.profile?.full_name && (
            <div style={{ marginTop: 12, color: 'rgba(255,255,255,0.85)' }}>
              Signed in as <strong>{auth.profile.full_name}</strong>{' '}
              {patientId && (
                <span style={{
                  marginLeft: 8,
                  padding: '4px 10px',
                  borderRadius: 999,
                  border: '1px solid var(--glass-border)',
                  background: 'var(--glass-bg)'
                }}>
                  PID-{patientId.slice(0, 8)}
                </span>
              )}
              <span style={{
                marginLeft: 8,
                padding: '4px 10px',
                borderRadius: 999,
                border: '1px solid var(--glass-border)',
                background: 'var(--glass-bg)'
              }}>
                {deviceStatus === 'checking' && 'Checking device…'}
                {deviceStatus === 'connected' && 'Connected to device'}
                {deviceStatus === 'offline' && 'Device offline'}
                {deviceStatus === 'not-configured' && 'Device not configured'}
              </span>
            </div>
          )}
        </div>

        <div className="dashboard-grid">
          <div className="dashboard-card">
            <h3>Temperature</h3>
            <div className="sensor-value-container">
              <div className="value">98.6°F</div>
              <div className="unit">Body Temp</div>
            </div>
            <div className="status-indicator-container">
              <div className={`status-indicator ${vitalsStatus}`}></div>
              <div className={`status-text ${vitalsStatus}`}>
                {vitalsStatus === 'offline' && 'No data connection'}
                {vitalsStatus === 'measuring' && 'Collecting vitals...'}
                {vitalsStatus === 'measured' && 'Vitals collected'}
              </div>
              {vitalsTimestamp && (
                <div className="timestamp">
                  Last updated: {new Date(vitalsTimestamp).toLocaleString()}
                </div>
              )}
              <div className={`data-freshness ${calculateDataFreshness(vitalsTimestamp)}`}>
                {formatTimestamp(vitalsTimestamp)}
              </div>
            </div>
          </div>

          <div className="dashboard-card">
            <h3>Heart Rate</h3>
            <div className="sensor-value-container">
              <div className="value">72</div>
              <div className="unit">bpm</div>
            </div>
            <div className="status-indicator-container">
              <div className={`status-indicator ${vitalsStatus}`}></div>
              <div className={`status-text ${vitalsStatus}`}>
                {vitalsStatus === 'offline' && 'No data connection'}
                {vitalsStatus === 'measuring' && 'Collecting vitals...'}
                {vitalsStatus === 'measured' && 'Vitals collected'}
              </div>
              {vitalsTimestamp && (
                <div className="timestamp">
                  Last updated: {new Date(vitalsTimestamp).toLocaleString()}
                </div>
              )}
              <div className={`data-freshness ${calculateDataFreshness(vitalsTimestamp)}`}>
                {formatTimestamp(vitalsTimestamp)}
              </div>
            </div>
          </div>

          <div className="dashboard-card">
            <h3>SpO2</h3>
            <div className="sensor-value-container">
              <div className="value">98%</div>
              <div className="unit">Oxygen Saturation</div>
            </div>
            <div className="status-indicator-container">
              <div className={`status-indicator ${vitalsStatus}`}></div>
              <div className={`status-text ${vitalsStatus}`}>
                {vitalsStatus === 'offline' && 'No data connection'}
                {vitalsStatus === 'measuring' && 'Collecting vitals...'}
                {vitalsStatus === 'measured' && 'Vitals collected'}
              </div>
              {vitalsTimestamp && (
                <div className="timestamp">
                  Last updated: {new Date(vitalsTimestamp).toLocaleString()}
                </div>
              )}
              <div className={`data-freshness ${calculateDataFreshness(vitalsTimestamp)}`}>
                {formatTimestamp(vitalsTimestamp)}
              </div>
            </div>
          </div>
        </div>

        <div className="ai-summary-section">
          <h3>Health Assessment</h3>
          <button
            onClick={() => navigate('/patient/vitals')}
            className="btn btn-primary btn-large"
            disabled={!user}
          >
            Start Health Assessment
          </button>
          <p className="muted" style={{ marginTop: 8 }}>
            You’ll be guided through vitals, uploads, and a questionnaire. An AI report is generated at the end.
          </p>
        </div>

        <div className="quick-access">
          <h3>Quick Access</h3>
          <div className="quick-access-grid">
            <Link to="/patient/vitals" className="quick-access-item">
              <span className="quick-access-icon">🩺</span>
              <span>Start Assessment</span>
            </Link>
            <Link to="/patient/questionnaire" className="quick-access-item">
              <span className="quick-access-icon">📝</span>
              <span>Health Questionnaire</span>
            </Link>
            <Link to="/patient/uploads" className="quick-access-item">
              <span className="quick-access-icon">📤</span>
              <span>Upload Documents</span>
            </Link>
            <Link to="/patient/doctors" className="quick-access-item">
              <span className="quick-access-icon">👨‍⚕️</span>
              <span>Doctors</span>
            </Link>
            <Link to="/patient/profile" className="quick-access-item">
              <span className="quick-access-icon">👤</span>
              <span>Edit Profile</span>
            </Link>
          </div>
        </div>
      </div>
    </main>
  );
}

function QuestionnairePage() {
  const [questions, setQuestions] = useState([]);
  const [currentStep, setCurrentStep] = useState(0);
  const [answers, setAnswers] = useState({});
  const [loading, setLoading] = useState({ generate: false, report: false });
  const [error, setError] = useState('');
  const [report, setReport] = useState('');
  const [keyInput, setKeyInput] = useState('');
  const [testLoading, setTestLoading] = useState(false);
  const [testResult, setTestResult] = useState('');
  // Optional client-direct HF endpoint settings
  const [directOn, setDirectOn] = useState(() => {
    try { return window.localStorage.getItem('DIRECT_AI_ENABLED') === 'true'; } catch { return false; }
  });
  const [directUrl, setDirectUrl] = useState(() => {
    try { return window.localStorage.getItem('HF_DIRECT_ENDPOINT_URL') || (process.env.REACT_APP_HF_ENDPOINT_URL || ''); } catch { return process.env.REACT_APP_HF_ENDPOINT_URL || ''; }
  });
  const [directTok, setDirectTok] = useState(() => {
    try { return window.localStorage.getItem('HF_DIRECT_TOKEN') || ''; } catch { return ''; }
  });
  // raw output from AI removed per request
  const provider = (process.env.REACT_APP_AI_PROVIDER || 'openai').toLowerCase();
  const haveKey = (() => {
    try {
      if (provider === 'huggingface') {
        return Boolean(
          process.env.REACT_APP_HF_API_TOKEN ||
          (typeof window !== 'undefined' && window.localStorage.getItem('HF_API_TOKEN'))
        );
      }
      return Boolean(
        process.env.REACT_APP_OPENAI_API_KEY ||
        (typeof window !== 'undefined' && window.localStorage.getItem('OPENAI_API_KEY'))
      );
    } catch (_) { return false; }
  })();
  const auth = useAuth();
  const navigate = useNavigate();

  async function testOpenAI() {
    setTestLoading(true);
    setTestResult('');
  // raw output from AI removed per request
    try {
      const qs = await MedicalAI.generateQuestionnaire({ test: true });
      setTestResult(`OK — received ${Array.isArray(qs) ? qs.length : 0} items`);
      console.log('MedicalAI.generateQuestionnaire result:', qs);
      // Auto-load into the questionnaire UI
      setQuestions(qs);
      setAnswers({});
      setCurrentStep(0);

      // Attempt to persist to Supabase if user is signed in
      try {
        const uid = auth?.session?.user?.id;
        if (uid) {
          const { data: inserted, error: insErr } = await supabase
            .from('questionnaires')
            .insert([{ user_id: uid, questions: qs }])
            .select()
            .single();
          if (!insErr && inserted) {
            setTestResult(prev => prev + ` — saved (id=${inserted.id})`);
          } else if (insErr) {
            setTestResult(prev => prev + ` — save failed: ${insErr.message}`);
          }
        }
      } catch (persistErr) {
        console.warn('Persist questionnaire failed:', persistErr);
        setTestResult(prev => prev + ' — save failed');
      }

      alert(`OpenAI test succeeded — received ${Array.isArray(qs) ? qs.length : 0} items.`);
    } catch (err) {
      console.error('OpenAI test failed', err);
      const prov = (process.env.REACT_APP_AI_PROVIDER || 'openai').toLowerCase();
      const label = prov === 'huggingface' ? 'Hugging Face' : 'OpenAI';
      setTestResult(`ERROR (${label}): ${err?.message || String(err)}`);
      alert(`${label} test failed: ${err?.message || String(err)}\n\nTips:\n- Ensure your ${label === 'Hugging Face' ? 'HF API Token' : 'OpenAI API Key'} is set (env or saved locally).\n- For Hugging Face, verify the model (${process.env.REACT_APP_HF_CHAT_MODEL || 'microsoft/phi-2'}) exists and your token has access.\n- If the model is cold, wait a few seconds and try again.`);
      // Clear questions on failure - no fallback questions
      setQuestions([]);
    } finally {
      setTestLoading(false);
    }
  }

  // Save direct mode settings to localStorage
  const saveDirectSettings = () => {
    try {
      window.localStorage.setItem('DIRECT_AI_ENABLED', String(directOn));
      window.localStorage.setItem('HF_DIRECT_ENDPOINT_URL', String(directUrl || '').trim());
      if (directTok) window.localStorage.setItem('HF_DIRECT_TOKEN', String(directTok || '').trim());
      alert('Direct AI settings saved');
    } catch (_) {
      alert('Failed to save Direct AI settings');
    }
  };

  // Smoke test sending a minimal JSON string as inputs to the direct endpoint
  async function testDirectJSON() {
    try {
      setTestLoading(true);
      const on = directOn; const url = (directUrl || '').trim(); const tok = (directTok || '').trim();
      if (!on || !url || !tok) throw new Error('Enable Direct AI and provide endpoint URL + token');
      const res = await fetch(url.replace(/\/$/, ''), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${tok}` },
        body: JSON.stringify({ inputs: '[{"id":1,"text":"ok","type":"text","required":true}]', parameters: { max_new_tokens: 8, temperature: 0.0, return_full_text: false }, options: { wait_for_model: true } })
      });
      const text = await res.text();
      if (!res.ok) throw new Error(`HTTP ${res.status} ${text}`);
      alert('Direct JSON test sent. Raw response (trimmed):\n' + (text.slice(0, 200)));
    } catch (e) {
      alert('Direct JSON test failed: ' + (e?.message || String(e)));
    } finally {
      setTestLoading(false);
    }
  }

  const handleAnswer = (questionId, value) => {
    setAnswers(prev => ({ ...prev, [questionId]: value }));
    try { window.localStorage.setItem('questionnaireAnswers', JSON.stringify({ ...answers, [questionId]: value })); } catch (_) {}
  };

  // Questions are generated by AI and are read-only

  async function saveKeyToLocal() {
    try {
      if (keyInput && typeof window !== 'undefined') {
        if (provider === 'huggingface') {
          window.localStorage.setItem('HF_API_TOKEN', keyInput.trim());
        } else {
          window.localStorage.setItem('OPENAI_API_KEY', keyInput.trim());
        }
        setError('');
        alert(`${provider === 'huggingface' ? 'Hugging Face token' : 'OpenAI key'} saved locally`);
      }
    } catch {
      alert('Failed to save key');
    }
  }

  async function generateQuestions() {
    setLoading(prev => ({ ...prev, generate: true }));
    setError('');
    
    try {
  // Collect context: recent vitals and uploaded document names for the current user
      let vitals = [];
      let uploads = [];

      try {
        const stored = typeof window !== 'undefined' ? window.localStorage.getItem('vitals_data') : null;
        vitals = stored ? JSON.parse(stored) : [];
      } catch (_) { vitals = []; }

      try {
        // attempt to list uploads from Supabase if auth available
        const uid = auth?.session?.user?.id;
        if (uid) {
          const bucket = process.env.REACT_APP_SUPABASE_BUCKET || 'uploads';
          const { data } = await supabase.storage.from(bucket).list(uid, { limit: 50 });
          uploads = (data || []).map(i => i.name);
        }
      } catch (_) { uploads = []; }

      try {
        const questions = await MedicalAI.generateQuestionnaire({ vitals, uploads });
        setQuestions(questions);
      } catch (e) {
        console.error('AI questionnaire generation failed:', e);
        setError(e?.message || 'AI questionnaire generation failed. Please check your OpenAI API key and try again.');
        setQuestions([]);
        // rethrow so caller (if any) can handle
        throw e;
      }
      setAnswers({});
      setReport('');
      setCurrentStep(0);
      try { window.localStorage.setItem('questionnaireAnswers', JSON.stringify({})); } catch (_) {}
    } catch (err) {
      setError(err.message || 'Failed to generate questions');
    } finally {
      setLoading(prev => ({ ...prev, generate: false }));
    }
  }

  async function generateReport() {
    setLoading(prev => ({ ...prev, report: true }));
    setError('');
    
    try {
      const summary = questions.map(q => {
        const answer = answers[q.id];
        return `${q.text}: ${Array.isArray(answer) ? answer.join(', ') : answer || 'N/A'}`;
      }).join('\n');

      const report = await openaiChat([
        { 
          role: 'system', 
          content: 'Generate a health report based on questionnaire answers. First provide a doctor-facing analysis, then patient-facing advice.' 
        },
        { 
          role: 'user', 
          content: summary 
        }
      ]);
      
      setReport(report);

      // Persist AI report to Supabase (report table)
      try {
        const uid = auth?.session?.user?.id;
        if (uid) {
          await supabase.from(TBL_REPORT).insert([{
            patient_id: uid,
            doctor_id: null,
            content: report,
            ai_generated: true,
            severity: MedicalAI._determineSeverity(report),
            metadata: { 
              from: 'questionnaire',
              answers: answers,
              created_via: 'QuestionnairePage.generateReport'
            }
          }]);
        }
      } catch (persistErr) {
        console.warn('Failed to save AI report:', persistErr?.message || persistErr);
      }
    } catch (err) {
      setError(err.message || 'Failed to generate report');
    } finally {
      setLoading(prev => ({ ...prev, report: false }));
    }
  }

  const handleSubmit = () => {
    (async () => {
      try {
        // Enforce at least one input across the flow (vitals, uploads, or questionnaire answers)
        const any = (() => {
          try {
            const vd = JSON.parse(window.localStorage.getItem('vitalsData') || window.localStorage.getItem('vitals_data') || 'null');
            const anyVital = vd && ((vd.temperature && vd.temperature.value != null) || (vd.heartRate && vd.heartRate.value != null) || (vd.spo2 && vd.spo2.value != null));
            const uploads = JSON.parse(window.localStorage.getItem('uploadedDocuments') || '[]');
            const anyUpload = Array.isArray(uploads) && uploads.length > 0;
            const ans = JSON.parse(window.localStorage.getItem('questionnaireAnswers') || '{}');
            const anyAnswer = ans && Object.values(ans).some(v => Array.isArray(v) ? v.length > 0 : (v !== undefined && v !== null && String(v).trim() !== ''));
            return Boolean(anyVital || anyUpload || anyAnswer);
          } catch (_) { return false; }
        })();
        if (!any) {
          alert('Please provide at least one input (a vital, an upload, or an answer) before submitting.');
          return;
        }
        const uid = auth?.session?.user?.id;
        if (uid) {
          await supabase.from(TBL_QR).insert([{
            patient_id: uid,
            responses: answers,
            submitted_at: new Date().toISOString()
          }]);
        }
      } catch (e) {
        console.warn('Failed to save questionnaire responses:', e?.message || e);
      } finally {
        alert('Questionnaire submitted successfully');
        setQuestions([]);
        setAnswers({});
        setCurrentStep(0);
        try { window.localStorage.removeItem('questionnaireAnswers'); } catch (_) {}
      }
    })();
  };

  const renderQuestion = (question) => {
    switch (question.type) {
      case 'radio':
        return (
          <div className="radio-group">
            {question.options.map(option => (
              <label key={option} className="radio-option">
                <input
                  type="radio"
                  name={`question-${question.id}`}
                  value={option}
                  checked={answers[question.id] === option}
                  onChange={() => handleAnswer(question.id, option)}
                />
                {option}
              </label>
            ))}
          </div>
        );
      case 'checkbox':
        return (
          <div className="checkbox-group">
            {question.options.map(option => {
              const selected = Array.isArray(answers[question.id]) ? answers[question.id] : [];
              return (
                <label key={option} className="checkbox-option">
                  <input
                    type="checkbox"
                    checked={selected.includes(option)}
                    onChange={() => {
                      const updated = selected.includes(option)
                        ? selected.filter(x => x !== option)
                        : [...selected, option];
                      handleAnswer(question.id, updated);
                    }}
                  />
                  {option}
                </label>
              );
            })}
          </div>
        );
      case 'range':
        return (
          <div className="range-container">
            <input
              type="range"
              min={question.min}
              max={question.max}
              value={answers[question.id] || Math.round((question.min + question.max) / 2)}
              onChange={e => handleAnswer(question.id, parseInt(e.target.value))}
              className="range-slider"
            />
            <div className="range-value">
              {answers[question.id] || Math.round((question.min + question.max) / 2)}
            </div>
          </div>
        );
      default:
        return (
          <textarea
            value={answers[question.id] || ''}
            onChange={e => handleAnswer(question.id, e.target.value)}
            className="textarea-input"
            placeholder="Your answer..."
          />
        );
    }
  };

  return (
    <main>
      <div className="card questionnaire-container">
        <div className="questionnaire-header">
          <h1 className="card-title">Health Questionnaire</h1>
          <div className="questionnaire-actions">
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <small style={{ color: haveKey ? 'green' : 'crimson' }}>
                {provider === 'huggingface' ? 'HF token' : 'OpenAI key'}: {haveKey ? 'found' : 'missing'}
              </small>
              <button
                className="btn btn-outline"
                onClick={testOpenAI}
                disabled={!haveKey || testLoading}
                title={`Quickly test the ${provider === 'huggingface' ? 'Hugging Face' : 'OpenAI'} integration`}
                style={{ marginLeft: 8 }}
              >
                {testLoading ? 'Testing…' : 'Test AI'}
              </button>
              {testResult && <small style={{ marginLeft: 8 }}>{testResult}</small>}
            </div>

            {!haveKey && (
              <>
                <input
                  type="password"
                  placeholder={provider === 'huggingface' ? 'Paste Hugging Face API Token' : 'Paste OpenAI API Key'}
                  value={keyInput}
                  onChange={e => setKeyInput(e.target.value)}
                  className="form-input"
                />
                <button 
                  className="btn btn-secondary" 
                  onClick={saveKeyToLocal}
                >
                  Save {provider === 'huggingface' ? 'HF Token' : 'OpenAI Key'}
                </button>
              </>
            )}
            <button
              className="btn btn-primary"
              onClick={generateQuestions}
              disabled={loading.generate}
            >
              {loading.generate ? 'Generating...' : 'Generate Questions'}
            </button>
          </div>
        </div>
        
        {error && <div className="alert alert-danger">{error}</div>}

            {/* Raw JSON display removed - questions are generated by AI only */}

        {questions.length === 0 ? (
          <div className="empty-state">
            <p>No questions loaded. Click "Generate Questions" to begin with AI-generated questions.</p>
            {error && <p style={{ color: 'red', marginTop: '10px' }}>{error}</p>}
          </div>
        ) : (
          <>
            {/* Manual save removed — AI generates and (if configured) Test action persists automatically */}

            <div className="progress-container">
              <div className="progress-info">
                <span>Question {currentStep + 1} of {questions.length}</span>
                <span style={{ marginLeft: 12 }}>{questions.length ? Math.round(((currentStep + 1) / questions.length) * 100) : 0}% Complete</span>
              </div>
              <div className="progress-bar">
                <div
                  className="progress-fill"
                  style={{ width: `${((currentStep + 1) / questions.length) * 100}%` }}
                ></div>
              </div>
            </div>

            <div className="question-container">
              <h2 className="question-text">{questions[currentStep]?.text}</h2>
              {questions[currentStep] && renderQuestion(questions[currentStep])}
            </div>

            <div className="questionnaire-navigation">
              <div>
                <button
                  onClick={() => setCurrentStep(prev => Math.max(0, prev - 1))}
                  disabled={currentStep === 0}
                  className="btn btn-secondary"
                >
                  Previous
                </button>
              </div>
              
              <div>
                {currentStep === questions.length - 1 ? (
                  <button 
                    onClick={async () => { try { await generateReport(); } catch (_) {} finally { handleSubmit(); } }} 
                    className="btn btn-success"
                  >
                    Submit & Generate Report
                  </button>
                ) : (
                  <button
                    onClick={() => setCurrentStep(prev => Math.min(questions.length - 1, prev + 1))}
                    className="btn btn-primary"
                  >
                    Next
                  </button>
                )}
              </div>

            </div>

            {report && (
              <div className="card report-container">
                <h3 className="card-title">AI Health Report</h3>
                <pre className="report-content">{report}</pre>
              </div>
            )}
          </>
        )}
      </div>
    </main>
  );
}

function SensorDataPage() {
  const [vitalsData] = useState([
    { time: "08:00", temp: 98.5, pulse: 72, spo2: 98 },
    { time: "12:00", temp: 98.6, pulse: 74, spo2: 97 },
    { time: "16:00", temp: 98.4, pulse: 73, spo2: 98 },
    { time: "20:00", temp: 98.7, pulse: 75, spo2: 99 }
  ]);

  useEffect(() => {
    try { 
      window.localStorage.setItem('vitals_data', JSON.stringify(vitalsData)); 
    } catch (e) {}
  }, [vitalsData]);

  return (
    <main>
      <div className="card">
        <h1 className="card-title">Sensor Data Monitoring</h1>
        
        <div className="dashboard-grid">
          <div className="dashboard-card">
            <h3>Current Temperature</h3>
            <div className="value">98.6°F</div>
          </div>
          <div className="dashboard-card">
            <h3>Current Heart Rate</h3>
            <div className="value">72 bpm</div>
          </div>
          <div className="dashboard-card">
            <h3>Current SpO2</h3>
            <div className="value">98%</div>
          </div>
        </div>
        
        <div className="card">
          <h3 className="card-title">24-Hour Vitals Trend</h3>
          <div className="vitals-chart">
            {vitalsData.map((data, index) => (
              <div key={index} className="vitals-bar">
                <div 
                  className="bar" 
                  style={{ height: `${data.temp * 2}px` }}
                ></div>
                <div className="bar-label">{data.time}</div>
              </div>
            ))}
          </div>
        </div>
        
        <div className="card">
          <h3 className="card-title">Device Status</h3>
          <div className="device-status">
            <div className="status-indicator connected"></div>
            <span>Connected - Last updated: Today, 20:15</span>
          </div>
        </div>
      </div>
    </main>
  );
}


function ProfilePage() {
  const auth = useAuth();
  const [editing, setEditing] = useState(false);
  const [profileData, setProfileData] = useState({
    fullName: "",
    email: "",
    phone: "",
    dob: "",
    address: "",
    patientId: null
  });
  const [loading, setLoading] = useState(true);
  const [copied, setCopied] = useState(false);
  const [deviceStatus, setDeviceStatus] = useState('checking'); // checking | connected | offline | not-configured

  useEffect(() => {
    if (auth.session?.user) {
      fetchPatientProfile();
    }
  }, [auth.session]);

  // Check Raspberry Pi device connectivity via /health endpoint
  const checkDevice = async () => {
    const base = process.env.REACT_APP_RPI_API_BASE;
    if (!base) {
      setDeviceStatus('not-configured');
      return;
    }
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 4000);
      const res = await fetch(`${base.replace(/\/$/, '')}/health`, { signal: controller.signal });
      clearTimeout(timeout);
      setDeviceStatus(res.ok ? 'connected' : 'offline');
    } catch (_) {
      setDeviceStatus('offline');
    }
  };

  useEffect(() => {
    // initial device check on mount
    checkDevice();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const fetchPatientProfile = async () => {
    if (!auth.session?.user?.id) return;

    setLoading(true);
    try {
      // Fetch patient profile from patient_profiles table
      const { data: patientProfile, error } = await supabase
        .from('patient_profiles')
        .select('*')
        .eq('user_id', auth.session.user.id)
        .single();

      if (patientProfile && !error) {
        setProfileData({
          fullName: patientProfile.full_name || auth.profile?.full_name || "",
          email: auth.session.user.email || "",
          phone: patientProfile.phone || "",
          dob: patientProfile.date_of_birth || "",
          address: patientProfile.address || "",
          patientId: patientProfile.id || null
        });
      } else {
        // If no patient profile exists, create one
        await createPatientProfile();
      }
    } catch (err) {
      console.error('Error fetching patient profile:', err);
      // Try to create a patient profile if fetch failed
      await createPatientProfile();
    } finally {
      setLoading(false);
    }
  };

  const createPatientProfile = async () => {
    if (!auth.session?.user?.id) return;

    try {
      const patientProfileData = {
        user_id: auth.session.user.id,
        full_name: auth.profile?.full_name || "",
        phone: "",
        date_of_birth: null,
        address: "",
        medical_history: "",
        current_medications: ""
      };

      const { data: newProfile, error } = await supabase
        .from('patient_profiles')
        .insert([patientProfileData])
        .select()
        .single();

      if (newProfile && !error) {
        setProfileData({
          fullName: newProfile.full_name || "",
          email: auth.session.user.email || "",
          phone: newProfile.phone || "",
          dob: newProfile.date_of_birth || "",
          address: newProfile.address || "",
          patientId: newProfile.id || null
        });
      } else {
        // Fallback to basic profile data if creation failed
        setProfileData({
          fullName: auth.profile?.full_name || "",
          email: auth.session.user.email || "",
          phone: "",
          dob: "",
          address: "",
          patientId: null
        });
      }
    } catch (err) {
      console.error('Error creating patient profile:', err);
      // Fallback to basic profile data
      setProfileData({
        fullName: auth.profile?.full_name || "",
        email: auth.session.user.email || "",
        phone: "",
        dob: "",
        address: "",
        patientId: null
      });
    }
  };

  const handleSave = async () => {
    if (!auth.session?.user?.id) return;

    setLoading(true);
    try {
      // Update basic profile in profiles table
      await supabase.from('profiles').upsert({
        id: auth.session.user.id,
        full_name: profileData.fullName
      });

      // Update or insert patient profile in patient_profiles table
      const patientProfileData = {
        user_id: auth.session.user.id,
        full_name: profileData.fullName,
        phone: profileData.phone,
        date_of_birth: profileData.dob,
        address: profileData.address
      };

      const { error } = await supabase
        .from('patient_profiles')
        .upsert(patientProfileData);

      if (error) {
        console.error('Patient profile update failed:', error);
      }

      setEditing(false);
    } catch (err) {
      console.error('Profile update failed:', err);
    } finally {
      setLoading(false);
    }
  };

  return (
    <main>
      <div className="card">
        <div className="profile-header">
          <h1 className="card-title">Profile Settings</h1>
          {editing ? (
            <button 
              onClick={handleSave}
              className="btn btn-success"
              disabled={loading}
            >
              {loading ? 'Saving...' : 'Save Changes'}
            </button>
          ) : (
            <button 
              onClick={() => setEditing(true)}
              className="btn btn-primary"
            >
              Edit Profile
            </button>
          )}
        </div>
        
        <div className="profile-grid">
          <div className="profile-section">
            <h3>Personal Information</h3>

            <div className="form-group">
              <label className="form-label">Device</label>
              <div className="form-display" style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                <span className={`badge ${deviceStatus === 'connected' ? 'success' : (deviceStatus === 'not-configured' ? '' : 'danger')}`}>
                  {deviceStatus === 'checking' && 'Checking...'}
                  {deviceStatus === 'connected' && 'Connected to device'}
                  {deviceStatus === 'offline' && 'Device offline'}
                  {deviceStatus === 'not-configured' && 'Device not configured'}
                </span>
                {deviceStatus !== 'checking' && (
                  <button
                    type="button"
                    className="btn btn-secondary btn-sm"
                    onClick={checkDevice}
                    title="Re-check device connection"
                  >
                    Re-check
                  </button>
                )}
              </div>
            </div>

            <div className="form-group">
              <label className="form-label">Patient ID (PID)</label>
              <div className="form-display" style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <span style={{ fontFamily: 'monospace', fontWeight: 'bold', color: '#2563eb' }}>
                  {profileData.patientId ? `PID-${profileData.patientId}` : 'Not assigned yet'}
                </span>
                {profileData.patientId && (
                  <button
                    type="button"
                    className="btn btn-secondary"
                    onClick={async () => {
                      try {
                        await navigator.clipboard.writeText(`PID-${profileData.patientId}`);
                        setCopied(true);
                        setTimeout(() => setCopied(false), 1500);
                      } catch (_) {}
                    }}
                  >
                    {copied ? 'Copied' : 'Copy'}
                  </button>
                )}
              </div>
            </div>

            <div className="form-group">
              <label className="form-label">Full Name</label>
              {editing ? (
                <input
                  type="text"
                  value={profileData.fullName}
                  onChange={e => setProfileData({...profileData, fullName: e.target.value})}
                  className="form-input"
                />
              ) : (
                <div className="form-display">{profileData.fullName}</div>
              )}
            </div>

            <div className="form-group">
              <label className="form-label">Email</label>
              <div className="form-display">{profileData.email}</div>
            </div>
            
            <div className="form-group">
              <label className="form-label">Phone</label>
              {editing ? (
                <input
                  type="tel"
                  value={profileData.phone}
                  onChange={e => setProfileData({...profileData, phone: e.target.value})}
                  className="form-input"
                />
              ) : (
                <div className="form-display">{profileData.phone || 'Not set'}</div>
              )}
            </div>
            
            <div className="form-group">
              <label className="form-label">Date of Birth</label>
              {editing ? (
                <input
                  type="date"
                  value={profileData.dob}
                  onChange={e => setProfileData({...profileData, dob: e.target.value})}
                  className="form-input"
                />
              ) : (
                <div className="form-display">{profileData.dob || 'Not set'}</div>
              )}
            </div>
            
            <div className="form-group">
              <label className="form-label">Address</label>
              {editing ? (
                <input
                  type="text"
                  value={profileData.address}
                  onChange={e => setProfileData({...profileData, address: e.target.value})}
                  className="form-input"
                />
              ) : (
                <div className="form-display">{profileData.address || 'Not set'}</div>
              )}
            </div>
          </div>
        </div>
      </div>
    </main>
  );
}

function DoctorPortal() {
  const [patients, setPatients] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [usingService, setUsingService] = useState(false);
  const [patientsCount, setPatientsCount] = useState(null);
  const [patientsCountMeta, setPatientsCountMeta] = useState(null);

  const TBL_VITALS = process.env.REACT_APP_TBL_VITALS || 'vitals';
  const COL_TIME = process.env.REACT_APP_COL_TIME || 'time';

  const getRiskClass = (risk) => {
    switch (risk) {
      case "high": return "badge-high";
      case "medium": return "badge-medium";
      case "low": return "badge-low";
      default: return "";
    }
  };

  const fetchLatestVitalsTime = async (userId) => {
    try {
      let q = await supabase.from(TBL_VITALS).select('*').eq('user_id', userId).order(COL_TIME, { ascending: false }).limit(1);
      if (q.error && /column|Could not find/i.test(q.error.message)) {
        q = await supabase.from(TBL_VITALS).select('*').eq('user_id', userId).order('created_at', { ascending: false }).limit(1);
      }
      if (q.error && /relation\s+"?vitals"?\s+does not exist/i.test(q.error.message) && TBL_VITALS === 'vitals') {
        let r2 = await supabase.from('vitales').select('*').eq('user_id', userId).order(COL_TIME, { ascending: false }).limit(1);
        if (r2.error && /column|Could not find/i.test(r2.error.message)) {
          r2 = await supabase.from('vitales').select('*').eq('user_id', userId).order('created_at', { ascending: false }).limit(1);
        }
        const row = (r2.data && r2.data[0]) || null;
        return row ? (row[COL_TIME] || row.created_at) : null;
      }
      const row = (q.data && q.data[0]) || null;
      return row ? (row[COL_TIME] || row.created_at) : null;
    } catch {
      return null;
    }
  };

  async function retryServiceFetch() {
    try {
      const BASE = (process.env.REACT_APP_VITALS_WRITER_URL || process.env.REACT_APP_SERVER_BASE || 'http://localhost:5001').replace(/\/$/, '');
      const health = await fetch(`${BASE}/health`);
      if (!health.ok) throw new Error('Service health not OK');

      // Prefer the richer list; fall back to /patients
      let list = [];
      try {
        const r1 = await fetch(`${BASE}/api/v1/patients-with-latest`);
        if (r1.ok) {
          const j1 = await r1.json();
          if (j1?.ok && Array.isArray(j1.patients)) list = j1.patients;
        }
      } catch (_) {}
      if (!list.length) {
        const r2 = await fetch(`${BASE}/api/v1/patients`);
        if (r2.ok) {
          const j2 = await r2.json();
          if (j2?.ok && Array.isArray(j2.patients)) list = j2.patients;
        }
      }
      if (list.length) {
        const svcList = list.map(p => ({
          user_id: p.user_id,
          name: p.full_name || p.name || p.email || `(UID ${String(p.user_id).slice(0, 8)}…)`,
          condition: '—',
          risk: 'low',
          lastCheck: p.lastCheck ? new Date(p.lastCheck).toLocaleString() : '—'
        }));
        setPatients(svcList);
        setUsingService(true);
        try {
          const map = Object.fromEntries(svcList.map(p => [String(p.user_id), p.name]));
          window.localStorage.setItem('patientNamesMap', JSON.stringify(map));
        } catch (_) {}
        return true;
      }
      throw new Error('Service returned empty list');
    } catch (e) {
      setError(e?.message || String(e));
      return false;
    }
  }

  useEffect(() => {
    let mounted = true;
    (async () => {
      setLoading(true);
      setError('');
      try {
        // If a service endpoint is available, prefer it to bypass RLS and list all patients
        try {
          const BASE = (process.env.REACT_APP_VITALS_WRITER_URL || process.env.REACT_APP_SERVER_BASE || 'http://localhost:5001').replace(/\/$/, '');
          const health = await fetch(`${BASE}/health`);
          if (health.ok) {
            setUsingService(true);
            // Fetch total patients from profiles via service
            let svcCount = null;
            try {
              const cRes = await fetch(`${BASE}/api/v1/patient-count`);
              if (cRes.ok) {
                const cJson = await cRes.json();
                if (cJson?.ok) {
                  svcCount = Number(cJson.count || 0);
                  setPatientsCount(svcCount);
                  setPatientsCountMeta(cJson.counts || null);
                }
              }
            } catch (_) {}

            // Try patients-with-latest first
            let svcList = [];
            try {
              const resp = await fetch(`${BASE}/api/v1/patients-with-latest`);
              if (resp.ok) {
                const json = await resp.json();
                if (json?.ok && Array.isArray(json.patients)) {
                  svcList = json.patients.map(p => ({
                    user_id: p.user_id,
                    name: p.full_name || p.name || p.email || `(UID ${String(p.user_id).slice(0, 8)}…)`,
                    condition: '\u2014',
                    risk: 'low',
                    lastCheck: p.lastCheck ? new Date(p.lastCheck).toLocaleString() : '\u2014'
                  }));
                }
              }
            } catch (_) {}

            // If service count suggests more patients than we received, fall back to /patients
            if ((svcCount != null) && (svcList.length < svcCount)) {
              try {
                const resp2 = await fetch(`${BASE}/api/v1/patients`);
                if (resp2.ok) {
                  const json2 = await resp2.json();
                  if (json2?.ok && Array.isArray(json2.patients)) {
                    const list2 = json2.patients.map(p => ({
                      user_id: p.user_id,
                      name: p.full_name || p.name || p.email || `(UID ${String(p.user_id).slice(0, 8)}…)`,
                      condition: '—',
                      risk: 'low',
                      lastCheck: '—'
                    }));
                    if (list2.length > svcList.length) svcList = list2;
                  }
                }
              } catch (_) {}
            }

            if (svcList.length) {
              if (mounted) {
                setPatients(svcList);
                // Persist a simple map of user_id -> name for detail page fallback
                try {
                  const map = Object.fromEntries((svcList || []).map(p => [String(p.user_id), p.name]));
                  window.localStorage.setItem('patientNamesMap', JSON.stringify(map));
                } catch (_) {}
              }
              // Early return: service provided list; avoid browser fallback that might be limited by RLS
              return;
            } else {
              // If service is up but empty list, continue to browser fallback below
              setUsingService(false);
            }
          }
        } catch (_) {
          // ignore service errors and fall back to Supabase
        }

        const { data, error } = await supabase
          .from('patient_profiles')
          .select('*')
          .order('created_at', { ascending: false })
          .limit(100);
        if (error) throw error;
        const ppList = Array.isArray(data) ? data : [];

        // Also load profiles to include patients without a patient_profiles row
        let profsAll = [];
        try {
          const { data: profs, error: pErr } = await supabase
            .from('profiles')
            .select('id,email,full_name,role')
            .limit(500);
          if (!pErr) profsAll = profs || [];
        } catch (_) {}

        // Build a map of candidates by user_id
        const byId = new Map();
        for (const p of ppList) {
          if (!p?.user_id) continue;
          byId.set(p.user_id, { source: 'patient_profiles', user_id: p.user_id, full_name: p.full_name, email: null, role: 'patient' });
        }
        for (const pr of profsAll) {
          if (!pr?.id) continue;
          // If role column exists and is not 'patient', skip adding as patient
          if (typeof pr.role === 'string' && pr.role && pr.role.toLowerCase() !== 'patient') {
            // Keep existing entry if already present from patient_profiles
            if (!byId.has(pr.id)) continue;
          }
          if (!byId.has(pr.id)) {
            byId.set(pr.id, { source: 'profiles', user_id: pr.id, full_name: pr.full_name, email: pr.email, role: pr.role || null });
          } else {
            const cur = byId.get(pr.id);
            // Prefer profiles.full_name over patient_profiles.full_name
            byId.set(pr.id, { ...cur, email: pr.email ?? cur.email, full_name: pr.full_name || cur.full_name });
          }
        }

        // Enrich with latest vitals time and friendly name
        const candidates = Array.from(byId.values());
        const enriched = [];
        for (const c of candidates) {
          const lastTime = await fetchLatestVitalsTime(c.user_id);
          enriched.push({
            user_id: c.user_id,
            name: c.full_name || c.email || `(UID ${String(c.user_id).slice(0, 8)}…)`,
            condition: '—',
            risk: 'low',
            lastCheck: lastTime ? new Date(lastTime).toLocaleString() : '—'
          });
        }
        // Sort by lastCheck desc then name
        enriched.sort((a, b) => String(b.lastCheck).localeCompare(String(a.lastCheck)) || String(a.name).localeCompare(String(b.name)));
        let finalList = enriched;

        // If we only received a small subset (likely due to RLS), try service fallback
        if (finalList.length <= 1) {
          try {
            const BASE = (process.env.REACT_APP_VITALS_WRITER_URL || process.env.REACT_APP_SERVER_BASE || 'http://localhost:5001').replace(/\/$/, '');
            const resp = await fetch(`${BASE}/api/v1/patients-with-latest`);
            if (resp.ok) {
              const json = await resp.json();
              if (json?.ok && Array.isArray(json.patients) && json.patients.length > finalList.length) {
                finalList = json.patients.map(p => ({
                  user_id: p.user_id,
                  name: p.full_name || p.name || p.email || `(UID ${String(p.user_id).slice(0, 8)}…)`,
                  condition: '—',
                  risk: 'low',
                  lastCheck: p.lastCheck ? new Date(p.lastCheck).toLocaleString() : '—'
                }));
                setUsingService(true);
              }
            } else {
              // surface partial info
              const txt = await resp.text().catch(() => '');
              console.warn('Service patients fetch failed:', resp.status, txt);
            }
          } catch (svcErr) {
            console.warn('Service patients fetch error:', svcErr?.message || svcErr);
          }
        }

        if (mounted) setPatients(finalList);
        // Persist a simple map of user_id -> name for detail page fallback
        try {
          const map = Object.fromEntries((finalList || []).map(p => [String(p.user_id), p.name]));
          window.localStorage.setItem('patientNamesMap', JSON.stringify(map));
        } catch (_) {}

        // Browser-side fallback: profiles count (role ilike 'patient') if service count not available
        try {
          if (patientsCount == null) {
            const { count: pCount } = await supabase
              .from('profiles')
              .select('id', { count: 'exact', head: true })
              .ilike('role', 'patient');
            if (mounted && (pCount || pCount === 0)) setPatientsCount(Number(pCount));
          }
        } catch (_) {}
      } catch (e) {
        if (mounted) setError(e?.message || String(e));
      } finally {
        if (mounted) setLoading(false);
      }
    })();
    return () => { mounted = false; };
  }, []);

  return (
    <main>
      <div className="card">
        <h1 className="card-title">Doctor Dashboard</h1>
        {usingService && (
          <div className="alert alert-info" style={{ marginTop: 8 }}>
            Showing patients via service endpoint (bypassing RLS). Configure REACT_APP_VITALS_WRITER_URL to change.
          </div>
        )}
        {patientsCountMeta && (
          <div className="muted" style={{ marginTop: 4, fontSize: 12 }}>
            Count breakdown (server): profiles={patientsCountMeta.profilesRolePatient}, patient_profiles={patientsCountMeta.patientProfiles}, union={patientsCountMeta.unionDistinct}
          </div>
        )}
        {error && (
          <div className="alert alert-danger" style={{ marginTop: 8 }}>
            {error}
          </div>
        )}
        {patientsCount != null && patients.length < patientsCount && (
          <div className="alert alert-warning" style={{ marginTop: 8 }}>
            Showing {patients.length} of {patientsCount} patients. Some results may be hidden by RLS.{' '}
            <button className="btn btn-outline" onClick={retryServiceFetch} style={{ marginLeft: 8 }}>Try service again</button>
          </div>
        )}
        <div style={{ marginTop: 8, opacity: 0.85 }}>
          {loading ? 'Loading patients…' : `${patientsCount != null ? patientsCount : patients.length} patient(s)`}
        </div>
        
        <div className="dashboard-grid">
          <div className="dashboard-card">
            <h3>Total Patients</h3>
            <div className="value">{patientsCount != null ? patientsCount : patients.length}</div>
          </div>
          <div className="dashboard-card">
            <h3>High Risk</h3>
            <div className="value">{patients.filter(p => p.risk === 'high').length}</div>
          </div>
          <div className="dashboard-card">
            <h3>Monitoring</h3>
            <div className="value">{patients.filter(p => p.risk === 'medium').length}</div>
          </div>
          <div className="dashboard-card">
            <h3>Stable</h3>
            <div className="value">{patients.filter(p => p.risk === 'low').length}</div>
          </div>
        </div>
        
        <div className="card">
          <h3 className="card-title">Patient List</h3>
          <div className="table-container">
            <table>
              <thead>
                <tr>
                  <th>Patient</th>
                  <th>Condition</th>
                  <th>Risk Level</th>
                  <th>Last Check</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {patients.map(patient => (
                  <tr key={patient.user_id}>
                    <td>{patient.name}</td>
                    <td>{patient.condition}</td>
                    <td>
                      <span className={`badge ${getRiskClass(patient.risk)}`}>
                        {patient.risk}
                      </span>
                    </td>
                    <td>{patient.lastCheck}</td>
                    <td>
                      <Link 
                        className="btn btn-primary" 
                        to={`/doctor/patient/${patient.user_id}`} 
                        state={{ name: patient.name }}
                      >
                        View Details
                      </Link>
                      <button className="btn btn-success">
                        Add Feedback
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </main>
  );
}

function AdminPortal() {
  const [users] = useState([
    { id: 1, name: "John Doe", role: "patient", email: "john@example.com", status: "active" },
    { id: 2, name: "Dr. Jane Smith", role: "doctor", email: "jane@example.com", status: "active" },
    { id: 3, name: "Admin User", role: "admin", email: "admin@example.com", status: "active" }
  ]);
  
  return (
    <main>
      <div className="card">
        <h1 className="card-title">Admin Dashboard</h1>
        
        <div className="dashboard-grid">
          <div className="dashboard-card">
            <h3>System Overview</h3>
            <div className="system-stats">
              <div>
                <div className="stat-value">142</div>
                <div className="stat-label">Total Users</div>
              </div>
              <div>
                <div className="stat-value">24</div>
                <div className="stat-label">Active Sessions</div>
              </div>
              <div>
                <div className="stat-value success">Operational</div>
                <div className="stat-label">System Status</div>
              </div>
            </div>
          </div>
        </div>
        
        <div className="card">
          <h3 className="card-title">User Management</h3>
          <div className="table-container">
            <table>
              <thead>
                <tr>
                  <th>User</th>
                  <th>Role</th>
                  <th>Email</th>
                  <th>Status</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {users.map(user => (
                  <tr key={user.id}>
                    <td>{user.name}</td>
                    <td>
                      <span className="badge">
                        {user.role}
                      </span>
                    </td>
                    <td>{user.email}</td>
                    <td>
                      <span className="badge success">
                        {user.status}
                      </span>
                    </td>
                    <td>
                      <button className="btn btn-primary">
                        Edit
                      </button>
                      <button className="btn btn-danger">
                        Disable
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </main>
  );
}

function App() {
  return (
    <AuthProvider>
      <Router>
        <div className="app-container">
          <HealthBackground />
          <SensorIconsBackground count={36} opacity={0.28} />
          <div className="content-layer">
            <Header />
            <Routes>
              <Route path="/" element={<HomePage />} />
              <Route path="/login" element={<LoginPage />} />
              <Route path="/signup" element={<SignupPage />} />
              <Route path="/reset-password" element={<ResetPasswordPage />} />
              
              <Route path="/patient" element={
                <ProtectedRoute role="patient">
                  <PatientPortal />
                </ProtectedRoute>
              } />
              <Route path="/patient/vitals" element={
                <ProtectedRoute role="patient">
                  <VitalsPage />
                </ProtectedRoute>
              } />
              <Route path="/patient/questionnaire" element={
                <ProtectedRoute role="patient">
                  <QuestionnairePage />
                </ProtectedRoute>
              } />
              <Route path="/patient/ai-questionnaires" element={
                <ProtectedRoute role="patient">
                  <AIQuestionnairesPage />
                </ProtectedRoute>
              } />
              <Route path="/patient/sensor-data" element={
                <ProtectedRoute role="patient">
                  <SensorDataPage />
                </ProtectedRoute>
              } />
              <Route path="/patient/uploads" element={
                <ProtectedRoute role="patient">
                  <UploadDocumentsPage />
                </ProtectedRoute>
              } />
              <Route path="/patient/profile" element={
                <ProtectedRoute role="patient">
                  <ProfilePage />
                </ProtectedRoute>
              } />
              <Route path="/patient/doctors" element={
                <ProtectedRoute role="patient">
                  <DoctorDirectoryPage />
                </ProtectedRoute>
              } />
              <Route path="/patient/doctors/:id" element={
                <ProtectedRoute role="patient">
                  <DoctorPublicProfilePage />
                </ProtectedRoute>
              } />
              
              <Route path="/doctor" element={
                <ProtectedRoute role="doctor">
                  <DoctorPortal />
                </ProtectedRoute>
              } />
              <Route path="/doctor/profile" element={
                <ProtectedRoute role="doctor">
                  <DoctorProfilePage />
                </ProtectedRoute>
              } />
              <Route path="/doctor/patient/:id" element={
                <ProtectedRoute role="doctor">
                  <DoctorPatientView />
                </ProtectedRoute>
              } />
              
              <Route path="/admin" element={
                <ProtectedRoute role="admin">
                  <AdminPortal />
                </ProtectedRoute>
              } />
            </Routes>
          </div>
        </div>
      </Router>
    </AuthProvider>
  );
}

export default App;
