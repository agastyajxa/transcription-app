import React, { useState, useRef, useEffect, useCallback } from 'react';
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
  const lastLoadRef = useRef<number>(0);

  useEffect(() => {
    if (isDark) {
      document.documentElement.classList.add('dark');
    } else {
      document.documentElement.classList.remove('dark');
    }
  }, [isDark]);

  // Load existing transcriptions on app start
  useEffect(() => {
    loadTranscriptions();
  }, []);

  // Background sync every 30 seconds to keep history updated
  useEffect(() => {
    const interval = setInterval(() => {
      if (!isTranscribing) {
        loadTranscriptions();
      }
    }, 30000);

    return () => clearInterval(interval);
  }, [isTranscribing]);

  // Handle escape key to close history panel
  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && showHistoryPanel) {
        setShowHistoryPanel(false);
      }
    };

    if (showHistoryPanel) {
      document.addEventListener('keydown', handleKeyDown);
      return () => document.removeEventListener('keydown', handleKeyDown);
    }
  }, [showHistoryPanel]);

  const loadTranscriptions = async () => {
    // Rate limit to prevent too frequent calls
    const now = Date.now();
    if (now - lastLoadRef.current < 2000) { // 2 second cooldown
      console.log('📚 Skipping load (rate limited)');
      return;
    }
    lastLoadRef.current = now;

    try {
      console.log('📚 Loading existing transcriptions...');
      const response = await fetch(`${API_BASE_URL}/transcriptions?status=COMPLETED&limit=10`);
      if (response.ok) {
        const { transcriptions } = await response.json();
        console.log('📚 Loaded transcriptions:', transcriptions);
        const formattedTranscriptions = transcriptions.map((t: any) => ({
          id: t.id,
          text: t.text,
          source: t.source,
          fileName: t.fileName || t.originalFileName,
          timestamp: new Date(t.createdAt || t.timestamp * 1000) // Convert Unix timestamp if needed
        }));
        // Merge with existing history, avoiding duplicates
        setTranscriptionHistory(prev => {
          console.log('📚 Merging history - Existing items:', prev.length, 'New from server:', formattedTranscriptions.length);

          // Create a map of server items by ID
          const serverItemsMap = new Map();
          formattedTranscriptions.forEach((item: any) => {
            serverItemsMap.set(item.id, item);
          });

          // Start with all server items (they are authoritative)
          const merged = [...formattedTranscriptions];

          // Add any local items that aren't on the server yet
          prev.forEach(localItem => {
            if (!serverItemsMap.has(localItem.id)) {
              merged.push(localItem);
            }
          });

          // Sort by timestamp descending (newest first)
          const sorted = merged.sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime());

          console.log('📚 Merge result - Total items:', sorted.length);
          console.log('📚 Items:', sorted.map(item => `${item.id}: ${item.text?.substring(0, 30)}...`));

          return sorted;
        });
      } else {
        console.warn('📚 Failed to load transcriptions:', response.status, response.statusText);
      }
    } catch (error) {
      console.error('💥 Error loading transcriptions:', error);
    }
  };

  // Define stopRecording function (without dependency on isRecording to avoid circular deps)
  const stopRecording = useCallback(() => {
    console.log('🛑 Stopping recording...');
    if (mediaRecorderRef.current) {
      mediaRecorderRef.current.stop();
      mediaRecorderRef.current.stream.getTracks().forEach(track => track.stop());
      setIsRecording(false);
      
      if (recordingIntervalRef.current) {
        clearInterval(recordingIntervalRef.current);
        recordingIntervalRef.current = null;
      }
    }
  }, []);

  // Auto-stop recording at 1 hour limit
  useEffect(() => {
    if (isRecording && recordingTime >= MAX_RECORDING_TIME) {
      stopRecording();
      alert('Recording stopped at 1 hour limit. You can start a new recording to continue.');
    }
  }, [recordingTime, isRecording, stopRecording]);

  const startRecording = async () => {
    try {
      console.log('🎤 Starting recording...');
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });

      // Try to use MP3-compatible formats supported by AWS Transcribe
      let options: MediaRecorderOptions = {};

      // Priority: MP4 (creates M4A) > WAV > WebM (fallback)
      if (MediaRecorder.isTypeSupported('audio/mp4')) {
        options = { mimeType: 'audio/mp4' };
        console.log('📹 Using MP4 format for recording (AWS compatible)');
      } else if (MediaRecorder.isTypeSupported('audio/wav')) {
        options = { mimeType: 'audio/wav' };
        console.log('📹 Using WAV format for recording (AWS compatible)');
      } else if (MediaRecorder.isTypeSupported('audio/webm')) {
        options = { mimeType: 'audio/webm' };
        console.log('📹 Using WebM format for recording (will use simulation)');
      } else {
        console.log('📹 Using default format for recording');
      }

      const mediaRecorder = new MediaRecorder(stream, options);
      mediaRecorderRef.current = mediaRecorder;
      
      // Clear previous audio chunks
      audioChunksRef.current = [];
      
      setIsRecording(true);
      setRecordingTime(0);
      
      console.log('⏱️ Setting up recording timer...');
      recordingIntervalRef.current = setInterval(() => {
        setRecordingTime(prev => {
          const newTime = prev + 1;
          console.log(`⏱️ Recording time: ${newTime} seconds`);
          return newTime;
        });
      }, 1000);
      
      mediaRecorder.ondataavailable = (event) => {
        if (event.data.size > 0) {
          audioChunksRef.current.push(event.data);
        }
      };
      
      mediaRecorder.onstop = async () => {
        // Determine the actual MIME type used
        let mimeType = options.mimeType || 'audio/webm';
        let extension = 'webm';

        if (mimeType.includes('wav')) {
          extension = 'wav';
        } else if (mimeType.includes('mp4') || mimeType.includes('m4a')) {
          extension = 'm4a';
        } else if (mimeType.includes('webm')) {
          extension = 'webm';
        }

        const audioBlob = new Blob(audioChunksRef.current, { type: mimeType });
        const fileName = `voice-recording-${Date.now()}.${extension}`;
        console.log('🎤 Recording stopped, audio blob created:', { size: audioBlob.size, type: audioBlob.type, fileName });
        await handleTranscription('microphone', fileName, audioBlob);
      };
      
      mediaRecorder.start();
      console.log('✅ MediaRecorder started successfully');
    } catch (error) {
      console.error('Error accessing microphone:', error);
      alert('Unable to access microphone. Please check your permissions.');
    }
  };

  const handleFileUpload = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (file) {
      console.log('📁 File selected for upload:', { name: file.name, size: file.size, type: file.type });
      
      // Check file size
      if (file.size > MAX_FILE_SIZE) {
        const maxSizeMB = MAX_FILE_SIZE / (1024 * 1024);
        alert(`File size too large. Maximum size is ${maxSizeMB}MB. Your file is ${(file.size / (1024 * 1024)).toFixed(1)}MB.`);
        return;
      }
      
      // Check file type
      const allowedTypes = ['audio/mp3', 'audio/mpeg', 'audio/wav', 'audio/m4a', 'audio/webm'];
      if (!allowedTypes.includes(file.type)) {
        console.error('❌ Invalid file type:', file.type);
        alert(`Invalid file type: ${file.type}. Supported types: MP3, WAV, M4A, WebM`);
        return;
      }
      
      await handleTranscription('file', file.name, file);
    }
  };

  const uploadToS3 = async (audioBlob: Blob, filename: string) => {
    try {
      console.log('📤 Starting S3 upload:', { filename, fileType: audioBlob.type, fileSize: audioBlob.size });
      
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
        const errorText = await response.text();
        console.error('❌ Failed to get upload URL:', response.status, errorText);
        throw new Error(`Failed to get upload URL: ${response.statusText} - ${errorText}`);
      }

      const { uploadUrl, fileKey } = await response.json();
      console.log('✅ Got upload URL and fileKey:', { fileKey });

      // Upload file to S3
      const uploadResponse = await fetch(uploadUrl, {
        method: 'PUT',
        body: audioBlob,
        headers: {
          'Content-Type': audioBlob.type,
        },
      });

      if (!uploadResponse.ok) {
        const errorText = await uploadResponse.text();
        console.error('❌ Failed to upload file to S3:', uploadResponse.status, errorText);
        throw new Error(`Failed to upload file: ${uploadResponse.statusText} - ${errorText}`);
      }

      console.log('✅ File uploaded successfully to S3');
      return fileKey;
    } catch (error) {
      console.error('💥 Error uploading to S3:', error);
      throw error;
    }
  };

  const checkTranscriptionExists = async (transcriptionId: string) => {
    try {
      console.log('🔍 Checking if transcription exists:', transcriptionId);
      const response = await fetch(`${API_BASE_URL}/transcriptions/${transcriptionId}`);
      
      if (response.ok) {
        console.log('✅ Transcription found in database');
        return true;
      } else if (response.status === 404) {
        console.log('❌ Transcription not found in database');
        return false;
      } else {
        console.warn('⚠️ Unexpected response when checking transcription:', response.status);
        return false;
      }
    } catch (error) {
      console.error('💥 Error checking transcription existence:', error);
      return false;
    }
  };

  const startManualTranscriptionJob = async (fileKey: string, originalFileName: string, transcriptionId: string) => {
    try {
      console.log('🚀 Manually starting AWS transcription job...');
      
      // Create a manual transcription record in DynamoDB first
      const createRecordResponse = await fetch(`${API_BASE_URL}/manual-transcription`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          transcriptionId,
          fileKey,
          originalFileName,
          bucketName: 'transcription-audio-files-110068290700-ap-south-1',
          source: originalFileName.includes('voice-recording') ? 'microphone' : 'file'
        }),
      });
      
      if (!createRecordResponse.ok) {
        const errorText = await createRecordResponse.text();
        console.error('❌ Failed to create manual transcription:', createRecordResponse.status, errorText);
        throw new Error(`Failed to create manual transcription: ${errorText}`);
      }
      
      const result = await createRecordResponse.json();
      console.log('✅ Manual transcription job started:', result);
      return result;
    } catch (error) {
      console.error('💥 Error starting manual transcription:', error);
      throw error;
    }
  };

  // Simulation removed - only real AWS transcription now

  const handleTranscription = async (source: 'microphone' | 'file', filename: string, audioBlob?: Blob) => {
    console.log('🎤 Starting transcription process:', { source, filename, blobSize: audioBlob?.size });
    
    setTranscriptionSource(source);
    setFileName(filename);
    setShowTranscriptionModal(true);
    setIsTranscribing(true);
    
    try {
      if (audioBlob) {
        // Upload to S3 first
        console.log('📤 Uploading audio to S3...');
        const fileKey = await uploadToS3(audioBlob, filename);
        console.log('✅ File uploaded successfully to S3:', fileKey);
        
        // Try real AWS transcription first
        const transcriptionId = fileKey.split('.')[0];
        console.log('🔄 File uploaded to S3, trying real AWS transcription...');
        console.log('🔄 Transcription ID:', transcriptionId);
        
        // Check if transcription already exists in database
        const existsInDb = await checkTranscriptionExists(transcriptionId);

        if (existsInDb) {
          console.log('✅ Transcription already exists in database, polling for result...');
          // Poll for existing transcription
          await pollForTranscription(transcriptionId);
        } else {
          console.log('🚀 Starting new AWS transcription job...');
          // Start manual transcription job since S3 trigger might not be set up
          await startManualTranscriptionJob(fileKey, filename, transcriptionId);

          // Wait a moment for the job to start
          await new Promise(resolve => setTimeout(resolve, 3000));

          // Poll for transcription result
          await pollForTranscription(transcriptionId);
        }
      } else {
        throw new Error('No audio data provided');
      }
    } catch (error) {
      console.error('💥 Error during transcription:', error);
      setIsTranscribing(false);

      let errorMessage = 'Failed to process transcription';

      if (error instanceof Error) {
        if (error.message.includes('WebM format not supported')) {
          errorMessage = 'WebM format not supported by AWS Transcribe. Please use MP3, WAV, or M4A files for transcription.';
        } else if (error.message.includes('bucket can\'t be accessed')) {
          errorMessage = 'AWS permissions issue. Please check your AWS configuration.';
        } else {
          errorMessage = error.message;
        }
      }

      alert(`Transcription failed: ${errorMessage}`);
    }
  };

  const autoFixTranscriptions = async () => {
    try {
      console.log('🔧 Attempting auto-fix for stuck transcriptions...');
      
      const response = await fetch(`${API_BASE_URL}/auto-fix`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
      });
      
      if (response.ok) {
        const result = await response.json();
        console.log('✅ Auto-fix completed:', result);
        return result.fixedCount > 0;
      } else {
        console.warn('⚠️ Auto-fix service not available');
        return false;
      }
    } catch (error) {
      console.warn('⚠️ Auto-fix failed:', error);
      return false;
    }
  };

  const tryDirectAutoFix = async (transcriptionId: string) => {
    try {
      console.log('🚀 Trying direct auto-fix for:', transcriptionId);
      
      // Run auto-fix service
      await autoFixTranscriptions();
      
      // Check if transcription is now available
      const response = await fetch(`${API_BASE_URL}/transcriptions/${transcriptionId}`);
      
      if (response.ok) {
        const responseData = await response.json();
        const { transcription } = responseData;
        
        if (transcription?.status === 'COMPLETED' && transcription?.text) {
          console.log('🎉 Direct auto-fix worked! Got transcription:', transcription.text);
          
          setTranscriptionText(transcription.text);
          setIsTranscribing(false);
          
          const newItem: TranscriptionItem = {
            id: transcription.id,
            text: transcription.text,
            source: transcription.source || 'microphone',
            fileName: transcription.fileName || transcription.originalFileName,
            timestamp: new Date(transcription.createdAt)
          };
          
          setTranscriptionHistory(prev => [newItem, ...prev]);
          return true;
        }
      }
      
      return false;
    } catch (error) {
      console.error('❌ Direct auto-fix failed:', error);
      return false;
    }
  };

  const smartWaitForTranscription = async (transcriptionId: string) => {
    console.log('🧠 Smart wait starting for:', transcriptionId);
    
    // IMMEDIATE CHECK: Try auto-fix right away (0 wait)
    console.log('⚡ Immediate check: running auto-fix now...');
    await autoFixTranscriptions();
    
    try {
      const immediateResponse = await fetch(`${API_BASE_URL}/transcriptions/${transcriptionId}`);
      if (immediateResponse.ok) {
        const immediateData = await immediateResponse.json();
        if (immediateData.transcription?.status === 'COMPLETED' && immediateData.transcription?.text) {
          console.log('🎉 INSTANT SUCCESS! Got transcription immediately:', immediateData.transcription.text);
          
          setTranscriptionText(immediateData.transcription.text);
          setIsTranscribing(false);
          
          const newItem: TranscriptionItem = {
            id: immediateData.transcription.id,
            text: immediateData.transcription.text,
            source: immediateData.transcription.source || 'microphone',
            fileName: immediateData.transcription.fileName || immediateData.transcription.originalFileName,
            timestamp: new Date(immediateData.transcription.createdAt)
          };
          
          setTranscriptionHistory(prev => [newItem, ...prev]);
          return; // Instant success!
        }
      }
    } catch (error) {
      console.log('🔄 Immediate check failed, continuing with smart wait...');
    }
    
    // Strategy: Wait in short intervals with auto-fix
    const waitIntervals = [1, 3, 5, 8]; // seconds - much faster!
    
    for (let i = 0; i < waitIntervals.length; i++) {
      const waitTime = waitIntervals[i];
      console.log(`⏱️ Smart wait ${i + 1}/${waitIntervals.length}: waiting ${waitTime}s then auto-fixing...`);
      
      // Wait for AWS Transcribe to potentially complete
      await new Promise(resolve => setTimeout(resolve, waitTime * 1000));
      
      // Auto-fix and check immediately
      console.log('🔧 Running auto-fix after wait...');
      await autoFixTranscriptions();
      
      // Check if transcription is now ready
      try {
        const response = await fetch(`${API_BASE_URL}/transcriptions/${transcriptionId}`);
        
        if (response.ok) {
          const responseData = await response.json();
          const { transcription } = responseData;
          
          if (transcription?.status === 'COMPLETED' && transcription?.text) {
            console.log(`🎉 Smart wait succeeded after ${waitTime}s! Got: "${transcription.text}"`);
            
            setTranscriptionText(transcription.text);
            setIsTranscribing(false);
            
            const newItem: TranscriptionItem = {
              id: transcription.id,
              text: transcription.text,
              source: transcription.source || 'microphone',
              fileName: transcription.fileName || transcription.originalFileName,
              timestamp: new Date(transcription.createdAt)
            };
            
            setTranscriptionHistory(prev => [newItem, ...prev]);
            return; // Success!
          } else if (transcription?.status === 'FAILED') {
            throw new Error('Transcription failed on AWS side');
          } else {
            console.log(`🔄 Still processing (status: ${transcription?.status || 'unknown'}), continuing...`);
          }
        } else {
          console.log('🔄 Transcription not found yet, continuing...');
        }
      } catch (error) {
        console.warn(`⚠️ Check failed at interval ${i + 1}:`, error);
      }
    }
    
    // If we get here, all smart wait attempts failed
    console.warn('⚠️ Smart wait timed out, trying final direct auto-fix...');
    const finalResult = await tryDirectAutoFix(transcriptionId);
    
    if (!finalResult) {
      console.error('❌ Smart wait completely failed');
      setIsTranscribing(false);
      alert('Transcription is taking longer than expected. It might complete in the background - check your history later.');
    }
  };

  const pollForTranscription = async (transcriptionId: string, maxAttempts: number = 30) => {
    console.log(`🔄 Starting to poll for transcription: ${transcriptionId}, max attempts: ${maxAttempts}`);
    
    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      try {
        console.log(`📡 Polling attempt ${attempt + 1}/${maxAttempts} for transcription ID: ${transcriptionId}`);
        
        const response = await fetch(`${API_BASE_URL}/transcriptions/${transcriptionId}`);
        
        console.log(`📡 Poll response status: ${response.status}`);
        
        if (response.ok) {
          const responseData = await response.json();
          console.log('📡 Poll response data:', responseData);
          
          const { transcription } = responseData;
          
          if (transcription) {
            console.log(`📡 Transcription status: ${transcription.status}`);
            
            if (transcription.status === 'COMPLETED' && transcription.text) {
              console.log('✅ Transcription completed successfully!');
              setTranscriptionText(transcription.text);
              setIsTranscribing(false);

              // Add to transcription history
              const newItem: TranscriptionItem = {
                id: transcription.id,
                text: transcription.text,
                source: transcription.source || 'microphone',
                fileName: transcription.fileName || transcription.originalFileName,
                timestamp: new Date(transcription.createdAt)
              };

              setTranscriptionHistory(prev => [newItem, ...prev]);

              return;
            } else if (transcription.status === 'FAILED') {
              console.error('❌ Transcription failed on AWS side');
              throw new Error('Transcription failed on AWS side');
            } else if (transcription.status === 'IN_PROGRESS') {
              console.log('⏳ Transcription still in progress...');
              
              // Try auto-fix after fewer attempts (much faster now)
              if (attempt === 3 || attempt === 8 || attempt === 15) {
                console.log('🔧 Attempting auto-fix for stuck transcription...');
                const fixed = await autoFixTranscriptions();
                if (fixed) {
                  console.log('🎉 Auto-fix may have resolved the issue, continuing polling...');
                }
              }
            } else {
              console.log(`⏳ Transcription status: ${transcription.status}, waiting...`);
            }
          } else {
            console.log('📡 No transcription object found in response');
          }
        } else {
          const errorText = await response.text();
          console.error(`❌ Poll request failed: ${response.status} - ${errorText}`);
          
          if (response.status === 404) {
            console.log('❌ Transcription not found - checking if it exists yet...');
            
            // Try auto-fix on 404 errors after fewer attempts
            if (attempt > 2) {
              console.log('🔧 Transcription not found, trying auto-fix...');
              const fixed = await autoFixTranscriptions();
              if (fixed) {
                console.log('🎉 Auto-fix completed, retrying...');
                continue;
              }
            }
          }
        }
        
        // Progressive backoff: faster polling initially, then slower
        const getPollingInterval = (attempt: number) => {
          if (attempt < 5) return 2000; // 2 seconds for first 5 attempts (10 seconds total)
          if (attempt < 10) return 3000; // 3 seconds for next 5 attempts (15 seconds more)
          return 5000; // 5 seconds for remaining attempts
        };

        const waitTime = getPollingInterval(attempt);
        console.log(`⏰ Waiting ${waitTime / 1000}s before next poll (attempt ${attempt + 1})...`);
        await new Promise(resolve => setTimeout(resolve, waitTime));
      } catch (error) {
        console.error(`💥 Error polling transcription (attempt ${attempt + 1}):`, error);
        
        if (attempt === maxAttempts - 1) {
          // Before giving up, try auto-fix one last time
          console.log('🔧 Final auto-fix attempt before giving up...');
          const fixed = await autoFixTranscriptions();
          
          if (fixed) {
            // Give it one more chance
            try {
              const finalResponse = await fetch(`${API_BASE_URL}/transcriptions/${transcriptionId}`);
              if (finalResponse.ok) {
                const finalData = await finalResponse.json();
                if (finalData.transcription?.status === 'COMPLETED' && finalData.transcription?.text) {
                  console.log('🎉 Auto-fix saved the day!');
                  setTranscriptionText(finalData.transcription.text);
                  setIsTranscribing(false);

                  const newItem: TranscriptionItem = {
                    id: finalData.transcription.id,
                    text: finalData.transcription.text,
                    source: finalData.transcription.source || 'microphone',
                    fileName: finalData.transcription.fileName || finalData.transcription.originalFileName,
                    timestamp: new Date(finalData.transcription.createdAt)
                  };

                  setTranscriptionHistory(prev => [newItem, ...prev]);

                  return;
                }
              }
            } catch (finalError) {
              console.error('Final check failed:', finalError);
            }
          }
          
          // Last attempt failed
          setIsTranscribing(false);
          alert(`Transcription failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
          return;
        }
      }
    }
    
    // Timeout reached - try auto-fix one last time
    console.warn('⏰ Transcription polling timeout reached, trying final auto-fix...');
    const fixed = await autoFixTranscriptions();
    
    if (fixed) {
      // Check one more time
      try {
        const finalResponse = await fetch(`${API_BASE_URL}/transcriptions/${transcriptionId}`);
        if (finalResponse.ok) {
          const finalData = await finalResponse.json();
          if (finalData.transcription?.status === 'COMPLETED' && finalData.transcription?.text) {
            console.log('🎉 Timeout auto-fix worked!');
            setTranscriptionText(finalData.transcription.text);
            setIsTranscribing(false);

            const newItem: TranscriptionItem = {
              id: finalData.transcription.id,
              text: finalData.transcription.text,
              source: finalData.transcription.source || 'microphone',
              fileName: finalData.transcription.fileName || finalData.transcription.originalFileName,
              timestamp: new Date(finalData.transcription.createdAt)
            };

            setTranscriptionHistory(prev => [newItem, ...prev]);

            return;
          }
        }
      } catch (finalError) {
        console.error('Timeout final check failed:', finalError);
      }
    }
    
    setIsTranscribing(false);
    alert('Transcription is taking longer than expected. It might complete in the background - check your history later.');
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

  const deleteHistoryItem = async (id: string, event: React.MouseEvent) => {
    event.stopPropagation();

    try {
      console.log('🗑️ Deleting transcription:', id);

      // Delete from server first
      const response = await fetch(`${API_BASE_URL}/transcriptions/${id}`, {
        method: 'DELETE',
      });

      if (response.ok) {
        console.log('✅ Successfully deleted from server');
        // Only remove from local state if server deletion succeeded
        setTranscriptionHistory(prev => prev.filter(item => item.id !== id));
      } else {
        const errorData = await response.json();
        console.error('❌ Failed to delete from server:', errorData);
        alert('Failed to delete transcription from server');
      }
    } catch (error) {
      console.error('💥 Error deleting transcription:', error);
      alert('Error deleting transcription');
    }
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
              Upload audio or record voice to transcribe
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
                      {item.text ? (item.text.length > 100 ? `${item.text.substring(0, 100)}...` : item.text) : 'Processing...'}
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
                      MP3, WAV, M4A up to 25MB
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
              final year project
            </p>
          </div>
        </div>
      </div>

      {/* History Panel */}
      {showHistoryPanel && (
        <div
          className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center p-4 z-50"
          onClick={() => setShowHistoryPanel(false)}
        >
          <div
            className={`w-full max-w-2xl max-h-[80vh] rounded-2xl border backdrop-blur-xl transition-all duration-300 ${
              isDark
                ? 'bg-black/80 border-white/10'
                : 'bg-white/80 border-black/10'
            }`}
            onClick={(e) => e.stopPropagation()}
          >
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
            <div className="p-6 max-h-[60vh] overflow-y-auto">
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
                  <p className={`text-xs ${isDark ? 'text-white/40' : 'text-black/40'} mt-2`}>
                    💡 For real AWS transcription: Upload MP3, WAV, or M4A files. Voice recordings use simulation.
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