import React from 'react';
import { useNavigate } from 'react-router-dom';

function AssessmentStartPage() {
  const navigate = useNavigate();

  const startAssessment = () => {
    navigate('/assessment/documents');
  };

  return (
    <div className="assessment-start-container">
      <div className="assessment-start-content">
        <div className="assessment-start-card">
          <h1>Health Assessment</h1>
          <p>Complete a comprehensive health assessment by providing your vitals, uploading relevant documents, and answering AI-generated questions.</p>
          
          <div className="assessment-steps">
            <div className="step">
              <div className="step-number">1</div>
              <div className="step-info">
                <h3>Vitals</h3>
                <p>Record your current health measurements</p>
              </div>
            </div>
            <div className="step">
              <div className="step-number">2</div>
              <div className="step-info">
                <h3>Documents</h3>
                <p>Upload medical records and relevant files</p>
              </div>
            </div>
            <div className="step">
              <div className="step-number">3</div>
              <div className="step-info">
                <h3>AI Questions</h3>
                <p>Answer personalized health questions</p>
              </div>
            </div>
          </div>
          
          <button 
            onClick={startAssessment}
            className="btn btn-primary btn-large"
          >
            Start Assessment
          </button>
        </div>
      </div>
    </div>
  );
}

export default AssessmentStartPage;
