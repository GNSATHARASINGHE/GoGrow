const express = require('express');
const app = express();
const path = require('path');
const multer = require('multer');
const mongoose = require('mongoose');
const fs = require('fs');
const bcrypt = require('bcrypt');
const crypto = require('crypto');
const nodemailer = require('nodemailer');
const xlsx = require('xlsx'); // ✅ for reading Excel dataset
const MLR = require('ml-regression-multivariate-linear');

const http = require('http');
const server = http.createServer(app);
const { Server } = require('socket.io');
const io = new Server(server, {
  cors: {
    origin: "*"
  }
});




// Models
const Post = require('./models/Post'); // Make sure this supports imageUrls: [String]
const User = require('./models/User');
const Message = require('./models/Message');

const PORT = process.env.PORT || 3000;

// ✅ Connect to MongoDB
mongoose.connect('mongodb://localhost:27017/gogrow', {
  useNewUrlParser: true,
  useUnifiedTopology: true,
}).then(() => console.log("✅ Connected to MongoDB"))
  .catch(err => console.error("❌ MongoDB error:", err));

// ✅ Middleware
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// ✅ Serve static files
app.use(express.static('public'));
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));
const chatbotRoute = require('./routes/chatbot');
app.use('/api', chatbotRoute);

/* ======================= DEMAND–SUPPLY DATA LOAD ======================= */
const DATA_PATH = path.join(__dirname, 'data', 'Agri_Demand_Supply_Sabaragamuwa_Expanded_2022_2025.xlsx');

let DF = [];
try {
  const wb = xlsx.readFile(DATA_PATH);
  const sheet = wb.Sheets['Data'];
  DF = xlsx.utils.sheet_to_json(sheet, { defval: null }).map(r => ({
  ...r,
  Year: Number(r['Year']),
  Area_Cultivated_ha: Number(r['Area_Cultivated_ha']),
  Yield_t_per_ha: Number(r['Yield_t_per_ha']),
  Total_Production_t: Number(r['Total_Production_t']),
  Market_Price_Rs_per_kg: Number(r['Market_Price_Rs_per_kg']),
  Total_Demand_t: Number(r['Total_Demand_t']),
  'Supply_Demand_Gap_%': Number(r['Supply_Demand_Gap_%']), // ✅ quoted key + bracket access
}));

  console.log(`📘 Loaded dataset rows: ${DF.length}`);
} catch (e) {
  console.error('❌ Failed to load dataset at', DATA_PATH, e.message);
}

/* ======================= HELPER FUNCTIONS ======================= */
function filterFrame(regions, seasons, years) {
  const reg = new Set(regions);
  const sea = new Set(seasons);
  const yr  = new Set(years.map(Number));
  return DF.filter(r => reg.has(r.Region) && sea.has(r.Season) && yr.has(r.Year));
}

function aggregateByCrop(rows) {
  const map = new Map();
  for (const r of rows) {
    if (!map.has(r.Crop)) map.set(r.Crop, { s: 0, d: 0 });
    const v = map.get(r.Crop);
    v.s += r.Total_Production_t || 0;
    v.d += r.Total_Demand_t || 0;
  }
  const out = [];
  for (const [crop, v] of map.entries()) {
    const posGap = Math.max(0, v.d - v.s);
    out.push({
      Crop: crop,
      Total_Supply_t: Number(v.s.toFixed(2)),
      Total_Demand_t: Number(v.d.toFixed(2)),
      Positive_Gap_t: Number(posGap.toFixed(2)),
    });
  }
  out.sort((a,b) => a.Crop.localeCompare(b.Crop));
  return out;
}

// Simple linear regression → forecast next year
function linearForecastNext(years, values) {
  if (years.length < 2) return values[values.length - 1] || 0;
  const n = years.length;
  const meanX = years.reduce((a,b)=>a+b,0)/n;
  const meanY = values.reduce((a,b)=>a+b,0)/n;
  let num = 0, den = 0;
  for (let i=0;i<n;i++) {
    num += (years[i]-meanX) * (values[i]-meanY);
    den += (years[i]-meanX) ** 2;
  }
  const slope = den === 0 ? 0 : num/den;
  const intercept = meanY - slope*meanX;
  const nextYear = Math.max(...years) + 1;
  const pred = intercept + slope*nextYear;
  return Math.max(0, pred);
}

