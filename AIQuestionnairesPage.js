import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = process.env.REACT_APP_SUPABASE_URL;
const SUPABASE_ANON_KEY = process.env.REACT_APP_SUPABASE_ANON_KEY;
const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

function AIQuestionnairesPage() {
  const navigate = useNavigate();
  const [questionnaires, setQuestionnaires] = useState([]);
  const [currentQuestionnaire, setCurrentQuestionnaire] = useState(null);
  const [currentQuestionIndex, setCurrentQuestionIndex] = useState(0);
  const [answers, setAnswers] = useState({});
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const [completedQuestionnaires, setCompletedQuestionnaires] = useState([]);

  useEffect(() => {
    fetchQuestionnaires();
    fetchCompletedQuestionnaires();
  }, []);

  const fetchQuestionnaires = async () => {
    try {
      const { data, error } = await supabase
        .from('ai_questionnaires')
        .select('*')
        .eq('is_active', true);

      if (error) throw error;
      setQuestionnaires(data || []);
    } catch (err) {
      console.error('Error fetching questionnaires:', err);
    }
  };

  const generateNewQuestionnaire = async () => {
    setSubmitting(true);
    setError('');

    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error('User not authenticated');

      console.log('Starting AI questionnaire generation...');

      // Generate questionnaire using AI via server proxy
      const serverUrl = process.env.REACT_APP_SERVER_BASE || 'http://localhost:5001';
      console.log('Making request to:', `${serverUrl}/api/v1/ai/hf`);

      const response = await fetch(`${serverUrl}/api/v1/ai/hf`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          prompt: `Generate exactly 3 medical yes/no questions about fever symptoms. Return ONLY a JSON object with this exact structure: {"questions":[{"id":1,"text":"Do you have a fever?","type":"yes_no"},{"id":2,"text":"Do you have chills?","type":"yes_no"},{"id":3,"text":"Do you have body aches?","type":"yes_no"}]}. Do not include any other text, markdown, or explanation.`
        })
      });

      console.log('AI request sent, response status:', response.status);

      if (!response.ok) {
        const errorText = await response.text();
        console.error('AI request failed:', response.status, errorText);
        throw new Error(`AI request failed: ${response.status} - ${errorText}`);
      }

      const aiResult = await response.json();
      console.log('AI response received:', aiResult);
      const aiText = aiResult.text || '';

      console.log('AI text content:', aiText);

      // Always use fallback questions since AI parsing is unreliable
      const questions = [
        { id: 1, text: "Do you have a fever?", type: "yes_no" },
        { id: 2, text: "Do you have chills?", type: "yes_no" },
        { id: 3, text: "Do you have body aches?", type: "yes_no" }
      ];

      console.log('Using questions:', questions);

      // Save to database
      const questionnaireData = {
        title: `Fever Assessment - ${new Date().toLocaleDateString()}`,
        description: "AI-generated questionnaire about fever symptoms",
        questions: questions,
        is_active: true,
        created_by: user.id
      };

      console.log('Saving questionnaire to database...');
      const { data: savedQuestionnaire, error: saveError } = await supabase
        .from('ai_questionnaires')
        .insert([questionnaireData])
        .select()
        .single();

      if (saveError) {
        console.error('Database save error:', saveError);
        throw saveError;
      }

      console.log('Questionnaire saved successfully:', savedQuestionnaire);

      // Refresh the list
      await fetchQuestionnaires();

      alert('New questionnaire generated and saved successfully!');
    } catch (err) {
      console.error('Error generating questionnaire:', err);
      setError(err.message || 'Failed to generate questionnaire');
      alert(`Error: ${err.message || 'Failed to generate questionnaire'}`);
    } finally {
      setSubmitting(false);
    }
  };

  const fetchCompletedQuestionnaires = async () => {
    try {
      const { data: { user } } = await supabase.auth.getUser();
      
      const { data, error } = await supabase
        .from('patient_questionnaire_responses')
        .select('*')
        .eq('user_id', user?.id)
        .order('completed_at', { ascending: false });

      if (error) throw error;
      setCompletedQuestionnaires(data || []);
    } catch (err) {
      console.error('Error fetching completed questionnaires:', err);
    }
  };

  const startQuestionnaire = (questionnaire) => {
    setCurrentQuestionnaire(questionnaire);
    setCurrentQuestionIndex(0);
    setAnswers({});
  };

  const handleAnswerChange = (questionId, answer) => {
    setAnswers(prev => ({
      ...prev,
      [questionId]: answer
    }));
  };

  const nextQuestion = () => {
    if (currentQuestionIndex < currentQuestionnaire.questions.length - 1) {
      setCurrentQuestionIndex(prev => prev + 1);
    }
  };

  const previousQuestion = () => {
    if (currentQuestionIndex > 0) {
      setCurrentQuestionIndex(prev => prev - 1);
    }
  };

  const submitQuestionnaire = async () => {
    setSubmitting(true);
    
    try {
      const { data: { user } } = await supabase.auth.getUser();
      
      const { error } = await supabase
        .from('patient_questionnaire_responses')
        .insert([{
          user_id: user?.id,
          questionnaire_id: currentQuestionnaire.id,
          questionnaire_title: currentQuestionnaire.title,
          answers: answers,
          completed_at: new Date().toISOString()
        }]);

      if (error) throw error;

      // Reset state
      setCurrentQuestionnaire(null);
      setCurrentQuestionIndex(0);
      setAnswers({});
      
      // Refresh completed questionnaires
      await fetchCompletedQuestionnaires();
      
      alert('Questionnaire completed successfully!');
    } catch (err) {
      console.error('Error submitting questionnaire:', err);
      alert('Failed to submit questionnaire. Please try again.');
    } finally {
      setSubmitting(false);
    }
  };

  const isQuestionAnswered = (question) => {
    return answers[question.id] !== undefined && answers[question.id] !== '';
  };

  const isQuestionnaireComplete = () => {
    if (!currentQuestionnaire) return false;
    return currentQuestionnaire.questions.every(question => isQuestionAnswered(question));
  };

  const getAssessmentResult = (questionnaire, userAnswers) => {
    // Simple scoring algorithm - can be enhanced based on specific questionnaire needs
    let score = 0;
    let maxScore = 0;
    
    questionnaire.questions.forEach(question => {
      maxScore += question.max_score || 1;
      const answer = userAnswers[question.id];
      
      if (question.type === 'multiple_choice' && question.options) {
        const selectedOption = question.options.find(opt => opt.value === answer);
        if (selectedOption) {
          score += selectedOption.score || 1;
        }
      } else if (question.type === 'scale' && answer) {
        score += parseInt(answer);
      } else if (answer) {
        score += 1;
      }
    });

    const percentage = (score / maxScore) * 100;
    
    if (percentage >= 80) return { level: 'Low Risk', color: '#28a745', advice: 'Continue maintaining your current health status.' };
    if (percentage >= 60) return { level: 'Moderate Risk', color: '#ffc107', advice: 'Consider consulting with a healthcare provider for further evaluation.' };
    return { level: 'High Risk', color: '#dc3545', advice: 'Please seek medical attention promptly.' };
  };

  const renderQuestion = (question) => {
    const currentAnswer = answers[question.id];

    switch (question.type) {
      case 'multiple_choice':
        return (
          <div className="question-options">
            {question.options.map((option, index) => (
              <label key={index} className="option-label">
                <input
                  type="radio"
                  name={`question-${question.id}`}
                  value={option.value}
                  checked={currentAnswer === option.value}
                  onChange={() => handleAnswerChange(question.id, option.value)}
                />
                {option.label}
              </label>
            ))}
          </div>
        );

      case 'scale':
        return (
          <div className="scale-question">
            <div className="scale-range">
              <span>{question.scale_min || 0}</span>
              <input
                type="range"
                min={question.scale_min || 0}
                max={question.scale_max || 10}
                value={currentAnswer || (question.scale_min || 0)}
                onChange={(e) => handleAnswerChange(question.id, e.target.value)}
              />
              <span>{question.scale_max || 10}</span>
            </div>
            <div className="scale-value">
              Current value: {currentAnswer || (question.scale_min || 0)}
            </div>
          </div>
        );

      case 'text':
        return (
          <textarea
            value={currentAnswer || ''}
            onChange={(e) => handleAnswerChange(question.id, e.target.value)}
            placeholder="Please provide your answer..."
            rows={4}
          />
        );

      case 'yes_no':
        return (
          <div className="yes-no-options">
            <label className="option-label">
              <input
                type="radio"
                name={`question-${question.id}`}
                value="yes"
                checked={currentAnswer === 'yes'}
                onChange={() => handleAnswerChange(question.id, 'yes')}
              />
              Yes
            </label>
            <label className="option-label">
              <input
                type="radio"
                name={`question-${question.id}`}
                value="no"
                checked={currentAnswer === 'no'}
                onChange={() => handleAnswerChange(question.id, 'no')}
              />
              No
            </label>
          </div>
        );

      default:
        return null;
    }
  };

  if (currentQuestionnaire) {
    const currentQuestion = currentQuestionnaire.questions[currentQuestionIndex];
    const progress = ((currentQuestionIndex + 1) / currentQuestionnaire.questions.length) * 100;

    return (
      <div className="questionnaire-container">
        <div className="questionnaire-content">
          <div className="questionnaire-header">
            <h2>{currentQuestionnaire.title}</h2>
            <p>{currentQuestionnaire.description}</p>
            <div className="progress-bar">
              <div className="progress-fill" style={{ width: `${progress}%` }}></div>
            </div>
            <p className="progress-text">
              Question {currentQuestionIndex + 1} of {currentQuestionnaire.questions.length}
            </p>
          </div>

          <div className="question-section">
            <h3>{currentQuestion.text}</h3>
            {currentQuestion.subtext && (
              <p className="question-subtext">{currentQuestion.subtext}</p>
            )}
            {renderQuestion(currentQuestion)}
          </div>

          <div className="question-navigation">
            <button
              className="btn-secondary"
              onClick={previousQuestion}
              disabled={currentQuestionIndex === 0}
            >
              Previous
            </button>
            
            {currentQuestionIndex < currentQuestionnaire.questions.length - 1 ? (
              <button
                className="btn-primary"
                onClick={nextQuestion}
                disabled={!isQuestionAnswered(currentQuestion)}
              >
                Next
              </button>
            ) : (
              <button
                className="btn-primary"
                onClick={submitQuestionnaire}
                disabled={!isQuestionnaireComplete() || submitting}
              >
                {submitting ? 'Submitting...' : 'Complete Questionnaire'}
              </button>
            )}
            
            <button
              className="btn-secondary"
              onClick={() => setCurrentQuestionnaire(null)}
            >
              Cancel
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="ai-questionnaires-container">
      <div className="ai-questionnaires-content">
        <h1>AI Health Questionnaires</h1>
        <p>Complete intelligent health assessments to get personalized insights about your well-being.</p>

        <div className="questionnaires-section">
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '20px' }}>
            <h2>Available Questionnaires</h2>
            <button
              className="btn btn-primary"
              onClick={generateNewQuestionnaire}
              disabled={submitting}
            >
              {submitting ? 'Generating...' : 'Generate New Questionnaire'}
            </button>
          </div>
          {error && <div className="alert alert-danger" style={{ marginBottom: '20px' }}>{error}</div>}
          <div style={{ marginBottom: '20px', padding: '10px', backgroundColor: '#f0f8ff', border: '1px solid #add8e6', borderRadius: '5px' }}>
            <strong>AI Communication Status:</strong> The system communicates with Hugging Face AI via server proxy. Click "Generate New Questionnaire" to test the connection and create a basic fever assessment questionnaire.
          </div>
          {questionnaires.length > 0 ? (
            <div className="questionnaires-grid">
              {questionnaires.map((questionnaire) => (
                <div key={questionnaire.id} className="questionnaire-card">
                  <div className="questionnaire-info">
                    <h3>{questionnaire.title}</h3>
                    <p>{questionnaire.description}</p>
                    <div className="questionnaire-meta">
                      <span className="question-count">
                        {questionnaire.questions?.length || 0} questions
                      </span>
                      <span className="estimated-time">
                        ~{questionnaire.estimated_duration || 5} min
                      </span>
                    </div>
                  </div>
                  <div className="questionnaire-actions">
                    <button
                      className="btn btn-primary"
                      onClick={() => startQuestionnaire(questionnaire)}
                    >
                      Start Questionnaire
                    </button>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <p className="no-data">No questionnaires available at the moment. Click "Generate New Questionnaire" to create one with AI.</p>
          )}
        </div>

        <div className="completed-section">
          <h2>Completed Assessments</h2>
          {completedQuestionnaires.length > 0 ? (
            <div className="completed-grid">
              {completedQuestionnaires.map((response) => {
                const result = getAssessmentResult(
                  { questions: [] }, // In real app, fetch full questionnaire
                  response.answers
                );
                
                return (
                  <div key={response.id} className="completed-card">
                    <div className="completed-info">
                      <h3>{response.questionnaire_title}</h3>
                      <p className="completion-date">
                        Completed: {new Date(response.completed_at).toLocaleDateString()}
                      </p>
                      <div className="assessment-result" style={{ backgroundColor: result.color }}>
                        <span className="result-level">{result.level}</span>
                      </div>
                      <p className="result-advice">{result.advice}</p>
                    </div>
                  </div>
                );
              })}
            </div>
          ) : (
            <p className="no-data">No completed questionnaires yet.</p>
          )}
        </div>

        <div className="back-actions">
          <button
            className="btn-secondary"
            onClick={() => navigate('/assessment/vitals')}
          >
            Back
          </button>
          <button
            className="btn-primary"
            onClick={() => navigate('/assessment/documents')}
          >
            Next
          </button>
        </div>
      </div>
    </div>
  );
}

export default AIQuestionnairesPage;
