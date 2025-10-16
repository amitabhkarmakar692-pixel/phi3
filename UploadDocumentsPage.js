import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = process.env.REACT_APP_SUPABASE_URL;
const SUPABASE_ANON_KEY = process.env.REACT_APP_SUPABASE_ANON_KEY;
const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

function UploadDocumentsPage() {
  const navigate = useNavigate();
  const [files, setFiles] = useState([]);
  const [uploading, setUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState({});
  const [documents, setDocuments] = useState([]);
  const [documentType, setDocumentType] = useState('');

  useEffect(() => {
    fetchDocuments();
  }, []);

  const fetchDocuments = async () => {
    try {
      const { data: { user } } = await supabase.auth.getUser();
      
      const { data, error } = await supabase
        .from('patient_documents')
        .select('*')
        .eq('user_id', user?.id)
        .order('uploaded_at', { ascending: false });

      if (error) throw error;
      setDocuments(data || []);
    } catch (err) {
      console.error('Error fetching documents:', err);
    }
  };

  const handleFileChange = (e) => {
    const selectedFiles = Array.from(e.target.files);
    setFiles(prev => [...prev, ...selectedFiles]);
  };

  const handleDocumentTypeChange = (e) => {
    setDocumentType(e.target.value);
  };

  const removeFile = (index) => {
    setFiles(prev => prev.filter((_, i) => i !== index));
  };

  const uploadFiles = async () => {
    if (files.length === 0) {
      alert('Please select files to upload');
      return;
    }

    if (!documentType) {
      alert('Please select a document type');
      return;
    }

    setUploading(true);
    const progress = {};

    try {
      const { data: { user } } = await supabase.auth.getUser();

      for (let i = 0; i < files.length; i++) {
        const file = files[i];
        progress[file.name] = 0;
        setUploadProgress({ ...progress });

        const fileName = `${user?.id}/${Date.now()}_${file.name}`;
        
        const { error: uploadError } = await supabase.storage
          .from('patient-documents')
          .upload(fileName, file, {
            onProgress: (progressEvent) => {
              const percent = Math.round((progressEvent.loaded / progressEvent.total) * 100);
              progress[file.name] = percent;
              setUploadProgress({ ...progress });
            }
          });

        if (uploadError) throw uploadError;

        // Get public URL
        const { data: { publicUrl } } = supabase.storage
          .from('patient-documents')
          .getPublicUrl(fileName);

        // Save document metadata
        const { error: dbError } = await supabase
          .from('patient_documents')
          .insert([{
            user_id: user?.id,
            file_name: file.name,
            file_type: file.type,
            document_type: documentType,
            file_size: file.size,
            file_url: publicUrl,
            uploaded_at: new Date().toISOString()
          }]);

        if (dbError) throw dbError;
      }

      // Reset state
      setFiles([]);
      setDocumentType('');
      setUploadProgress({});
      
      // Refresh documents list
      await fetchDocuments();
      
      alert('Files uploaded successfully!');
    } catch (err) {
      console.error('Error uploading files:', err);
      alert('Failed to upload files. Please try again.');
    } finally {
      setUploading(false);
    }
  };

  const downloadDocument = async (document) => {
    try {
      window.open(document.file_url, '_blank');
    } catch (err) {
      console.error('Error downloading document:', err);
      alert('Failed to download document.');
    }
  };

  const deleteDocument = async (documentId) => {
    if (!window.confirm('Are you sure you want to delete this document?')) {
      return;
    }

    try {
      const { error } = await supabase
        .from('patient_documents')
        .delete()
        .eq('id', documentId);

      if (error) throw error;

      await fetchDocuments();
      alert('Document deleted successfully!');
    } catch (err) {
      console.error('Error deleting document:', err);
      alert('Failed to delete document.');
    }
  };

  const formatFileSize = (bytes) => {
    if (bytes === 0) return '0 Bytes';
    const k = 1024;
    const sizes = ['Bytes', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
  };

  return (
    <div className="upload-documents-container">
      <div className="upload-documents-content">
        <h1>Upload Documents</h1>
        
        <div className="upload-section">
          <h2>Upload New Documents</h2>
          
          <div className="upload-form">
            <div className="form-group">
              <label>Document Type</label>
              <select value={documentType} onChange={handleDocumentTypeChange}>
                <option value="">Select document type</option>
                <option value="medical_record">Medical Record</option>
                <option value="lab_result">Lab Result</option>
                <option value="imaging">Imaging (X-ray, MRI, CT)</option>
                <option value="prescription">Prescription</option>
                <option value="insurance">Insurance Document</option>
                <option value="other">Other</option>
              </select>
            </div>

            <div className="file-upload-area">
              <input
                type="file"
                multiple
                onChange={handleFileChange}
                accept=".pdf,.doc,.docx,.jpg,.jpeg,.png,.gif,.txt"
                disabled={uploading}
              />
              <div className="file-upload-placeholder">
                <p>Click to select files or drag and drop</p>
                <p>Supported formats: PDF, DOC, DOCX, JPG, PNG, GIF, TXT</p>
              </div>
            </div>

            {files.length > 0 && (
              <div className="selected-files">
                <h3>Selected Files:</h3>
                <div className="file-list">
                  {files.map((file, index) => (
                    <div key={index} className="file-item">
                      <span className="file-name">{file.name}</span>
                      <span className="file-size">({formatFileSize(file.size)})</span>
                      <button
                        type="button"
                        className="remove-file-btn"
                        onClick={() => removeFile(index)}
                        disabled={uploading}
                      >
                        ×
                      </button>
                      {uploadProgress[file.name] > 0 && (
                        <div className="progress-bar">
                          <div
                            className="progress-fill"
                            style={{ width: `${uploadProgress[file.name]}%` }}
                          ></div>
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            )}

            <div className="form-actions">
              <button
                type="button"
                className="btn-primary"
                onClick={uploadFiles}
                disabled={uploading || files.length === 0 || !documentType}
              >
                {uploading ? 'Uploading...' : 'Upload Files'}
              </button>
              <button
                type="button"
                className="btn-secondary"
                onClick={() => navigate('/assessment/questionnaires')}
              >
                Next
              </button>
            </div>
          </div>
        </div>

        <div className="documents-section">
          <h2>Uploaded Documents</h2>
          {documents.length > 0 ? (
            <div className="documents-grid">
              {documents.map((doc) => (
                <div key={doc.id} className="document-card">
                  <div className="document-info">
                    <h3>{doc.file_name}</h3>
                    <p className="document-type">{doc.document_type.replace('_', ' ').toUpperCase()}</p>
                    <p className="document-size">{formatFileSize(doc.file_size)}</p>
                    <p className="document-date">
                      {new Date(doc.uploaded_at).toLocaleDateString()}
                    </p>
                  </div>
                  <div className="document-actions">
                    <button
                      className="btn-primary"
                      onClick={() => downloadDocument(doc)}
                    >
                      Download
                    </button>
                    <button
                      className="btn-danger"
                      onClick={() => deleteDocument(doc.id)}
                    >
                      Delete
                    </button>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <p className="no-data">No documents uploaded yet.</p>
          )}
        </div>
      </div>
    </div>
  );
}

export default UploadDocumentsPage;