function forecastByCrop(regions, season, years) {
  const yrSet = new Set(years.map(Number));
  const rows = DF.filter(r => regions.includes(r.Region) && r.Season === season && yrSet.has(r.Year));
  const byCropYear = new Map();

  for (const r of rows) {
    if (!byCropYear.has(r.Crop)) byCropYear.set(r.Crop, new Map());
    const m = byCropYear.get(r.Crop);
    if (!m.has(r.Year)) m.set(r.Year, { s: 0, d: 0 });
    const o = m.get(r.Year);
    o.s += r.Total_Production_t || 0;
    o.d += r.Total_Demand_t || 0;
  }

  const nextYear = Math.max(...years) + 1;
  const out = [];
  for (const [crop, yearMap] of byCropYear.entries()) {
    const yrs = Array.from(yearMap.keys()).sort((a,b)=>a-b);
    const sArr = yrs.map(y => yearMap.get(y).s);
    const dArr = yrs.map(y => yearMap.get(y).d);

    const sPred = linearForecastNext(yrs, sArr);
    const dPred = linearForecastNext(yrs, dArr);
    const posGap = Math.max(0, dPred - sPred);

    out.push({
      Crop: crop,
      Forecast_Year: nextYear,
      Forecast_Season: season,
      Forecast_Supply_t: Number(sPred.toFixed(2)),
      Forecast_Demand_t: Number(dPred.toFixed(2)),
      Forecast_Positive_Gap_t: Number(posGap.toFixed(2)),
    });
  }
  out.sort((a,b) => a.Crop.localeCompare(b.Crop));
  return out;
}
/* ===================================================================== */



// ✅ 1. For post images — unique filenames
const postStorage = multer.diskStorage({
  destination: (req, file, cb) => {
    const dir = 'uploads';
    if (!fs.existsSync(dir)) fs.mkdirSync(dir);
    cb(null, dir);
  },
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname);
    const uniqueName = Date.now() + '-' + Math.random().toString(36).substring(2, 8) + ext;
    cb(null, uniqueName); // 🟢 Unique file
  }
});
const uploadPost = multer({ storage: postStorage });

// ✅ 2. For profile image — saved as username.png
const profileStorage = multer.diskStorage({
  destination: (req, file, cb) => {
    const dir = 'uploads';
    if (!fs.existsSync(dir)) fs.mkdirSync(dir);
    cb(null, dir);
  },
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname);
    let rawUsername = req.body.username || 'user';
    rawUsername = rawUsername.replace(/\s+/g, '_');
    cb(null, `${rawUsername}${ext}`); // 🟢 Overwrites by username
  }
});
const uploadProfile = multer({ storage: profileStorage });



/* ========== USER ROUTES ========== */
app.get('/api/my-posts/:username', async (req, res) => {
  try {
    const posts = await Post.find({ user: req.params.username });
    res.json(posts);
  } catch (err) {
    console.error("Failed to fetch user posts:", err);
    res.status(500).json({ error: 'Server error' });
  }
});

app.get('/api/all-users', async (req, res) => {
  try {
    const users = await User.find({}, 'username'); // Only fetch usernames
    res.json(users.map(user => user.username));
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch users' });
  }
});


app.post('/api/register', uploadProfile.single('profileImage'), async (req, res) => {
  try {
    const { name, username, email, password, role } = req.body; // ✅ include role

    const existingUser = await User.findOne({ username });
    if (existingUser) return res.status(400).json({ error: 'Username already exists' });

    const hashedPassword = await bcrypt.hash(password, 10);
    const profileImagePath = req.file ? `/uploads/${req.file.filename}` : null;

    const newUser = new User({
      name,
      username,
      email,
      password: hashedPassword,
      profileImage: profileImagePath,
      role  // ✅ assign role
    });

    await newUser.save();
    res.json({ message: 'Registration successful' });

  } catch (err) {
    console.error("❌ Registration error:", err);
    res.status(500).json({ error: 'Registration failed' });
  }
});



