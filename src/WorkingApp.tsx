import React, { useState, useRef, useEffect } from 'react';
import { Upload, Mic, History } from 'lucide-react';

interface TranscriptionItem {
  id: string;
  text: string;
  source: 'microphone' | 'file';
  fileName?: string;
  timestamp: Date;
}

const MAX_RECORDING_TIME = 3600; // 1 hour in seconds

export default function App() {
  const [isDark, setIsDark] = useState(true);
  const [isRecording, setIsRecording] = useState(false);
  const [recordingTime, setRecordingTime] = useState(0);
  const [transcriptionHistory, setTranscriptionHistory] = useState<TranscriptionItem[]>([]);
  
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const recordingIntervalRef = useRef<NodeJS.Timeout | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (isDark) {
      document.documentElement.classList.add('dark');
    } else {
      document.documentElement.classList.remove('dark');
    }
  }, [isDark]);

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

  // Auto-stop recording at 1 hour limit
  useEffect(() => {
    if (isRecording && recordingTime >= MAX_RECORDING_TIME) {
      stopRecording();
      alert('Recording stopped at 1 hour limit. You can start a new recording to continue.');
    }
  }, [recordingTime, isRecording]);

  const startRecording = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mediaRecorder = new MediaRecorder(stream);
      mediaRecorderRef.current = mediaRecorder;
      
      setIsRecording(true);
      setRecordingTime(0);
      
      recordingIntervalRef.current = setInterval(() => {
        setRecordingTime(prev => prev + 1);
      }, 1000);
      
      mediaRecorder.onstop = () => {
        // Mock transcription - in real app this would upload to S3
        const mockText = "This is a sample transcription from your voice recording. The audio has been processed successfully.";
        const newItem: TranscriptionItem = {
          id: Date.now().toString(),
          text: mockText,
          source: 'microphone',
          timestamp: new Date()
        };
        setTranscriptionHistory(prev => [newItem, ...prev]);
        alert('Transcription completed! (This is a mock result)');
      };
      
      mediaRecorder.start();
    } catch (error) {
      console.error('Error accessing microphone:', error);
      alert('Unable to access microphone. Please check your permissions.');
    }
  };

  const handleFileUpload = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (file) {
      // Mock transcription - in real app this would upload to S3
      const mockText = `This is a sample transcription from your uploaded file "${file.name}". The audio content has been analyzed.`;
      const newItem: TranscriptionItem = {
        id: Date.now().toString(),
        text: mockText,
        source: 'file',
        fileName: file.name,
        timestamp: new Date()
      };
      setTranscriptionHistory(prev => [newItem, ...prev]);
      alert('File uploaded and transcribed! (This is a mock result)');
    }
  };

  const formatTime = (seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  };

  return (
    <div className={`min-h-screen transition-colors duration-300 ${isDark ? 'bg-black' : 'bg-gray-50'}`}>
      {/* Header */}
      <div className="absolute top-6 right-6">
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
            <h1 className={`text-2xl font-bold mb-2 ${isDark ? 'text-white' : 'text-black'}`}>
              AWS Transcription Service
            </h1>
            <p className={`text-sm ${isDark ? 'text-white/60' : 'text-black/60'}`}>
              Upload audio or record voice to transcribe (1 hour limit per recording)
            </p>
          </div>

          {/* Content Area */}
          <div className="p-8">
            {/* Recent Transcriptions */}
            {transcriptionHistory.length > 0 && (
              <div className="mb-8">
                <h3 className={`text-sm font-medium mb-4 ${isDark ? 'text-white/80' : 'text-black/80'}`}>
                  Recent transcriptions ({transcriptionHistory.length})
                </h3>
                <div className="space-y-2">
                  {transcriptionHistory.slice(0, 3).map((item) => (
                    <div
                      key={item.id}
                      className={`p-3 rounded-xl text-sm transition-colors ${
                        isDark 
                          ? 'bg-white/5 text-white/70' 
                          : 'bg-black/5 text-black/70'
                      }`}
                    >
                      <div className="flex items-center gap-2 mb-1">
                        {item.source === 'microphone' ? (
                          <Mic className="w-3 h-3" />
                        ) : (
                          <Upload className="w-3 h-3" />
                        )}
                        <span className={`text-xs ${isDark ? 'text-white/50' : 'text-black/50'}`}>
                          {item.timestamp.toLocaleTimeString()}
                        </span>
                      </div>
                      {item.text.length > 100 ? `${item.text.substring(0, 100)}...` : item.text}
                    </div>
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
                          <p className="text-xs text-orange-500 mt-2">
                            Approaching 1-hour limit ({Math.floor((MAX_RECORDING_TIME - recordingTime) / 60)}min remaining)
                          </p>
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
    </div>
  );
}
