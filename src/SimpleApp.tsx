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
const API_BASE_URL = process.env.REACT_APP_API_URL || 'https://1fx9i7dt13.execute-api.ap-south-1.amazonaws.com/prod';

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

  // Auto-stop recording at 1 hour limit
  useEffect(() => {
    if (isRecording && recordingTime >= MAX_RECORDING_TIME) {
      stopRecording();
      alert('Recording stopped at 1 hour limit. You can start a new recording to continue.');
    }
  }, [recordingTime, isRecording]);

  const stopRecording = () => {
    if (mediaRecorderRef.current && isRecording) {
      mediaRecorderRef.current.stop();
      mediaRecorderRef.current.stream.getTracks().forEach(track => track.stop());
      setIsRecording(false);
      
      if (recordingIntervalRef.current) {
        clearInterval(recordingIntervalRef.current);
      }
    }
  };

  const startRecording = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mediaRecorder = new MediaRecorder(stream);
      mediaRecorderRef.current = mediaRecorder;
      
      // Clear previous audio chunks
      audioChunksRef.current = [];
      
      setIsRecording(true);
      setRecordingTime(0);
      
      recordingIntervalRef.current = setInterval(() => {
        setRecordingTime(prev => prev + 1);
      }, 1000);
      
      mediaRecorder.ondataavailable = (event) => {
        if (event.data.size > 0) {
          audioChunksRef.current.push(event.data);
        }
      };
      
      mediaRecorder.onstop = async () => {
        const audioBlob = new Blob(audioChunksRef.current, { type: 'audio/webm' });
        const fileName = `voice-recording-${Date.now()}.webm`;
        handleTranscription('microphone', fileName, audioBlob);
      };
      
      mediaRecorder.start();
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

  const handleTranscription = (source: 'microphone' | 'file', filename: string, audioBlob?: Blob) => {
    setTranscriptionSource(source);
    setFileName(filename);
    setShowTranscriptionModal(true);
    setIsTranscribing(true);
    
    // For now, use mock transcription
    setTimeout(() => {
      const mockTranscription = source === 'microphone' 
        ? "This is a sample transcription from your voice recording. The audio has been processed and converted to text successfully. You can now review and edit the transcribed content as needed."
        : `This is a sample transcription from your uploaded file "${filename}". The audio content has been analyzed and transcribed with high accuracy. The system has processed the entire audio file and extracted all spoken content.`;
      
      setTranscriptionText(mockTranscription);
      setIsTranscribing(false);
      
      // Add to transcription history
      const newItem: TranscriptionItem = {
        id: Date.now().toString(),
        text: mockTranscription,
        source,
        fileName: source === 'file' ? filename : undefined,
        timestamp: new Date()
      };
      
      setTranscriptionHistory(prev => [newItem, ...prev]);
    }, 3000);
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

      {/* Modals would go here - omitted for simplicity */}
    </div>
  );
}