// Login
app.post('/api/login', async (req, res) => {
  try {
    const { identifier, password } = req.body;

    // Find user by email or username
    const user = await User.findOne({
      $or: [{ email: identifier }, { username: identifier }]
    });

    if (!user) return res.status(400).json({ error: 'User not found' });

    const isMatch = await bcrypt.compare(password, user.password);
    if (!isMatch) return res.status(400).json({ error: 'Invalid credentials' });

    // ✅ Send back username and role to frontend
    res.json({
  message: 'Login successful',
  username: user.username,
  role: user.role || (user.isAdmin ? 'admin' : 'user')
});


  } catch (err) {
    console.error("❌ Login error:", err);
    res.status(500).json({ error: 'Login failed' });
  }
});


// Forgot Password: Send token via email
app.post('/api/forgot-password', async (req, res) => {
  const { resetInput } = req.body;

  try {
    const user = await User.findOne({
      $or: [{ email: resetInput }, { username: resetInput }]
    });

    if (!user) return res.status(404).json({ error: "User not found." });

    const token = crypto.randomBytes(32).toString('hex');
    user.resetToken = token;
    user.resetTokenExpiry = Date.now() + 1000 * 60 * 60; // 1 hour
    await user.save();

    const resetLink = `http://localhost:3000/reset-password.html?token=${token}`;

    // Send email using Nodemailer and Gmail
    const transporter = nodemailer.createTransport({
      service: 'gmail',
      auth: {
        user: 'gogrow799@gmail.com',         // ✅ Your Gmail
        pass: 'zbze eaxv dzao scdt'       // ✅ Gmail App Password (not regular password)
      }
    });

    const mailOptions = {
      from: 'GoGrow App <yourgmail@gmail.com>',
      to: user.email,
      subject: 'Reset Your GoGrow Password',
      html: `
        <p>Hello ${user.name || user.username},</p>
        <p>You requested a password reset. Click the link below to set a new password:</p>
        <a href="${resetLink}">${resetLink}</a>
        <p>This link is valid for 1 hour. If you did not request a reset, you can ignore this email.</p>
      `
    };

    await transporter.sendMail(mailOptions);
    res.json({ message: "✅ Password reset link sent to your email." });

  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Something went wrong." });
  }
});

// Reset Password: Use token and set new password
app.post('/api/reset-password', async (req, res) => {
  const { token, newPassword } = req.body;

  try {
    const user = await User.findOne({
      resetToken: token,
      resetTokenExpiry: { $gt: Date.now() }
    });

    if (!user) return res.status(400).json({ error: "Token invalid or expired." });

    user.password = await bcrypt.hash(newPassword, 10);
    user.resetToken = undefined;
    user.resetTokenExpiry = undefined;
    await user.save();

    res.json({ message: "✅ Password reset successful!" });

  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "❌ Failed to reset password." });
  }
});



/* ========== POST ROUTES ========== */

// Create post with multiple images
app.post('/api/post', uploadPost.array('images[]', 10), async (req, res) => {
  try {
    const { user, crop, quantity, price } = req.body;

    if (!req.files || req.files.length === 0) {
      return res.status(400).json({ error: 'No images uploaded' });
    }

    const imageUrls = req.files.map(file => `/uploads/${file.filename}`);

    const post = new Post({
  user,
  crop,
  quantity,
  price,
  imageUrls,
  timestamp: new Date().toLocaleString(),
  status: 'pending'  // ✅ Mark post as pending by default
});


    await post.save();
    io.emit('new-post', post); // 🟢 Realtime update for admins

    res.json({ message: 'Post submitted successfully!' });
  } catch (err) {
    console.error("❌ Failed to save post:", err.message);
    res.status(500).json({ error: 'Failed to save post', details: err.message });
  }
});

app.get('/api/posts', async (req, res) => {
  try {
    const posts = await Post.find({ status: 'approved' }).sort({ _id: -1 });
    res.json(posts);
  } catch (err) {
    console.error("❌ Failed to fetch posts:", err);
    res.status(500).json({ error: 'Failed to load posts' });
  }
});


// Delete post
app.delete('/api/post/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const deletedPost = await Post.findByIdAndDelete(id);
    if (!deletedPost) return res.status(404).json({ error: 'Post not found' });

    res.json({ message: 'Post deleted successfully.' });
  } catch (err) {
    console.error("❌ Failed to delete post:", err);
    res.status(500).json({ error: 'Failed to delete post.' });
  }
});

