const mongoose = require('mongoose');

const userSchema = new mongoose.Schema({
  name: String,
  username: { type: String, required: true, unique: true },
  email: String,
  password: String,
  profileImage: String,
  resetToken: String,            // 🔹 for password reset
  resetTokenExpiry: Date,        // 🔹 expiration time

  // ✅ New field for buyer role
  role: {
    type: String,
    enum: ['user', 'buyer', 'admin'],
    default: 'user'
  }
});

module.exports = mongoose.model('User', userSchema);
