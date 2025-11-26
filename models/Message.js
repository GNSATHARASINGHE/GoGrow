const mongoose = require('mongoose');

const messageSchema = new mongoose.Schema({
  sender: String,
  receiver: String,
  message: String,
  timestamp: {
    type: Date,
    default: Date.now
  },
  read: {
    type: Boolean,
    default: false   // ✅ ensures messages start as unread
  }
});

module.exports = mongoose.model('Message', messageSchema);