// Get single post by ID
app.get('/api/post/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const post = await Post.findById(id);

    if (!post) {
      return res.status(404).json({ error: 'Post not found' });
    }

    res.json(post);
  } catch (err) {
    console.error("❌ Failed to fetch post by ID:", err);
    res.status(500).json({ error: 'Failed to load post' });
  }
});

// Edit/update post by ID (with optional image re-upload)
app.put('/api/edit-post', uploadPost.array('images[]', 10), async (req, res) => {
  try {
    const { postId, crop, quantity, price, user, keptImages } = req.body;

    const post = await Post.findById(postId);
    if (!post) return res.status(404).json({ error: 'Post not found' });

    if (post.user !== user) {
      return res.status(403).json({ error: 'You are not authorized to edit this post' });
    }

    // Get keptImages from the hidden field (sent as a JSON string)
    let finalImages = [];
    if (keptImages) {
      finalImages = JSON.parse(keptImages); // this keeps original images
    }

    // Add new image URLs (if any)
    if (req.files && req.files.length > 0) {
      const newImageUrls = req.files.map(file => `/uploads/${file.filename}`);
      finalImages = finalImages.concat(newImageUrls);
    }

    // Update post fields
post.crop = crop;
post.quantity = quantity;
post.price = price;
post.imageUrls = finalImages;
post.timestamp = new Date().toLocaleString();

// ✅ Force admin review after edit
post.status = 'pending';

await post.save();
io.emit('new-post', post); // 🟢 Notify admin panel to reload pending posts

    res.json({ message: 'Post updated successfully!' });
  } catch (err) {
    console.error("❌ Failed to update post:", err);
    res.status(500).json({ error: 'Failed to update post' });
  }
});

// Get all pending posts (for admin)
app.get('/api/admin/pending-posts', async (req, res) => {
  try {
    const pendingPosts = await Post.find({ status: 'pending' }).sort({ _id: -1 });
    res.json(pendingPosts);
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch pending posts' });
  }
});

// Approve or reject a post (by ID)
app.put('/api/admin/post/:id', async (req, res) => {
  const { status } = req.body; // should be 'approved' or 'rejected'
  try {
    const updatedPost = await Post.findByIdAndUpdate(
      req.params.id,
      { status },
      { new: true }
    );

    if (!updatedPost) {
      return res.status(404).json({ error: 'Post not found' });
    }

    // ✅ Emit event for real-time update
    io.emit('post-updated', updatedPost);

    res.json(updatedPost);
  } catch (err) {
    res.status(500).json({ error: 'Failed to update post status' });
  }
});



/* ========== CHAT ROUTES ========== */

// Send a chat message
app.post('/chat/send', async (req, res) => {
  try {
    const { sender, receiver, message } = req.body;
    const newMessage = new Message({ sender, receiver, message, timestamp: new Date() });
    await newMessage.save();
    res.json({ success: true, message: 'Message sent successfully' });
  } catch (err) {
    console.error("❌ Send message error:", err);
    res.status(500).json({ success: false, message: 'Failed to send message' });
  }
});

// Get chat between two users
app.get('/chat/:sender/:receiver', async (req, res) => {
  try {
    const { sender, receiver } = req.params;
    const messages = await Message.find({
      $or: [
        { sender, receiver },
        { sender: receiver, receiver: sender }
      ]
    }).sort({ timestamp: 1 });
    res.json(messages);
  } catch (err) {
    console.error("❌ Fetch chat error:", err);
    res.status(500).json({ success: false, message: 'Failed to fetch chat' });
  }
});

// Get all chats related to a user
app.get('/chat/all/:user', async (req, res) => {
  try {
    const { user } = req.params;
    const messages = await Message.find({
      $or: [
        { sender: user },
        { receiver: user }
      ]
    }).sort({ timestamp: -1 });
    res.json(messages);
  } catch (err) {
    console.error("❌ Fetch user chats error:", err);
    res.status(500).json({ success: false, message: 'Failed to fetch messages' });
  }
});

