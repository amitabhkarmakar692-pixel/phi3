import React, { useState, useRef, useCallback, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.REACT_APP_SUPABASE_URL;
const supabaseKey = process.env.REACT_APP_SUPABASE_ANON_KEY;
const supabase = createClient(supabaseUrl, supabaseKey);
const TBL_DOCS = process.env.REACT_APP_TBL_DOCS || 'documents';

const UploadDocumentsPage = () => {
  const navigate = useNavigate();
  const [uploadedFiles, setUploadedFiles] = useState([]);
  const [isUploading, setIsUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState({});
  const [error, setError] = useState('');
  const [dragActive, setDragActive] = useState(false);
  const fileInputRef = useRef(null);
  const [bucketFiles, setBucketFiles] = useState([]);
  const [docRows, setDocRows] = useState([]);
  const [isListing, setIsListing] = useState(false);
  const [lastStoragePrefix, setLastStoragePrefix] = useState('');

  const maxFileSize = 10 * 1024 * 1024; // 10MB
  const allowedTypes = [
    'image/jpeg',
    'image/jpg',
    'image/png',
    'application/pdf'
  ];


  // Handle drag events
  const handleDrag = useCallback((e) => {
    e.preventDefault();
    e.stopPropagation();
    if (e.type === 'dragenter' || e.type === 'dragover') {
      setDragActive(true);
    } else if (e.type === 'dragleave') {
      setDragActive(false);
    }
  }, []);

  // Handle file drop
  const handleDrop = useCallback((e) => {
    e.preventDefault();
    e.stopPropagation();
    setDragActive(false);

    const files = [...e.dataTransfer.files];
    handleFiles(files);
  }, []);

  // Handle file selection
  const handleFileSelect = (e) => {
    const files = [...e.target.files];
    handleFiles(files);
  };

  // Process selected files
  const handleFiles = async (files) => {
    const validFiles = [];
    const errors = [];

    files.forEach(file => {
      // Validate file type
      if (!allowedTypes.includes(file.type)) {
        errors.push(`${file.name}: Invalid file type. Please upload JPG, PNG, or PDF files.`);
        return;
      }

      // Validate file size
      if (file.size > maxFileSize) {
        errors.push(`${file.name}: File too large. Maximum size is 10MB.`);
        return;
      }

      validFiles.push(file);
    });

    if (errors.length > 0) {
      setError(errors.join('\n'));
      return;
    }

    setError('');
    await uploadFiles(validFiles);
    await refreshListings();
  };

  // Upload files to Supabase (or mock)
  const uploadFiles = async (files) => {
    setIsUploading(true);
    const newFiles = [];

    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      const fileId = `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
      const fileName = `${fileId}-${file.name}`;

      try {
        // Start progress
        setUploadProgress(prev => ({ ...prev, [fileId]: 0 }));

        // Upload to Supabase Storage
        const { data: userRes } = await supabase.auth.getUser();
        const uid = userRes?.user?.id;
        const bucket = process.env.REACT_APP_SUPABASE_BUCKET || 'uploads';
        const storagePath = uid ? `${uid}/${fileName}` : `anonymous/${fileName}`;
  const { error: upErr } = await supabase.storage.from(bucket).upload(storagePath, file, { upsert: true });
        if (upErr) throw upErr;
        const { data: urlData } = supabase.storage.from(bucket).getPublicUrl(storagePath);

        const uploadedFile = {
          id: fileId,
          name: file.name,
          fileName: fileName,
          size: file.size,
          type: file.type,
          url: urlData?.publicUrl || '',
          uploadedAt: new Date().toISOString(),
          status: 'completed'
        };

        newFiles.push(uploadedFile);

        // Update progress
        setUploadProgress(prev => ({ ...prev, [fileId]: 100 }));

        // Save metadata to documents table (best-effort)
        try {
          if (uid) {
            await supabase.from(TBL_DOCS).insert([{
              user_id: uid,
              name: file.name,
              path: storagePath,
              url: uploadedFile.url,
              size: file.size,
              type: file.type,
              uploaded_at: uploadedFile.uploadedAt
            }]);
          }
        } catch (metaErr) {
          console.warn('Failed to save document metadata:', metaErr?.message || metaErr);
        }

      } catch (err) {
        console.error('Upload failed:', err);
        const msg = err?.message || String(err);
        setError(`Upload failed: ${msg}\nCheck: bucket name "${process.env.REACT_APP_SUPABASE_BUCKET || 'uploads'}" exists, public or signed URL policy, and Storage policies allow uploads for your role.`);
        setUploadProgress(prev => ({ ...prev, [fileId]: 'error' }));
      }
    }

    setUploadedFiles(prev => [...prev, ...newFiles]);
    setIsUploading(false);
    try { localStorage.setItem('uploadedDocuments', JSON.stringify([...uploadedFiles, ...newFiles])); } catch (_) {}
  };

  // Removed mock upload; using Supabase Storage instead

  // Remove uploaded file
  const removeFile = (fileId) => {
    setUploadedFiles(prev => prev.filter(file => file.id !== fileId));
    setUploadProgress(prev => {
      const newProgress = { ...prev };
      delete newProgress[fileId];
      return newProgress;
    });
  };

  // Format file size
  const formatFileSize = (bytes) => {
    if (bytes === 0) return '0 Bytes';
    const k = 1024;
    const sizes = ['Bytes', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
  };

  // Get file icon based on type
  const getFileIcon = (type) => {
    if (type.includes('pdf')) return '📄';
    if (type.includes('image')) return '🖼️';
    return '📎';
  };

  // Handle next step
  const handleNext = () => {
    if (uploadedFiles.length === 0) {
      setError('Please upload at least one document before proceeding.');
      return;
    }

    // Store uploaded files data
    localStorage.setItem('uploadedDocuments', JSON.stringify(uploadedFiles));
    navigate('/patient/questionnaire');
  };

  // Handle back navigation
  const handleBack = () => {
    navigate('/patient/vitals');
  };

  const handleSkip = () => {
    try { localStorage.setItem('skippedUploads', 'true'); } catch (_) {}
    navigate('/patient/questionnaire');
  };

  // Diagnostics: list files in bucket and metadata rows
  const refreshListings = useCallback(async () => {
    setIsListing(true);
    try {
      const { data: userRes } = await supabase.auth.getUser();
      const uid = userRes?.user?.id;
      const bucket = process.env.REACT_APP_SUPABASE_BUCKET || 'uploads';
      const prefix = uid ? `${uid}/` : 'anonymous/';
      setLastStoragePrefix(`${bucket}/${prefix}`);

      // List storage files under prefix
      const { data: listData, error: listErr } = await supabase.storage.from(bucket).list(prefix, {
        limit: 100,
        offset: 0,
        sortBy: { column: 'name', order: 'asc' }
      });
      if (listErr) {
        setBucketFiles([]);
        throw listErr;
      }
      setBucketFiles(listData || []);

      // List metadata rows from documents table for this user (if logged in)
      if (uid) {
        const { data: rows, error: rowsErr } = await supabase
          .from(TBL_DOCS)
          .select('*')
          .eq('user_id', uid)
          .order('uploaded_at', { ascending: false })
          .limit(50);
        if (rowsErr) {
          console.warn('List documents metadata failed:', rowsErr.message);
          setDocRows([]);
        } else {
          setDocRows(rows || []);
        }
      } else {
        setDocRows([]);
      }
    } catch (e) {
      const msg = e?.message || String(e);
      setError(prev => prev ? prev + `\nList error: ${msg}` : `List error: ${msg}`);
    } finally {
      setIsListing(false);
    }
  }, []);

  useEffect(() => {
    refreshListings();
  }, [refreshListings]);

  // Calculate total upload progress
  const totalProgress = uploadedFiles.length > 0 ?
    Object.values(uploadProgress).reduce((sum, progress) =>
      sum + (typeof progress === 'number' ? progress : 0), 0
    ) / uploadedFiles.length : 0;

  return (
    <main>
      <div className="card">
        <div className="upload-header">
          <h1 className="card-title">Upload Medical Documents</h1>
          <p className="upload-subtitle">
            Upload your medical history, lab results, or any relevant documents for AI analysis
          </p>
        </div>

        {/* Upload Area */}
        <div className="upload-container">
          <div
            className={`upload-zone ${dragActive ? 'drag-active' : ''} ${isUploading ? 'uploading' : ''}`}
            onDragEnter={handleDrag}
            onDragLeave={handleDrag}
            onDragOver={handleDrag}
            onDrop={handleDrop}
            onClick={() => fileInputRef.current?.click()}
          >
            <div className="upload-icon">
              {isUploading ? '⏳' : '📁'}
            </div>
            <div className="upload-text">
              <h3>
                {isUploading ? 'Uploading Files...' : 'Drag and drop files here'}
              </h3>
              <p>or click to browse files</p>
              <small>
                Supported formats: JPG, PNG, PDF (Max 10MB each)
              </small>
            </div>

            {isUploading && (
              <div className="upload-progress">
                <div className="progress-bar">
                  <div
                    className="progress-fill"
                    style={{ width: `${totalProgress}%` }}
                  />
                </div>
                <div className="progress-text">{Math.round(totalProgress)}%</div>
              </div>
            )}
          </div>

          <input
            ref={fileInputRef}
            type="file"
            multiple
            accept=".jpg,.jpeg,.png,.pdf"
            onChange={handleFileSelect}
            style={{ display: 'none' }}
          />
        </div>

        {/* Error Display */}
        {error && (
          <div className="alert alert-danger">
            {error.split('\n').map((errorLine, index) => (
              <div key={index}>{errorLine}</div>
            ))}
          </div>
        )}

        {/* Uploaded Files */}
        {uploadedFiles.length > 0 && (
          <div className="uploaded-files">
            <h3>Uploaded Documents ({uploadedFiles.length})</h3>
            <div className="files-grid">
              {uploadedFiles.map((file) => (
                <div key={file.id} className="file-card">
                  <div className="file-header">
                    <div className="file-icon">{getFileIcon(file.type)}</div>
                    <div className="file-info">
                      <div className="file-name" title={file.name}>
                        {file.name}
                      </div>
                      <div className="file-meta">
                        {formatFileSize(file.size)} • {new Date(file.uploadedAt).toLocaleString()}
                      </div>
                    </div>
                    <button
                      className="btn btn-danger btn-sm"
                      onClick={() => removeFile(file.id)}
                      title="Remove file"
                    >
                      🗑️
                    </button>
                  </div>

                  {uploadProgress[file.id] !== undefined && (
                    <div className="file-progress">
                      <div className="progress-bar">
                        <div
                          className="progress-fill"
                          style={{ width: `${uploadProgress[file.id]}%` }}
                        />
                      </div>
                      <div className="progress-text">
                        {uploadProgress[file.id] === 'error' ? 'Error' : `${uploadProgress[file.id]}%`}
                      </div>
                    </div>
                  )}

                  {/* File Preview for Images */}
                  {file.type.includes('image') && (
                    <div className="file-preview">
                      <img
                        src={file.url}
                        alt={file.name}
                        onError={(e) => {
                          e.target.style.display = 'none';
                        }}
                      />
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Diagnostics: Supabase Storage listing */}
        <div className="uploaded-files" style={{ marginTop: 24 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <h3 style={{ margin: 0 }}>Supabase Storage</h3>
            <button className="btn btn-secondary btn-sm" onClick={refreshListings} disabled={isListing}>
              {isListing ? 'Refreshing…' : 'Refresh'}
            </button>
          </div>
          <div style={{ marginTop: 6, opacity: 0.8 }}>Prefix: {lastStoragePrefix || '(unknown)'}</div>
          <div className="files-grid" style={{ marginTop: 12 }}>
            {bucketFiles.length === 0 ? (
              <div style={{ opacity: 0.8 }}>No files found under this prefix.</div>
            ) : (
              bucketFiles.map((obj) => (
                <div key={obj.id || obj.name} className="file-card">
                  <div className="file-header">
                    <div className="file-icon">📄</div>
                    <div className="file-info">
                      <div className="file-name" title={obj.name}>{obj.name}</div>
                      <div className="file-meta">{obj.metadata?.size || obj?.size || 0} bytes</div>
                    </div>
                  </div>
                </div>
              ))
            )}
          </div>
        </div>

        {/* Diagnostics: Documents metadata table */}
        <div className="uploaded-files" style={{ marginTop: 24 }}>
          <h3 style={{ margin: 0 }}>Documents Table Rows (latest 50)</h3>
          {docRows.length === 0 ? (
            <div style={{ marginTop: 8, opacity: 0.8 }}>No rows for this user or unable to query (check RLS).</div>
          ) : (
            <div className="files-grid" style={{ marginTop: 12 }}>
              {docRows.map((row) => (
                <div key={row.id} className="file-card">
                  <div className="file-header">
                    <div className="file-icon">🗂️</div>
                    <div className="file-info">
                      <div className="file-name" title={row.name}>{row.name}</div>
                      <div className="file-meta">{row.type} • {formatFileSize(row.size || 0)}</div>
                      <div className="file-meta" style={{ opacity: 0.8 }}>Path: {row.path}</div>
                      <div className="file-meta" style={{ opacity: 0.8 }}>Uploaded: {row.uploaded_at ? new Date(row.uploaded_at).toLocaleString() : '-'}</div>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Navigation */}
        <div className="navigation-buttons">
          <button className="btn btn-secondary" onClick={handleBack}>
            ← Back to Vitals
          </button>

          <button
            className="btn btn-primary"
            onClick={handleNext}
            disabled={uploadedFiles.length === 0 || isUploading}
          >
            {isUploading ? 'Uploading...' : 'Generate AI Questionnaire →'}
          </button>

          {/* Skip option */}
          <button
            className="btn btn-outline"
            onClick={handleSkip}
            disabled={isUploading}
            style={{ marginLeft: 8 }}
            title="Skip uploads and continue"
          >
            Skip Uploads →
          </button>
        </div>

        {/* Upload Tips */}
        <div className="upload-tips">
          <h4>💡 Tips for best results:</h4>
          <ul>
            <li>Upload clear, high-quality images of your documents</li>
            <li>Ensure text is readable and well-lit</li>
            <li>Include recent lab results, prescriptions, and medical reports</li>
            <li>Multiple documents are supported and recommended</li>
          </ul>
        </div>
      </div>
    </main>
  );
};

export default UploadDocumentsPage;