const express = require('express');
const router = express.Router();
const Message = require('../models/Message');

// Send a message
router.post('/send', async (req, res) => {
  const { sender, receiver, message } = req.body;
  const newMessage = new Message({ sender, receiver, message });
  await newMessage.save();
  res.json({ success: true });
});

// Get all messages between two users
router.get('/chat/:sender/:receiver', async (req, res) => {
  const { sender, receiver } = req.params;
  const messages = await Message.find({
    $or: [
      { sender, receiver },
      { sender: receiver, receiver: sender }
    ]
  }).sort({ timestamp: 1 }); // Sorted oldest to newest
  res.json(messages);
});

module.exports = router;
