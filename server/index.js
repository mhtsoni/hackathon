import express from 'express';
import { createServer } from 'http';
import { Server } from 'socket.io';
import { createClient } from '@deepgram/sdk';
import dotenv from 'dotenv';
import cors from 'cors';
import axios from 'axios';


dotenv.config({ path: '/Users/mohison/Downloads/project/.env' });

// Validate environment variables
console.log('Deepgram API Key:', process.env.DEEPGRAM_API_KEY);
console.log('Grok API Key:', process.env.GROK_API_KEY);
if (!process.env.DEEPGRAM_API_KEY || !process.env.GROK_API_KEY) {
  console.error('Error: Missing required API keys in environment variables.');
  process.exit(1);
}

const app = express();
app.use(cors({
  origin: "http://localhost:5173",
  methods: ["GET", "POST"],
  credentials: true
}));

const server = createServer(app);
const io = new Server(server, {
  cors: {
    origin: "http://localhost:5173",
    methods: ["GET", "POST"],
    credentials: true,
    allowedHeaders: ["my-custom-header"]
  }
});

const deepgram = createClient(process.env.DEEPGRAM_API_KEY);
const conversationHistories = new Map();

const axios = require('axios');
const fs = require('fs');
const pdfParse = require('pdf-parse'); // Install via npm: npm install pdf-parse

async function generateGrokResponse(history) {
  try {
    const conversationText = history
      .map(entry => `${entry.speaker === 'customer' ? 'Customer' : 'Agent'}: ${entry.text}`)
      .join('\n');

    const latestCustomerInput = history
      .filter(entry => entry.speaker === 'customer')
      .pop()?.text || '';

    // Hardcoded PDF path
    const pdfPath = './product_info.pdf'; // Replace with your actual PDF path
    const pdfBuffer = fs.readFileSync(pdfPath);
    const pdfData = await pdfParse(pdfBuffer);
    const pdfContent = pdfData.text;

    // Simple RAG: Split PDF content and retrieve relevant chunk
    const pdfSentences = pdfContent.split('.').map(s => s.trim()).filter(s => s);
    const relevantContext = pdfSentences.find(sentence => 
      sentence.toLowerCase().includes(latestCustomerInput.toLowerCase().split(' ')[0])) 
      || pdfSentences[0] || '';

    const prompt = `You must return the response in very short sentence form and more than 2 sentences. Less than 60 words.
    You are an AI that is assisting a sales agent in making sales. 
    Provide persuasive ideas to convince the customer to buy the product/service.
    Use this PDF context if relevant: "${relevantContext}".
    Please figure out what product or service we are selling based on the conversation.
    If the product/service isn’t deducible, offer a generic tactic.

    Understand the conversation so far:\n${conversationText}\n.
    The customer just said: "${latestCustomerInput}". 
    `;

    const response = await axios.post(
      'https://api.x.ai/v1/chat/completions',
      {
        model: 'grok-beta',
        messages: [{ role: 'user', content: prompt }],
        max_tokens: 150,
        temperature: 0.7,
      },
      {
        headers: {
          'Authorization': `Bearer ${process.env.GROK_API_KEY}`,
          'Content-Type': 'application/json',
        },
      }
    );

    console.log('Grok API Response:', JSON.stringify(response.data, null, 2));

    if (response.data.code && response.data.code !== 200) {
      throw new Error(`Grok API error: ${response.data.msg || 'Unknown error'} (Code: ${response.data.code})`);
    }

    const grokResponse = response.data.choices?.[0]?.message?.content || 'No response generated';
    return grokResponse.trim();
  } catch (error) {
    console.error('Error calling Grok API:', error.response?.data || error.message);
    return 'I do not have any inputs sorry!';
  }
}
io.on('connection', (socket) => {
  console.log('Client connected');
  conversationHistories.set(socket.id, []);

  socket.on('audioData', async (data) => {
    try {
      const { audio, speaker } = data;
      console.log('Received audioData type:', typeof audio);
      console.log('Received audioData length:', audio.length);
      console.log('Received audioData sample:', audio.slice(0, 10));
      console.log('Speaker:', speaker);

      if (!Array.isArray(audio)) {
        throw new Error('Expected audioData.audio to be an array');
      }
      const audioBuffer = Buffer.from(audio);

      const { result, error } = await deepgram.listen.prerecorded.transcribeFile(
        audioBuffer,
        {
          mimetype: 'audio/webm',
          model: 'nova-2',
          language: 'en',
          smart_format: true,
          utterances: true
        }
      );

      if (error) {
        throw new Error(`Deepgram API error: ${error.message || error}`);
      }

      console.log('Deepgram Result:', JSON.stringify(result, null, 2));

      if (!result || !result.results || !result.results.channels || !result.results.channels[0] || !result.results.channels[0].alternatives || !result.results.channels[0].alternatives[0]) {
        throw new Error('Unexpected Deepgram response: Missing channels or alternatives');
      }

      const transcript = result.results.channels[0].alternatives[0].transcript;
      if (!transcript) {
        throw new Error('Transcription resulted in an empty transcript');
      }

      const history = conversationHistories.get(socket.id);
      history.push({ speaker, text: transcript });

      let suggestion = null;
      if (speaker === 'customer') {
        suggestion = await generateGrokResponse(history); // Await the async call
      }

      socket.emit('transcriptionAndSuggestion', {
        speaker,
        transcript,
        suggestion,
        metadata: {
          confidence: result.results.channels[0].alternatives[0].confidence,
          words: result.results.channels[0].alternatives[0].words
        }
      });
    } catch (error) {
      console.error('Error processing audio:', error);
      socket.emit('error', { message: error.message || 'Error processing audio' });
    }
  });

  socket.on('disconnect', () => {
    console.log('Client disconnected');
    conversationHistories.delete(socket.id);
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});