const express = require('express');
const puppeteer = require('puppeteer');
const cheerio = require('cheerio');
const cors = require('cors');
const OpenAI = require('openai');

require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 5000;

// Initialize OpenAI
const openai = new OpenAI({ apiKey: process.env.API_KEY });

// Middleware
app.use(cors());
app.use(express.json());

// Helper function to clean and format the extracted text
const cleanText = (text) => {
  return text
    .replace(/\s+/g, ' ')
    .replace(/[^\x00-\x7F]/g, '')
    .trim();
};

// Function to generate AI-based content using OpenAI
async function rewriteField(prompt) {
  try {
    const completion = await openai.chat.completions.create({
      model: "gpt-3.5-turbo",
      messages: [
        { role: "user", content: prompt }
      ]
    });

    return completion.choices[0].message.content;
  } catch (error) {
    console.error('Error generating AI content:', error);
    return 'Error generating content';
  }
}

// State to handle one request at a time
let isProcessing = false;

// Route to fetch and extract text from a URL using Puppeteer
app.post('/extract-text', async (req, res) => {
  const { url } = req.body;

  console.log('Received request to extract text from URL:', url);

  if (!url) {
    return res.status(400).json({ error: 'URL is required' });
  }

  if (isProcessing) {
    return res.status(429).json({ error: 'Another request is currently being processed. Please try again later.' });
  }

  isProcessing = true;

  try {
    console.log('Launching headless browser...');
    const browser = await puppeteer.launch({
      headless: 'new',  // Use the new headless mode
      args: ['--no-sandbox', '--disable-setuid-sandbox']  // Additional arguments for stability
    });
    const page = await browser.newPage();

    await page.setUserAgent(
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/58.0.3029.110 Safari/537.3'
    );

    console.log('Navigating to URL...');
    await page.goto(url, { waitUntil: 'networkidle2' });

    console.log('Extracting HTML content...');
    const html = await page.content();

    await browser.close();

    const $ = cheerio.load(html);
    console.log('HTML loaded successfully.');

    let extractedText = '';

    $('p, h1, h2, h3, div, span').each((_, element) => {
      const text = $(element).text();
      const clean = cleanText(text);
      if (clean.length > 50) {
        extractedText += clean + ' ';
      }
    });

    console.log('Text extracted and cleaned from the page.');

    console.log('Sending text to AI for rewriting...');
    const aiPrompt = `Based on the following extracted text, provide suggestions and recommendations: ${extractedText}`;
    const aiResponse = await rewriteField(aiPrompt);

    res.json({
      extractedText,
      aiSuggestions: aiResponse,
    });
  } catch (error) {
    console.error('Error extracting text from the URL:', error.message);
    res.status(500).json({ error: 'Error extracting text from the URL' });
  } finally {
    isProcessing = false;
  }
});

// New endpoint for replying to messages
app.post('/chat', async (req, res) => {
  const { message, pageContent } = req.body;

  if (!message) {
    return res.status(400).json({ error: 'Message is required' });
  }

  try {
    console.log('Generating AI response...');
    const prompt = `Given the following page content: "${pageContent}", and the user message: "${message}", provide a helpful and contextual response.`;
    
    const aiResponse = await rewriteField(prompt);

    res.json({
      reply: aiResponse,
    });
  } catch (error) {
    console.error('Error generating chat response:', error.message);
    res.status(500).json({ error: 'Error generating chat response' });
  }
});

app.listen(PORT, () => {
  console.log(`Server is running on http://localhost:${PORT}`);
});