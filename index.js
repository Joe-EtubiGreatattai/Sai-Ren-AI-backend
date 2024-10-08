const express = require("express");
const cors = require("cors");
const axios = require("axios");
const cheerio = require("cheerio");
const puppeteer = require("puppeteer");
const OpenAI = require("openai");

require("dotenv").config();

const app = express();
const PORT = process.env.PORT || 5000;

// Initialize OpenAI
const openai = new OpenAI({ apiKey: process.env.API_KEY });

// Middleware
app.use(cors());
app.use(express.json());

// In-memory store for conversation history and extracted content
const conversationHistory = {};
const extractedContent = {};

// URLs for relevant pages like FAQs, company policies, etc.
const urlsToExtract = [
  { name: "FAQ", url: "https://sai-ren-ai-frontend.vercel.app/about-us" },
];

// Helper function to clean and format the extracted text
const cleanText = (text) => {
  return text
    .replace(/\s+/g, " ")
    .replace(/[^\x00-\x7F]/g, "")
    .trim();
};

// Fetch and extract text content from a URL using Puppeteer to handle JavaScript
async function extractTextFromURL(url) {
  try {
    const browser = await puppeteer.launch();
    const page = await browser.newPage();

    // Set the user agent to avoid bot detection
    await page.setUserAgent(
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36"
    );

    await page.goto(url, { waitUntil: "networkidle2" }); // Wait for the page to finish loading

    // Extract the rendered content
    const extractedText = await page.evaluate(() => document.body.innerText);

    await browser.close();

    return cleanText(extractedText);
  } catch (error) {
    console.error("Error fetching or extracting text with Puppeteer:", error);
    return null;
  }
}

// Load and extract text from all specified URLs on server start
async function loadContent() {
  for (const { name, url } of urlsToExtract) {
    const extractedText = await extractTextFromURL(url);
    if (extractedText) {
      extractedContent[name] = extractedText;
      console.log(`Extracted content from ${name} page.`);
    } else {
      console.error(`Failed to extract content from ${url}`);
    }
  }
}

// Function to generate AI-based content using OpenAI
async function generateAIContent(prompt) {
  try {
    const completion = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [{ role: "user", content: prompt }],
    });

    return completion.choices[0].message.content;
  } catch (error) {
    console.error("Error generating AI content:", error);
    return "Error generating content";
  }
}

// Function to extract main search query using AI
async function extractSearchQuery(userInput) {
  const prompt = `Extract the main search query from the user is looking for.make sure the query is contextually correct and relevant to the user's search (preferablly the single text). Return only the extracted query, nothing else: "${userInput}"`;
  return await generateAIContent(prompt);
}

