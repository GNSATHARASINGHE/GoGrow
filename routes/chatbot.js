const express = require('express');
const router = express.Router();

router.post('/chatbot', async (req, res) => {
  const userMsg = req.body.message.toLowerCase();
  let reply = "Sorry, I don't understand. Please ask about crops, fertilizers, or soil.";

  // ✅ Keyword-based stored replies
  if (userMsg.includes('hello') || userMsg.includes('hi')) {
    reply = "Hi there! 🌱 How can I assist you with farming today?";
  } else if (userMsg.includes('crop') && userMsg.includes('best')) {
    reply = "Popular crops for your region include rice, maize, and mung bean.";
  } else if (userMsg.includes('fertilizer')) {
    reply = "You can try compost, urea, or NPK depending on your crop and soil.";
  } else if (userMsg.includes('soil')) {
    reply = "Make sure your soil has proper pH (6–7). You can test it with a basic kit.";
  } else if (userMsg.includes('bye')) {
    reply = "Goodbye! 🌾 Wishing you a successful harvest!";
  }

  res.json({ reply });
});

module.exports = router;
