import React, { useState, useRef, useEffect } from 'react';
import { Mic, MicOff, User, Headphones } from 'lucide-react';
import { io, Socket } from 'socket.io-client';

// Define the shape of the data received from the server
interface TranscriptionData {
  speaker: 'customer' | 'agent';
  transcript: string;
  suggestion?: string | null;
  metadata: {
    confidence: number;
    words: Array<{
      word: string;
      start: number;
      end: number;
      confidence: number;
      punctuated_word: string;
    }>;
  };
}

// Define the shape of the audio data sent to the server
interface AudioData {
  audio: number[];
  speaker: 'customer' | 'agent';
}

// Define the shape of conversation entries
interface ConversationEntry {
  speaker: 'customer' | 'agent';
  text: string;
}

const socket: Socket = io('http://localhost:3000', {
  withCredentials: true,
  transports: ['websocket'],
  upgrade: false
});

function App() {
  const [isCustomerRecording, setIsCustomerRecording] = useState(false);
  const [isAgentRecording, setIsAgentRecording] = useState(false);
  const [conversation, setConversation] = useState<ConversationEntry[]>([]);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);

  useEffect(() => {
    socket.on('connect', () => {
      console.log('Connected to server');
    });

    socket.on('connect_error', (error) => {
      console.error('Connection error:', error);
    });

    socket.on('transcriptionAndSuggestion', (data: TranscriptionData) => {
      console.log('Received data:', data);
      setConversation((prev: ConversationEntry[]): ConversationEntry[] => {
        const newEntries: ConversationEntry[] = [
          { speaker: data.speaker, text: data.transcript } // Type is preserved from data.speaker
        ];
        if (data.suggestion) {
          newEntries.push({ speaker: 'agent', text: data.suggestion }); // 'agent' is a literal
        }
        return [...prev, ...newEntries];
      });
    });

    socket.on('error', (error: { message: string }) => {
      console.error('Server error:', error);
    });

    return () => {
      socket.off('transcriptionAndSuggestion');
      socket.off('error');
      socket.off('connect');
      socket.off('connect_error');
    };
  }, []);

  const startRecording = async (isCustomer: boolean) => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mediaRecorder = new MediaRecorder(stream);
      mediaRecorderRef.current = mediaRecorder;

      const audioChunks: BlobPart[] = [];

      mediaRecorder.ondataavailable = (event) => {
        audioChunks.push(event.data);
      };

      mediaRecorder.onstop = async () => {
        const audioBlob = new Blob(audioChunks, { type: 'audio/webm' });
        const arrayBuffer = await audioBlob.arrayBuffer();
        socket.emit('audioData', {
          audio: Array.from(new Uint8Array(arrayBuffer)),
          speaker: isCustomer ? 'customer' : 'agent'
        } as AudioData);
      };

      mediaRecorder.start();
      if (isCustomer) {
        setIsCustomerRecording(true);
      } else {
        setIsAgentRecording(true);
      }
    } catch (error) {
      console.error('Error accessing microphone:', error);
    }
  };

  const stopRecording = (isCustomer: boolean) => {
    if (mediaRecorderRef.current) {
      mediaRecorderRef.current.stop();
      mediaRecorderRef.current.stream.getTracks().forEach(track => track.stop());
      if (isCustomer) {
        setIsCustomerRecording(false);
      } else {
        setIsAgentRecording(false);
      }
    }
  };

  return (
    <div className="min-h-screen bg-gray-100">
      <div className="container mx-auto px-4 py-8">
        <h1 className="text-3xl font-bold text-center mb-8">Sales Assistant AI</h1>
        
        <div className="grid md:grid-cols-2 gap-8">
          {/* Customer Section */}
          <div className="bg-white rounded-lg p-6 shadow-lg">
            <div className="flex items-center gap-4 mb-4">
              <User className="w-8 h-8 text-blue-600" />
              <h2 className="text-xl font-semibold">Customer</h2>
            </div>
            <button
              onClick={() => isCustomerRecording ? stopRecording(true) : startRecording(true)}
              className={`w-full py-4 rounded-lg flex items-center justify-center gap-2 ${
                isCustomerRecording 
                  ? 'bg-red-500 hover:bg-red-600 text-white' 
                  : 'bg-blue-500 hover:bg-blue-600 text-white'
              }`}
            >
              {isCustomerRecording ? (
                <><MicOff className="w-6 h-6" /> Stop Recording</>
              ) : (
                <><Mic className="w-6 h-6" /> Start Recording</>
              )}
            </button>
          </div>

          {/* Agent Section */}
          <div className="bg-white rounded-lg p-6 shadow-lg">
            <div className="flex items-center gap-4 mb-4">
              <Headphones className="w-8 h-8 text-green-600" />
              <h2 className="text-xl font-semibold">Sales Agent</h2>
            </div>
            <button
              onClick={() => isAgentRecording ? stopRecording(false) : startRecording(false)}
              className={`w-full py-4 rounded-lg flex items-center justify-center gap-2 ${
                isAgentRecording 
                  ? 'bg-red-500 hover:bg-red-600 text-white' 
                  : 'bg-green-500 hover:bg-green-600 text-white'
              }`}
            >
              {isAgentRecording ? (
                <><MicOff className="w-6 h-6" /> Stop Recording</>
              ) : (
                <><Mic className="w-6 h-6" /> Start Recording</>
              )}
            </button>
          </div>
        </div>

        {/* Conversation History */}
        {conversation.length > 0 && (
          <div className="mt-8 bg-white rounded-lg p-6 shadow-lg">
            <h3 className="text-xl font-semibold mb-4">Conversation History</h3>
            <div className="space-y-4">
              {conversation.map((entry, index) => (
                <div
                  key={index}
                  className={`p-3 rounded ${
                    entry.speaker === 'customer'
                      ? 'bg-blue-50 border-blue-200'
                      : 'bg-green-50 border-green-200'
                  } border`}
                >
                  <strong>{entry.speaker === 'customer' ? 'Customer' : 'Agent'}:</strong> {entry.text}
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

export default App;