// Central AI agent endpoint
app.post("/ai-agent", async (req, res) => {
  const { input, userId } = req.body;

  if (!input || !userId) {
    return res.status(400).json({ error: "Input and User ID are required" });
  }

  try {
    // Determine the appropriate action based on user input
    const actionPrompt = `Given the following user input: "${input}", determine the most appropriate action from these options: "chat", "extract-text", "search", "check-order". Note if you are not sure of the action, respond with "chat". Respond with only the action name.`;
    const action = await generateAIContent(actionPrompt);

    let response;
    switch (action.toLowerCase().trim()) {
      case "chat":
        response = await handleChat(input, userId);
        break;
      case "extract-text":
        response = { error: "Text extraction is handled in the backend." };
        break;
      case "search":
        response = await handleSearch(input);
        break;
      case "check-order":
        response = await handleCheckOrder(input, userId);
        break;
      default:
        response = await handleChat(input, userId);
    }

    res.json(response);
  } catch (error) {
    console.error("Error in AI agent:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

async function handleChat(message, userId) {
  console.log("handleChat function called");
  if (!conversationHistory[userId]) {
    conversationHistory[userId] = [];
  }

  conversationHistory[userId].push({ role: "user", content: message });

  // Combine extracted content (e.g., FAQs and Company Policies) as part of the context
  const context = Object.entries(extractedContent)
    .map(([name, content]) => `From ${name}: ${content}`)
    .join("\n\n");

  const conversationContext = [
    {
      role: "system",
      content:
        "You are Sai Ren AI. Provide helpful, concise responses without special characters. Use simple language and keep answers brief.",
    },
    ...conversationHistory[userId],
    {
      role: "system",
      content: `Based on the following context: "${context}", provide a contextual response.`,
    },
  ];

  const completion = await openai.chat.completions.create({
    model: "gpt-4o-mini",
    messages: conversationContext,
  });

  let aiResponse = completion.choices[0].message.content;

  // Clean the text: remove special characters and extra spaces
  aiResponse = aiResponse
    .replace(/[^\w\s.,?!]/g, "")
    .replace(/\s+/g, " ")
    .trim();

  conversationHistory[userId].push({ role: "assistant", content: aiResponse });

  return { reply: aiResponse };
}

async function handleSearch(query) {
  console.log("handleSearch function called");

  // Extract the main search query using AI
  const extractedQuery = await extractSearchQuery(query);
  console.log("Extracted search query:", extractedQuery);

  // Construct the API URL for searching products
  const apiUrl = `https://dummyjson.com/products/search?q=${encodeURIComponent(
    extractedQuery
  )}`;
  console.log("API URL:", apiUrl);

  try {
    // Fetch data from the API
    const response = await axios.get(apiUrl);
    console.log("API response received", response.data);

    if (response.status !== 200) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }

    const data = response.data;

    // Process the search results
    const processedResults = data.products.map((product) => ({
      id: product.id,
      title: product.title,
      description: product.description || "No description available",
      price: product.price,
      rating: product.rating,
      stock: product.stock,
      brand: product.brand,
      images: product.images || [],
      category: product.category,
      discountPercentage: product.discountPercentage,
      availabilityStatus: product.availabilityStatus || "Unknown",
      returnPolicy: product.returnPolicy || "Standard return policy applies",
      reviews: product.reviews
        ? product.reviews.map((review) => ({
            rating: review.rating,
            comment: review.comment,
            date: review.date,
            reviewerName: review.reviewerName,
          }))
        : [],
      warrantyInformation:
        product.warrantyInformation || "Standard warranty applies",
      shippingInformation:
        product.shippingInformation || "Standard shipping applies",
    }));

    // Generate a recommendation based on multiple criteria (rating, price, stock)
    let bestProduct = null;
    let highestScore = -Infinity; // Track the best score to recommend the product

    processedResults.forEach((product) => {
      let score = 0;

      // Scoring criteria (custom logic):
      // Higher rating = higher score
      score += product.rating * 2;

      // Lower price = higher score
      score += (1 / product.price) * 10;

      // Products with stock get a small bonus
      if (product.stock > 0) {
        score += 1;
      }

      // Find the best product based on the score
      if (score > highestScore) {
        highestScore = score;
        bestProduct = product;
      }
    });

    // If a best product is found, recommend it
    let recommendation = "";
    if (bestProduct) {
      recommendation = `We recommend: ${bestProduct.title} ($${bestProduct.price}) with a rating of ${bestProduct.rating} and ${bestProduct.stock} in stock.`;
    } else {
      recommendation =
        "No suitable product recommendation could be made based on the current search.";
    }

    return { reply: recommendation, results: processedResults };
  } catch (error) {
    console.error("Error fetching data:", error);
    return { error: "Failed to fetch search results" };
  }
}

async function handleCheckOrder(input, userId) {
  // Construct a prompt to extract the order ID
  const prompt = `Extract order ID from the following input: "${input}" if you cant find the order id then respond with nothing`;
  const orderId = await generateAIContent(prompt);

  // Check if an order ID was extracted
  if (!orderId || orderId.trim() === "") {
    return {
      orderId: null,
      reply: "Please provide a valid order ID to check the status.",
    };
  }

  // Generate random order statuses dynamically
  const orderStatuses = [
    "Processing",
    "Shipped",
    "Delivered",
    "Cancelled",
    "On Hold",
  ];
  const randomStatus =
    orderStatuses[Math.floor(Math.random() * orderStatuses.length)];

  // Return the order ID and a dynamic status message
  return {
    orderId,
    reply: `Order ID: ${orderId} is currently: ${randomStatus}.`,
  };
}

// Start the server and load the initial content
app.listen(PORT, async () => {
  console.log(`Server running on port ${PORT}`);
  await loadContent(); // Load and extract content from URLs on startup
});
