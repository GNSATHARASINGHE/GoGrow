// models/Post.js
const mongoose = require('mongoose');

const PostSchema = new mongoose.Schema({
  user: String,
  crop: String,
  quantity: String,
  price: String,
  imageUrls: [String],
  timestamp: String,

  // Add approval status
  status: {
    type: String,
    enum: ['pending', 'approved', 'rejected'],
    default: 'pending'
  }
});

module.exports = mongoose.model('Post', PostSchema);
