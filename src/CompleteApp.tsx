import React, { useState, useRef, useEffect } from 'react';
import { Upload, Mic, X, FileAudio, Loader2, History, Clock, Trash2, Copy, Check, AlertCircle } from 'lucide-react';

interface TranscriptionItem {
  id: string;
  text: string;
  source: 'microphone' | 'file';
  fileName?: string;
  timestamp: Date;
}

// Configuration constants
const MAX_RECORDING_TIME = 3600; // 1 hour in seconds
const MAX_FILE_SIZE = 200 * 1024 * 1024; // 200MB
const API_BASE_URL = import.meta.env.VITE_API_URL || 'https://1fx9i7dt13.execute-api.ap-south-1.amazonaws.com/prod';

export default function App() {
  const [isDark, setIsDark] = useState(true);
  const [isRecording, setIsRecording] = useState(false);
  const [recordingTime, setRecordingTime] = useState(0);
  const [showTranscriptionModal, setShowTranscriptionModal] = useState(false);
  const [showHistoryPanel, setShowHistoryPanel] = useState(false);
  const [transcriptionText, setTranscriptionText] = useState('');
  const [isTranscribing, setIsTranscribing] = useState(false);
  const [transcriptionSource, setTranscriptionSource] = useState<'microphone' | 'file'>('microphone');
  const [fileName, setFileName] = useState('');
  const [transcriptionHistory, setTranscriptionHistory] = useState<TranscriptionItem[]>([]);
  const [copiedStates, setCopiedStates] = useState<{[key: string]: boolean}>({});
  
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const recordingIntervalRef = useRef<NodeJS.Timeout | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const audioChunksRef = useRef<Blob[]>([]);

  useEffect(() => {
    if (isDark) {
      document.documentElement.classList.add('dark');
    } else {
      document.documentElement.classList.remove('dark');
    }
  }, [isDark]);

  const stopRecording = () => {
    console.log('stopRecording called:', { isRecording, hasRecorder: !!mediaRecorderRef.current });
    if (mediaRecorderRef.current && isRecording) {
      console.log('Stopping media recorder...');
      mediaRecorderRef.current.stop();
      mediaRecorderRef.current.stream.getTracks().forEach(track => track.stop());
      setIsRecording(false);
      
      if (recordingIntervalRef.current) {
        console.log('Clearing recording interval...');
        clearInterval(recordingIntervalRef.current);
        recordingIntervalRef.current = null;
      }
    }
  };

  // Auto-stop recording at 1 hour limit
  useEffect(() => {
    if (isRecording && recordingTime >= MAX_RECORDING_TIME) {
      stopRecording();
      alert('Recording stopped at 1 hour limit. You can start a new recording to continue.');
    }
  }, [recordingTime, isRecording]);

  // Load existing transcriptions on app start
  useEffect(() => {
    loadTranscriptions();
  }, []);

  const loadTranscriptions = async () => {
    try {
      const response = await fetch(`${API_BASE_URL}/transcriptions?status=COMPLETED&limit=10`);
      if (response.ok) {
        const { transcriptions } = await response.json();
        const formattedTranscriptions = transcriptions.map((t: any) => ({
          id: t.id,
          text: t.text,
          source: t.source,
          fileName: t.fileName,
          timestamp: new Date(t.createdAt)
        }));
        setTranscriptionHistory(formattedTranscriptions);
      }
    } catch (error) {
      console.error('Error loading transcriptions:', error);
    }
  };

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (recordingIntervalRef.current) {
        clearInterval(recordingIntervalRef.current);
      }
      if (mediaRecorderRef.current && mediaRecorderRef.current.state === 'recording') {
        mediaRecorderRef.current.stop();
        mediaRecorderRef.current.stream.getTracks().forEach(track => track.stop());
      }
    };
  }, []);

  const startRecording = async () => {
    try {
      console.log('Starting recording...');
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mediaRecorder = new MediaRecorder(stream);
      mediaRecorderRef.current = mediaRecorder;
      
      // Clear previous audio chunks
      audioChunksRef.current = [];
      
      setIsRecording(true);
      setRecordingTime(0);
      
      console.log('Setting up recording timer...');
      recordingIntervalRef.current = setInterval(() => {
        console.log('Timer tick');
        setRecordingTime(prev => {
          console.log('Current time:', prev + 1);
          return prev + 1;
        });
      }, 1000);
      
      mediaRecorder.ondataavailable = (event) => {
        console.log('Data available:', event.data.size);
        if (event.data.size > 0) {
          audioChunksRef.current.push(event.data);
        }
      };
      
      mediaRecorder.onstop = async () => {
        console.log('Recording stopped, processing audio...');
        const audioBlob = new Blob(audioChunksRef.current, { type: 'audio/webm' });
        console.log('Audio blob size:', audioBlob.size);
        const fileName = `voice-recording-${Date.now()}.webm`;
        handleTranscription('microphone', fileName, audioBlob);
      };
      
      mediaRecorder.start(1000); // Collect data every second
      console.log('MediaRecorder started');
    } catch (error) {
      console.error('Error accessing microphone:', error);
      alert('Unable to access microphone. Please check your permissions.');
    }
  };

  const handleFileUpload = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (file) {
      // Check file size
      if (file.size > MAX_FILE_SIZE) {
        alert(`File size too large. Maximum size is ${MAX_FILE_SIZE / (1024 * 1024)}MB. For longer recordings, please split into 1-hour segments.`);
        return;
      }
      
      // Check file type
      const allowedTypes = ['audio/mp3', 'audio/mpeg', 'audio/wav', 'audio/m4a', 'audio/webm'];
      if (!allowedTypes.includes(file.type)) {
        alert('Invalid file type. Supported types: MP3, WAV, M4A, WebM');
        return;
      }
      
      handleTranscription('file', file.name, file);
    }
  };

  const uploadToS3 = async (audioBlob: Blob, filename: string) => {
    try {
      // Get pre-signed URL
      const response = await fetch(`${API_BASE_URL}/upload-url`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          fileName: filename,
          fileType: audioBlob.type,
          fileSize: audioBlob.size,
        }),
      });

      if (!response.ok) {
        throw new Error(`Failed to get upload URL: ${response.statusText}`);
      }

      const { uploadUrl, fileKey } = await response.json();

      // Upload file to S3
      const uploadResponse = await fetch(uploadUrl, {
        method: 'PUT',
        body: audioBlob,
        headers: {
          'Content-Type': audioBlob.type,
        },
      });

      if (!uploadResponse.ok) {
        throw new Error(`Failed to upload file: ${uploadResponse.statusText}`);
      }

      return fileKey;
    } catch (error) {
      console.error('Error uploading to S3:', error);
      throw error;
    }
  };

  const pollForTranscription = async (transcriptionId: string, maxAttempts: number = 30) => {
    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      try {
        const response = await fetch(`${API_BASE_URL}/transcriptions/${transcriptionId}`);
        
        if (response.ok) {
          const { transcription } = await response.json();
          
          if (transcription.status === 'COMPLETED' && transcription.text) {
            setTranscriptionText(transcription.text);
            setIsTranscribing(false);
            
            // Add to transcription history
            const newItem: TranscriptionItem = {
              id: transcription.id,
              text: transcription.text,
              source: transcription.source,
              fileName: transcription.fileName,
              timestamp: new Date(transcription.createdAt)
            };
            
            setTranscriptionHistory(prev => [newItem, ...prev]);
            return;
          } else if (transcription.status === 'FAILED') {
            throw new Error('Transcription failed');
          }
        }
        
        // Wait 5 seconds before next poll
        await new Promise(resolve => setTimeout(resolve, 5000));
      } catch (error) {
        console.error('Error polling transcription:', error);
      }
    }
    
    // Timeout reached
    setIsTranscribing(false);
    alert('Transcription is taking longer than expected. Please check back later.');
  };

  const handleTranscription = async (source: 'microphone' | 'file', filename: string, audioBlob?: Blob) => {
    try {
      setTranscriptionSource(source);
      setFileName(filename);
      setShowTranscriptionModal(true);
      setIsTranscribing(true);

      // 1) Kick off the transcription job
      const startRes = await fetch(`${API_BASE_URL}/transcriptions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          source,
          fileKey: filename,
          originalFileName: filename,
          bucketName: source === 'microphone'
            ? /* your mic bucket */ ''
            : /* your file bucket */ '',
        }),
      });
      if (!startRes.ok) throw new Error('Failed to start transcription');
      const { transcriptionId } = await startRes.json();

      // 2) Poll until it’s done
      const delay = (ms: number) => new Promise(r => setTimeout(r, ms));
      let final: any = null;
      for (let i = 0; i < 20; i++) {
        await delay(5000);
        const statusRes = await fetch(
          `${API_BASE_URL}/transcriptions/${transcriptionId}`
        );
        const statusJson = await statusRes.json();
        const status = statusJson.transcription?.status;
        if (status === 'COMPLETED') {
          final = statusJson.transcription;
          break;
        }
        if (status === 'FAILED') {
          throw new Error('Transcription failed');
        }
      }
      if (!final) throw new Error('Transcription timed out');

      // 3) Show the result
      setTranscriptionText(final.text);
      setTranscriptionHistory(h => [
        {
          id: final.id,
          text: final.text,
          source: final.source,
          fileName: final.fileName,
          timestamp: new Date(final.createdAt),
        },
        ...h,
      ]);
    } catch (err) {
      console.error('Transcription error:', err);
      alert(err instanceof Error ? err.message : 'Unknown error');
    } finally {
      setIsTranscribing(false);
    }
  };

  const formatTime = (seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  };

  const formatTimestamp = (date: Date) => {
    const now = new Date();
    const diffInHours = (now.getTime() - date.getTime()) / (1000 * 60 * 60);
    
    if (diffInHours < 1) {
      const diffInMinutes = Math.floor(diffInHours * 60);
      return diffInMinutes === 0 ? 'Just now' : `${diffInMinutes}m ago`;
    } else if (diffInHours < 24) {
      return `${Math.floor(diffInHours)}h ago`;
    } else {
      return date.toLocaleDateString();
    }
  };

  const closeModal = () => {
    setShowTranscriptionModal(false);
    setTranscriptionText('');
    setIsTranscribing(false);
  };

  const openHistoryItem = (item: TranscriptionItem) => {
    setTranscriptionText(item.text);
    setTranscriptionSource(item.source);
    setFileName(item.fileName || '');
    setShowTranscriptionModal(true);
    setIsTranscribing(false);
    setShowHistoryPanel(false);
  };

  const deleteHistoryItem = (id: string, event: React.MouseEvent) => {
    event.stopPropagation();
    setTranscriptionHistory(prev => prev.filter(item => item.id !== id));
  };

  const clearAllHistory = () => {
    setTranscriptionHistory([]);
  };

  const copyToClipboard = async (text: string, id?: string) => {
    try {
      await navigator.clipboard.writeText(text);
      if (id) {
        setCopiedStates(prev => ({ ...prev, [id]: true }));
        setTimeout(() => {
          setCopiedStates(prev => ({ ...prev, [id]: false }));
        }, 2000);
      } else {
        setCopiedStates(prev => ({ ...prev, 'modal': true }));
        setTimeout(() => {
          setCopiedStates(prev => ({ ...prev, 'modal': false }));
        }, 2000);
      }
    } catch (error) {
      console.error('Failed to copy text:', error);
    }
  };

  return (
    <div className={`min-h-screen transition-colors duration-300 ${isDark ? 'bg-black' : 'bg-gray-50'}`}>
      {/* Header with Theme Toggle and History Button */}
      <div className="absolute top-6 right-6 flex items-center gap-3">
        <button
          onClick={() => setShowHistoryPanel(true)}
          className={`p-3 rounded-xl transition-all duration-200 ${
            isDark 
              ? 'bg-white/5 hover:bg-white/10 text-white/70 hover:text-white border-white/10' 
              : 'bg-black/5 hover:bg-black/10 text-black/70 hover:text-black border-black/10'
          } border`}
        >
          <History className="w-5 h-5" />
        </button>
        <button
          onClick={() => setIsDark(!isDark)}
          className={`w-12 h-6 rounded-full transition-colors duration-300 relative ${
            isDark ? 'bg-white' : 'bg-gray-900'
          }`}
        >
          <div
            className={`w-5 h-5 rounded-full transition-transform duration-300 absolute top-0.5 ${
              isDark ? 'translate-x-6 bg-gray-900' : 'translate-x-0.5 bg-white'
            }`}
          />
        </button>
      </div>

      {/* Main Content */}
      <div className="flex items-center justify-center min-h-screen p-6">
        <div className={`w-full max-w-2xl rounded-3xl border backdrop-blur-xl transition-all duration-300 ${
          isDark 
            ? 'bg-black/20 border-white/10' 
            : 'bg-white/20 border-black/10'
        }`}>
          {/* Header */}
          <div className="p-8 border-b border-white/10">
            <p className={`text-sm ${isDark ? 'text-white/60' : 'text-black/60'}`}>
              Upload audio or record voice to transcribe (1 hour limit per recording)
            </p>
          </div>

          {/* Content Area */}
          <div className="p-8">
            {/* Recent Transcriptions Preview */}
            {transcriptionHistory.length > 0 && (
              <div className="mb-8">
                <div className="flex items-center justify-between mb-4">
                  <h3 className={`text-sm font-medium ${isDark ? 'text-white/80' : 'text-black/80'}`}>
                    Recent transcriptions
                  </h3>
                  <button
                    onClick={() => setShowHistoryPanel(true)}
                    className={`text-xs px-3 py-1 rounded-lg transition-colors ${
                      isDark 
                        ? 'bg-white/5 hover:bg-white/10 text-white/60 hover:text-white' 
                        : 'bg-black/5 hover:bg-black/10 text-black/60 hover:text-black'
                    }`}
                  >
                    View all
                  </button>
                </div>
                <div className="space-y-2">
                  {transcriptionHistory.slice(0, 3).map((item) => (
                    <button
                      key={item.id}
                      onClick={() => openHistoryItem(item)}
                      className={`w-full text-left p-3 rounded-xl text-sm transition-colors ${
                        isDark 
                          ? 'bg-white/5 hover:bg-white/10 text-white/70 hover:text-white' 
                          : 'bg-black/5 hover:bg-black/10 text-black/70 hover:text-black'
                      }`}
                    >
                      <div className="flex items-center gap-2 mb-1">
                        {item.source === 'microphone' ? (
                          <Mic className="w-3 h-3" />
                        ) : (
                          <FileAudio className="w-3 h-3" />
                        )}
                        <span className={`text-xs ${isDark ? 'text-white/50' : 'text-black/50'}`}>
                          {formatTimestamp(item.timestamp)}
                        </span>
                      </div>
                      {item.text.length > 100 ? `${item.text.substring(0, 100)}...` : item.text}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {/* Upload Section */}
            <div className="space-y-4">
              <button
                onClick={() => fileInputRef.current?.click()}
                className={`w-full p-6 border-2 border-dashed rounded-2xl transition-all duration-200 group ${
                  isDark 
                    ? 'border-white/20 hover:border-white/40 hover:bg-white/5' 
                    : 'border-black/20 hover:border-black/40 hover:bg-black/5'
                }`}
              >
                <div className="flex flex-col items-center gap-4">
                  <div className={`p-3 rounded-full transition-colors ${
                    isDark 
                      ? 'bg-white/10 group-hover:bg-white/20' 
                      : 'bg-black/10 group-hover:bg-black/20'
                  }`}>
                    <Upload className={`w-6 h-6 ${isDark ? 'text-white' : 'text-black'}`} />
                  </div>
                  <div className="text-center">
                    <p className={`font-medium ${isDark ? 'text-white' : 'text-black'}`}>
                      Upload audio file
                    </p>
                    <p className={`text-sm mt-1 ${isDark ? 'text-white/60' : 'text-black/60'}`}>
                      MP3, WAV, M4A up to 200MB
                    </p>
                  </div>
                </div>
              </button>

              <input
                ref={fileInputRef}
                type="file"
                accept="audio/*"
                onChange={handleFileUpload}
                className="hidden"
              />

              {/* Voice Recording */}
              <button
                onClick={isRecording ? stopRecording : startRecording}
                className={`w-full p-6 rounded-2xl border transition-all duration-200 ${
                  isRecording
                    ? 'bg-red-500/20 border-red-500/30'
                    : isDark 
                      ? 'bg-white/5 hover:bg-white/10 border-white/10'
                      : 'bg-black/5 hover:bg-black/10 border-black/10'
                }`}
              >
                <div className="flex items-center justify-center gap-4">
                  <div className={`p-3 rounded-full ${
                    isRecording 
                      ? 'bg-red-500' 
                      : isDark ? 'bg-white/10' : 'bg-black/10'
                  }`}>
                    {isRecording ? (
                      <div className="w-6 h-6 bg-white rounded-sm animate-pulse" />
                    ) : (
                      <Mic className={`w-6 h-6 ${isDark ? 'text-white' : 'text-black'}`} />
                    )}
                  </div>
                  <div className="text-center">
                    <p className={`font-medium ${isDark ? 'text-white' : 'text-black'}`}>
                      {isRecording ? 'Stop recording' : 'Start voice recording'}
                    </p>
                    {isRecording && (
                      <div className="text-center">
                        <p className={`text-sm mt-1 ${isDark ? 'text-white/60' : 'text-black/60'}`}>
                          Recording: {formatTime(recordingTime)}
                        </p>
                        <div className={`w-full bg-gray-200 rounded-full h-2 mt-2 ${isDark ? 'bg-gray-700' : 'bg-gray-200'}`}>
                          <div 
                            className="bg-red-500 h-2 rounded-full transition-all duration-1000"
                            style={{ width: `${(recordingTime / MAX_RECORDING_TIME) * 100}%` }}
                          />
                        </div>
                        {recordingTime > MAX_RECORDING_TIME * 0.9 && (
                          <div className="flex items-center justify-center gap-1 mt-2">
                            <AlertCircle className="w-4 h-4 text-orange-500" />
                            <p className="text-xs text-orange-500">
                              Approaching 1-hour limit ({Math.floor((MAX_RECORDING_TIME - recordingTime) / 60)}min remaining)
                            </p>
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                </div>
              </button>
            </div>
          </div>

          {/* Footer */}
          <div className="px-8 py-6 border-t border-white/10 text-center">
            <p className={`text-sm ${isDark ? 'text-white/60' : 'text-black/60'}`}>
              AWS Transcription Service - Final Year Project
            </p>
          </div>
        </div>
      </div>

      {/* History Panel */}
      {showHistoryPanel && (
        <div className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center p-4 z-50">
          <div className={`w-full max-w-2xl rounded-2xl border backdrop-blur-xl transition-all duration-300 ${
            isDark 
              ? 'bg-black/80 border-white/10' 
              : 'bg-white/80 border-black/10'
          }`}>
            {/* History Header */}
            <div className="flex items-center justify-between p-6 border-b border-white/10">
              <div className="flex items-center gap-3">
                <History className={`w-5 h-5 ${isDark ? 'text-white' : 'text-black'}`} />
                <h2 className={`text-lg font-medium ${isDark ? 'text-white' : 'text-black'}`}>
                  Transcription History
                </h2>
                {transcriptionHistory.length > 0 && (
                  <span className={`text-sm px-2 py-1 rounded-lg ${
                    isDark 
                      ? 'bg-white/10 text-white/60' 
                      : 'bg-black/10 text-black/60'
                  }`}>
                    {transcriptionHistory.length}
                  </span>
                )}
              </div>
              <div className="flex items-center gap-2">
                {transcriptionHistory.length > 0 && (
                  <button
                    onClick={clearAllHistory}
                    className="p-2 rounded-lg hover:bg-red-500/20 text-red-400 hover:text-red-300 transition-colors"
                    title="Clear all history"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                )}
                <button
                  onClick={() => setShowHistoryPanel(false)}
                  className={`p-2 rounded-lg transition-colors ${
                    isDark 
                      ? 'hover:bg-white/10 text-white/60 hover:text-white' 
                      : 'hover:bg-black/10 text-black/60 hover:text-black'
                  }`}
                >
                  <X className="w-5 h-5" />
                </button>
              </div>
            </div>

            {/* History Content */}
            <div className="p-6">
              {transcriptionHistory.length === 0 ? (
                <div className="text-center py-12">
                  <div className={`p-4 rounded-full mb-4 inline-block ${
                    isDark ? 'bg-white/5' : 'bg-black/5'
                  }`}>
                    <Clock className={`w-8 h-8 ${isDark ? 'text-white/40' : 'text-black/40'}`} />
                  </div>
                  <p className={`text-lg font-medium mb-2 ${isDark ? 'text-white/80' : 'text-black/80'}`}>
                    No transcriptions yet
                  </p>
                  <p className={`text-sm ${isDark ? 'text-white/60' : 'text-black/60'}`}>
                    Start recording or upload an audio file to see your transcription history
                  </p>
                </div>
              ) : (
                <div className="space-y-3">
                  {transcriptionHistory.map((item) => (
                    <div
                      key={item.id}
                      className={`p-4 rounded-xl border transition-all duration-200 group ${
                        isDark 
                          ? 'bg-white/5 hover:bg-white/10 border-white/10 hover:border-white/20' 
                          : 'bg-black/5 hover:bg-black/10 border-black/10 hover:border-black/20'
                      }`}
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div 
                          className="flex-1 min-w-0 cursor-pointer"
                          onClick={() => openHistoryItem(item)}
                        >
                          <div className="flex items-center gap-2 mb-2">
                            {item.source === 'microphone' ? (
                              <Mic className={`w-4 h-4 ${isDark ? 'text-white/60' : 'text-black/60'}`} />
                            ) : (
                              <FileAudio className={`w-4 h-4 ${isDark ? 'text-white/60' : 'text-black/60'}`} />
                            )}
                            <span className={`text-sm font-medium ${isDark ? 'text-white/80' : 'text-black/80'}`}>
                              {item.source === 'microphone' ? 'Voice Recording' : item.fileName}
                            </span>
                            <span className={`text-xs ${isDark ? 'text-white/40' : 'text-black/40'}`}>
                              {formatTimestamp(item.timestamp)}
                            </span>
                          </div>
                          <p className={`text-sm leading-relaxed ${isDark ? 'text-white/70' : 'text-black/70'}`}>
                            {item.text.length > 150 ? `${item.text.substring(0, 150)}...` : item.text}
                          </p>
                        </div>
                        <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-all duration-200">
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              copyToClipboard(item.text, item.id);
                            }}
                            className={`p-1 rounded-lg transition-all duration-200 ${
                              isDark 
                                ? 'hover:bg-white/10 text-white/60 hover:text-white' 
                                : 'hover:bg-black/10 text-black/60 hover:text-black'
                            }`}
                            title="Copy transcription"
                          >
                            {copiedStates[item.id] ? (
                              <Check className="w-4 h-4 text-green-500" />
                            ) : (
                              <Copy className="w-4 h-4" />
                            )}
                          </button>
                          <button
                            onClick={(e) => deleteHistoryItem(item.id, e)}
                            className="p-1 rounded-lg hover:bg-red-500/20 text-red-400 hover:text-red-300 transition-all duration-200"
                            title="Delete transcription"
                          >
                            <Trash2 className="w-4 h-4" />
                          </button>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Transcription Modal */}
      {showTranscriptionModal && (
        <div className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center p-4 z-50">
          <div className={`w-full max-w-2xl rounded-2xl border backdrop-blur-xl transition-all duration-300 ${
            isDark 
              ? 'bg-black/80 border-white/10' 
              : 'bg-white/80 border-black/10'
          }`}>
            {/* Modal Header */}
            <div className="flex items-center justify-between p-6 border-b border-white/10">
              <div className="flex items-center gap-3">
                {transcriptionSource === 'microphone' ? (
                  <Mic className={`w-5 h-5 ${isDark ? 'text-white' : 'text-black'}`} />
                ) : (
                  <FileAudio className={`w-5 h-5 ${isDark ? 'text-white' : 'text-black'}`} />
                )}
                <h2 className={`text-lg font-medium ${isDark ? 'text-white' : 'text-black'}`}>
                  {transcriptionSource === 'microphone' ? 'Voice Recording' : fileName}
                </h2>
              </div>
              <button
                onClick={closeModal}
                className={`p-2 rounded-lg transition-colors ${
                  isDark 
                    ? 'hover:bg-white/10 text-white/60 hover:text-white' 
                    : 'hover:bg-black/10 text-black/60 hover:text-black'
                }`}
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Modal Content */}
            <div className="p-6">
              {isTranscribing ? (
                <div className="flex flex-col items-center justify-center py-12">
                  <div className={`p-4 rounded-full mb-4 ${isDark ? 'bg-white/5' : 'bg-black/5'}`}>
                    <Loader2 className={`w-8 h-8 animate-spin ${isDark ? 'text-white' : 'text-black'}`} />
                  </div>
                  <p className={`text-lg font-medium ${isDark ? 'text-white' : 'text-black'}`}>
                    Transcribing audio...
                  </p>
                  <p className={`text-sm mt-2 ${isDark ? 'text-white/60' : 'text-black/60'}`}>
                    This may take a few moments
                  </p>
                </div>
              ) : (
                <div>
                  <h3 className={`text-sm font-medium mb-4 ${isDark ? 'text-white/80' : 'text-black/80'}`}>
                    Transcription
                  </h3>
                  <div className={`p-4 rounded-xl border ${
                    isDark 
                      ? 'bg-white/5 border-white/10' 
                      : 'bg-black/5 border-black/10'
                  }`}>
                    <p className={`text-sm leading-relaxed ${isDark ? 'text-white/90' : 'text-black/90'}`}>
                      {transcriptionText}
                    </p>
                  </div>
                  <div className="flex justify-between items-center mt-6">
                    <button
                      onClick={() => copyToClipboard(transcriptionText)}
                      className={`flex items-center gap-2 px-4 py-2 rounded-lg font-medium transition-colors ${
                        isDark 
                          ? 'bg-white/10 hover:bg-white/20 text-white/80 hover:text-white' 
                          : 'bg-black/10 hover:bg-black/20 text-black/80 hover:text-black'
                      }`}
                    >
                      {copiedStates['modal'] ? (
                        <>
                          <Check className="w-4 h-4 text-green-500" />
                          Copied!
                        </>
                      ) : (
                        <>
                          <Copy className="w-4 h-4" />
                          Copy
                        </>
                      )}
                    </button>
                    <button
                      onClick={closeModal}
                      className={`px-6 py-2 rounded-lg font-medium transition-colors ${
                        isDark 
                          ? 'bg-white text-black hover:bg-white/90' 
                          : 'bg-black text-white hover:bg-black/90'
                      }`}
                    >
                      Done
                    </button>
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