// Get chat list (last message per partner)
app.get('/api/chat-list/:userId', async (req, res) => {
  try {
    const { userId } = req.params;

    const messages = await Message.find({
      $or: [{ sender: userId }, { receiver: userId }]
    }).sort({ timestamp: -1 });

    const chatMap = new Map();

    for (const msg of messages) {
      const partner = msg.sender === userId ? msg.receiver : msg.sender;

      if (!chatMap.has(partner)) {
        // ✅ Real unread logic
        const isUnread = msg.sender !== userId && msg.read !== true;

        chatMap.set(partner, {
          partner,
          lastMessage: msg.message,
          time: msg.timestamp,
          unread: isUnread
        });
      }
    }

    res.json([...chatMap.values()]);
  } catch (err) {
    console.error("❌ Fetch chat list error:", err);
    res.status(500).json({ error: 'Failed to load chat list' });
  }
});

// Mark messages as read from a specific sender
app.post('/chat/mark-read', async (req, res) => {
  try {
    const { userId, partnerId } = req.body;

    // ✅ Validate input
    if (!userId || !partnerId) {
      console.warn("⚠️ Invalid mark-read request:", req.body);
      return res.status(400).json({ success: false, message: 'Missing userId or partnerId' });
    }

    const result = await Message.updateMany(
      { sender: partnerId, receiver: userId, read: { $ne: true } },
      { $set: { read: true } }
    );

    if (result.modifiedCount > 0) {
  console.log(`✅ Marked ${result.modifiedCount} messages as read from ${partnerId} to ${userId}`);
}

    res.json({ success: true });
  } catch (err) {
    console.error("❌ Mark as read error:", err);
    res.status(500).json({ success: false });
  }
});

// ✅ Crop Recommendation Route (calls Python Flask API)
const axios = require('axios');

app.post('/api/crop/recommend', async (req, res) => {
  try {
    const response = await axios.post('http://127.0.0.1:5000/predict', req.body); // Python API
    res.json(response.data); // returns { recommended_crop: "rice" } or similar
  } catch (error) {
    console.error("❌ Crop recommendation error:", error.message);
    res.status(500).json({ error: 'Failed to get crop recommendation' });
  }
});

// /api/admin/dashboard-stats
app.get('/api/admin/dashboard-stats', async (req, res) => {
  try {
    const totalUsers = await User.countDocuments();
    const pendingPosts = await Post.countDocuments({ status: 'pending' });
    const approvedPosts = await Post.countDocuments({ status: 'approved' });

    res.json({ totalUsers, pendingPosts, approvedPosts });
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch dashboard stats' });
  }
});

/* ========== SERVER START ========== */
server.listen(3000, () => {
  console.log("✅ Server running on http://localhost:3000");
});

/* ======================= API: MARKET INSIGHTS (ADDED) ======================= */

// POST /api/aggregate → historical demand/supply
app.post('/api/aggregate', (req, res) => {
  try {
    const regions = req.body.regions || ['Ratnapura','Kegalle'];
    const seasons = req.body.seasons || ['Maha','Yala'];
    const years   = (req.body.years || [2024, 2025]).map(Number);

    const rows = filterFrame(regions, seasons, years);
    const agg = aggregateByCrop(rows);

    const labels = agg.map(r => r.Crop);
    const supply = agg.map(r => r.Total_Supply_t);
    const demand = agg.map(r => r.Total_Demand_t);
    const positive_gap = agg.map(r => r.Positive_Gap_t);

    res.json({ labels, supply, demand, positive_gap, meta: { regions, seasons, years } });
  } catch (e) {
    console.error('❌ aggregate error:', e);
    res.status(500).json({ error: 'aggregate failed' });
  }
});

// POST /api/forecast → forecast next year’s demand/supply
app.post('/api/forecast', (req, res) => {
  try {
    const regions = req.body.regions || ['Ratnapura','Kegalle'];
    const season  = req.body.season  || 'Maha';
    const years   = (req.body.years  || [2022, 2023, 2024, 2025]).map(Number);

    const f = forecastByCrop(regions, season, years);

    const labels = f.map(r => r.Crop);
    const supply = f.map(r => r.Forecast_Supply_t);
    const demand = f.map(r => r.Forecast_Demand_t);
    const positive_gap = f.map(r => r.Forecast_Positive_Gap_t);

    res.json({
      labels, supply, demand, positive_gap,
      meta: {
        regions,
        season_forecasted: season,
        train_years: years,
        forecast_year: Math.max(...years) + 1
      }
    });
  } catch (e) {
    console.error('❌ forecast error:', e);
    res.status(500).json({ error: 'forecast failed' });
  }
});
/* =========================================================================== */


